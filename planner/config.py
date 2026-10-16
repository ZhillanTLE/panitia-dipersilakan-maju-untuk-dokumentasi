"""Frozen constants. Nothing else steers a planning decision."""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.environ.get("PLANNER_STATE_DIR") or os.path.join(HERE, "state")
FIXTURE_DIR = os.path.join(HERE, "fixtures")
CONTENT_DIR = os.path.join(ROOT, "src", "content")

SCHEMA_VERSION = "1.0"

# Lowest to highest. Order is for display only; it is never used to compare children.
LEVELS = ["pemula", "huruf", "suku_kata", "kata", "kalimat", "paragraf"]
LEVEL_NAME = {
    "pemula": "Pemula",
    "huruf": "Huruf",
    "suku_kata": "Suku Kata",
    "kata": "Kata",
    "kalimat": "Kalimat",
    "paragraf": "Paragraf",
}
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_ID = {"Mon": "Sen", "Tue": "Sel", "Wed": "Rab", "Thu": "Kam", "Fri": "Jum", "Sat": "Sab", "Sun": "Min"}

MAX_CYCLE_WEEKS = 8
REPAIR_ATTEMPTS = 2
REPLACEMENT_MIN_MINUTES = 10
REPLACEMENT_MINUTES_PER_CHILD = 3
# Sessions a group practises per week when the time budget allows it.
SESSIONS_PER_WEEK = 2

# Fields that must never appear in a sync payload, at any depth.
FORBIDDEN_FIELDS = {
    "audio", "audiourl", "audio_url", "recording", "blob", "pcm", "wav", "transcript",
    "name", "nama", "fullname", "full_name", "notes", "note", "catatan", "comment", "komentar",
}

# Fields a student record may carry, and nothing else.
STUDENT_FIELDS = {"code", "confirmedLevel", "confirmedAt", "levelHistory", "practice", "wcpmUnseen"}


def banned_words() -> list[str]:
    with open(os.path.join(HERE, "banned_words.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    return [w.lower() for key in ("diagnosis", "ranking") for w in data[key]]
