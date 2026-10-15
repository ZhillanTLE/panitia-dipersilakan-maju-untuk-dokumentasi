"""Evaluate a model pack on a labelled split: accuracy, speed and memory.

    uv run python -m harness.evaluate --pack ../modelpack/ctc-id@0.1-int8 --split dev

The test split is only read with --final, and every such run is logged. Thresholds are
fixed on dev; the harness refuses to tune on test (CLAUDE.md, "Model pack").
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import jiwer
import numpy as np
import onnxruntime as ort
import psutil
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "harness" / "data"
REPORTS = ROOT / "harness" / "reports"


def normalise(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def greedy_decode(log_probs: np.ndarray, tokens: list[str], blank_id: int, delimiter: str) -> str:
    """Best path per frame, repeats collapsed, blanks dropped. No language model."""
    best = log_probs.argmax(axis=-1)
    out: list[str] = []
    prev = -1
    for idx in best:
        if idx != prev and idx != blank_id:
            out.append(tokens[idx])
        prev = idx
    return re.sub(r"\s+", " ", "".join(out).replace(delimiter, " ")).strip()


def load_split(split: str) -> list[tuple[Path, str]]:
    root = DATA / f"fleurs-id-{split}"
    items: list[tuple[Path, str]] = []
    with (root / f"{split}.tsv").open(encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            wav = root / split / row[1]
            reference = normalise(row[3])
            # Digits are spoken as words, so their transcripts can't be compared letter for letter.
            if wav.exists() and not re.search(r"\d", row[3]):
                items.append((wav, reference))
    return items


def session(path: Path, threads: int) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def window_latency(sess: ort.InferenceSession, seconds: float, runs: int = 5) -> float:
    audio = (np.random.default_rng(1).standard_normal((1, int(16000 * seconds))) * 0.05).astype(np.float32)
    sess.run(None, {"audio": audio})
    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        sess.run(None, {"audio": audio})
        times.append(time.perf_counter() - t0)
    return float(np.median(times) * 1000)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--split", choices=["dev", "test"], default="dev")
    parser.add_argument("--final", action="store_true", help="required to read the test split; the run is logged")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--file", default="batch.onnx", help="model file inside the pack, e.g. batch.fp32.onnx")
    args = parser.parse_args()

    if args.split == "test" and not args.final:
        raise SystemExit("The test split needs --final. Fix thresholds on dev first.")

    manifest = json.loads((args.pack / "manifest.json").read_text(encoding="utf-8"))
    tokens = json.loads((args.pack / "vocab.json").read_text(encoding="utf-8"))
    blank_id = manifest["ctc"]["blank_id"]
    delimiter = manifest["ctc"]["word_delimiter"]

    process = psutil.Process()
    rss_before = process.memory_info().rss
    t_load = time.perf_counter()
    model_file = args.pack / args.file
    sess = session(model_file, args.threads)
    load_s = time.perf_counter() - t_load

    items = load_split(args.split)
    if args.limit:
        items = items[: args.limit]

    references, hypotheses, audio_s, infer_s = [], [], 0.0, 0.0
    peak_rss = process.memory_info().rss
    examples = []
    for wav, reference in items:
        audio, rate = sf.read(wav, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        assert rate == 16000, f"{wav.name}: {rate} Hz"
        t0 = time.perf_counter()
        log_probs = sess.run(None, {"audio": audio[None, :]})[0][0]
        infer_s += time.perf_counter() - t0
        audio_s += len(audio) / rate
        peak_rss = max(peak_rss, process.memory_info().rss)
        hypothesis = greedy_decode(log_probs, tokens, blank_id, delimiter)
        references.append(reference)
        hypotheses.append(hypothesis)
        if len(examples) < 4:
            examples.append({"reference": reference, "heard": hypothesis})

    report = {
        "pack": manifest["version"],
        "file": args.file,
        "split": args.split,
        "data": f"FLEURS id_id {args.split} (first {len(items)} utterances without digits)",
        "utterances": len(items),
        "audio_seconds": round(audio_s, 1),
        "wer": round(jiwer.wer(references, hypotheses), 4),
        "cer": round(jiwer.cer(references, hypotheses), 4),
        "speed": {
            "threads": args.threads,
            "real_time_factor": round(infer_s / audio_s, 3),
            "window_2s_ms": round(window_latency(sess, 2.0)),
            "window_4s_ms": round(window_latency(sess, 4.0)),
            "load_s": round(load_s, 1),
        },
        "memory_mb": {"peak_rss": round(peak_rss / 1e6), "model_delta": round((peak_rss - rss_before) / 1e6)},
        "model_mb": round(model_file.stat().st_size / 1e6),
        "examples": examples,
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / f"{manifest['version'].replace('@', '-')}-{Path(args.file).stem}-{args.split}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    if args.final:
        with (REPORTS / "final-runs.log").open("a", encoding="utf-8") as log:
            log.write(f"{report['run_at']} {manifest['version']} test wer={report['wer']} cer={report['cer']}\n")
    print(json.dumps({k: v for k, v in report.items() if k != "examples"}, indent=2))
    for e in examples[:2]:
        print(f"  ref:   {e['reference'][:110]}\n  heard: {e['heard'][:110]}")


if __name__ == "__main__":
    main()
