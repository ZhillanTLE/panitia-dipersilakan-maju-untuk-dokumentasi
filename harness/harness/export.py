"""Export a character-level CTC model to ONNX, quantise it to int8 and write a model pack.

    uv run python -m harness.export --model indonesian-nlp/wav2vec2-large-xlsr-indonesian --int8

The exported graph takes raw 16 kHz mono audio and returns per-frame CTC log-probabilities.
Input normalisation and log-softmax are inside the graph, so the app feeds samples straight
in and the scoring engine gets the raw log-probs it needs (no greedy text only).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_RATE = 16_000
OPSET = 17


class LogProbs(torch.nn.Module):
    """Wav2Vec2ForCTC with the feature extractor's normalisation and a log-softmax baked in."""

    def __init__(self, model: Wav2Vec2ForCTC) -> None:
        super().__init__()
        self.model = model

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        # Same as Wav2Vec2FeatureExtractor(do_normalize=True): zero mean, unit variance per utterance.
        mean = audio.mean(dim=-1, keepdim=True)
        var = audio.var(dim=-1, keepdim=True, unbiased=False)
        normalised = (audio - mean) / torch.sqrt(var + 1e-7)
        return torch.log_softmax(self.model(normalised).logits, dim=-1)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def export(model_id: str, out_dir: Path, int8: bool, version: str, fp16: bool = False) -> Path:
    processor = Wav2Vec2Processor.from_pretrained(model_id)
    model = Wav2Vec2ForCTC.from_pretrained(model_id).eval()
    wrapped = LogProbs(model).eval()

    pack = out_dir / version
    pack.mkdir(parents=True, exist_ok=True)
    fp32_path = pack / "batch.fp32.onnx"

    dummy = torch.randn(1, SAMPLE_RATE * 4)
    t0 = time.perf_counter()
    with torch.no_grad():
        torch.onnx.export(
            wrapped,
            (dummy,),
            str(fp32_path),
            input_names=["audio"],
            output_names=["log_probs"],
            dynamic_axes={"audio": {0: "batch", 1: "samples"}, "log_probs": {0: "batch", 1: "frames"}},
            opset_version=OPSET,
            do_constant_folding=True,
            dynamo=False,
        )
    print(f"exported fp32 in {time.perf_counter() - t0:.0f}s: {fp32_path.stat().st_size / 1e6:.0f} MB")

    # The exported graph must match PyTorch before anything is built on it.
    import onnxruntime as ort

    check = np.random.default_rng(0).standard_normal((1, SAMPLE_RATE * 3)).astype(np.float32) * 0.1
    with torch.no_grad():
        expected = wrapped(torch.from_numpy(check)).numpy()
    got = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"]).run(None, {"audio": check})[0]
    drift = float(np.abs(expected - got).max())
    print(f"fp32 ONNX vs PyTorch max |Δ log-prob| = {drift:.2e}")
    if drift > 1e-2:
        raise SystemExit("exported graph disagrees with PyTorch")

    model_path = fp32_path
    if int8:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        model_path = pack / "batch.onnx"
        # Linear layers only: the convolutional feature encoder stays fp32, where int8 hurts most.
        quantize_dynamic(str(fp32_path), str(model_path), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"])
        print(f"quantised int8: {model_path.stat().st_size / 1e6:.0f} MB")
    else:
        model_path = fp32_path.rename(pack / "batch.onnx")

    if fp16:
        # For GPU execution (WebGPU): int8 MatMulInteger has no GPU kernels, half precision does.
        import onnx
        from onnxruntime.transformers.float16 import convert_float_to_float16

        half = convert_float_to_float16(onnx.load(str(fp32_path)), keep_io_types=True)
        onnx.save(half, str(pack / "batch.fp16.onnx"))
        print(f"fp16: {(pack / 'batch.fp16.onnx').stat().st_size / 1e6:.0f} MB")

    vocab = processor.tokenizer.get_vocab()
    tokens = [t for t, _ in sorted(vocab.items(), key=lambda kv: kv[1])]
    (pack / "vocab.json").write_text(json.dumps(tokens, ensure_ascii=False), encoding="utf-8")
    thresholds = {
        "status": "draft",
        "note": "Fixed on the dev split only. Spike 1 sets the first values; never tune on test.",
        "near_similarity": 0.75,
    }
    (pack / "thresholds.json").write_text(json.dumps(thresholds, indent=2), encoding="utf-8")

    files = ["batch.onnx", "vocab.json", "thresholds.json"] + (["batch.fp16.onnx"] if fp16 else [])
    manifest = {
        "version": version,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_app_version": "0.1.0",
        "source": {"model": model_id, "license": "apache-2.0"},
        "audio": {"sample_rate": SAMPLE_RATE, "frame_ms": 20, "input": "raw mono float32, normalised inside the graph"},
        "ctc": {
            "blank_id": processor.tokenizer.pad_token_id,
            "word_delimiter": processor.tokenizer.word_delimiter_token,
            "output": "log_probs [batch, frames, vocab]",
        },
        "quantisation": "dynamic int8, MatMul only" if int8 else "none",
        "variants": {"cpu": "batch.onnx", **({"gpu": "batch.fp16.onnx"} if fp16 else {})},
        "files": [{"name": f, "bytes": (pack / f).stat().st_size, "sha256": sha256(pack / f)} for f in files],
    }
    (pack / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return pack


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, help="Hugging Face model id")
    parser.add_argument("--int8", action="store_true", help="dynamic int8 quantisation of linear layers")
    parser.add_argument("--version", default="ctc-id@0.1-int8")
    parser.add_argument("--keep-fp32", action="store_true", help="keep batch.fp32.onnx next to the int8 model")
    parser.add_argument("--fp16", action="store_true", help="also write batch.fp16.onnx for GPU execution")
    parser.add_argument("--out", type=Path, default=ROOT / "modelpack")
    args = parser.parse_args()

    pack = export(args.model, args.out, args.int8, args.version, args.fp16)
    fp32 = pack / "batch.fp32.onnx"
    if fp32.exists() and not args.keep_fp32:
        fp32.unlink()
    print(f"model pack written to {pack}")


if __name__ == "__main__":
    main()
