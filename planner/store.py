"""
Server-side state, one small JSON file per class: the last draft, the approved plan and calendar, and
what is queued for the phone. Codes, levels, aggregates and plans only; never audio, names or notes.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re

from . import config

SAFE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")


def _path(class_code: str) -> str:
    if not SAFE.match(class_code):
        raise ValueError("Kode kelas tidak valid.")
    os.makedirs(config.STATE_DIR, exist_ok=True)
    return os.path.join(config.STATE_DIR, f"{class_code}.json")


def load(class_code: str) -> dict:
    try:
        with open(_path(class_code), encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}


def save(class_code: str, state: dict) -> None:
    tmp = _path(class_code) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, _path(class_code))


def save_draft(class_code: str, result: dict, payload: dict) -> None:
    state = load(class_code)
    state["draft"] = {
        "plan": result["plan"],
        "calendar": result["calendar"],
        # The trace is kept so the Proses screen can show the last run after a reload.
        "trace": result.get("trace", []),
        "mode": result.get("mode"),
        "savedAt": _now(),
        "levelsPayload": _levels_only(payload),
    }
    save(class_code, state)


def _levels_only(payload: dict) -> list[dict]:
    return [{"code": s["code"], "level": s["confirmedLevel"]} for s in payload["students"]]


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def count_classes() -> int:
    if not os.path.isdir(config.STATE_DIR):
        return 0
    return len([f for f in os.listdir(config.STATE_DIR) if f.endswith(".json")])
