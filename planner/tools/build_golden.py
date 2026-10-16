"""
Capture a replay fixture. A deliberate manual step, one class at a time:

    python -m planner.tools.build_golden --class K2

Reads planner/fixtures/<class>.sync.json (a SAMPLE sync payload, not a real class), runs the pipeline
once with whatever inference mode is set (MOCK_LLM=true, or PLANNER_LIVE_INFERENCE=1 with a key), and
writes <class>.golden.json. The fixture records what it was captured with, and replay mode shows it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

os.environ.setdefault("PLANNER_STATE_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state"))

from planner import config, llm, pipeline  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--class", dest="cls", required=True)
    args = parser.parse_args()
    llm.load_env_file()
    if llm.inference_mode() == "replay":
        print("Unset PLANNER_FIXTURES: a capture cannot replay itself.", file=sys.stderr)
        return 2
    src = os.path.join(config.FIXTURE_DIR, f"{args.cls}.sync.json")
    with open(src, encoding="utf-8") as fh:
        payload = json.load(fh)
    result = pipeline.run(payload)
    result["capturedWith"] = llm.inference_mode()
    result["note"] = "Rekaman dari data contoh, bukan kelas sungguhan."
    out = os.path.join(config.FIXTURE_DIR, f"{args.cls}.golden.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    print(f"wrote {out} (captured with {result['capturedWith']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
