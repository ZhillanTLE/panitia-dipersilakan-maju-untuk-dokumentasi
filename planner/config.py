"""Frozen constants. Nothing else steers a planning decision."""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.environ.get("PLANNER_STATE_DIR") or os.path.join(HERE, "state")
FIXTURE_DIR = os.path.join(HERE, "fixtures")
CONTENT_DIR = os.path.join(ROOT, "src", "content")

SCHEMA_VERSION = "2.0"

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
# What a level's card counts. Letters per minute and words per minute are never compared.
UNITS = ["huruf", "suku_kata", "kata"]
LEVEL_UNIT = {"pemula": "huruf", "huruf": "huruf", "suku_kata": "suku_kata", "kata": "kata", "kalimat": "kata", "paragraf": "kata"}
UNIT_NAME = {"huruf": "huruf", "suku_kata": "suku kata", "kata": "kata"}
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_ID = {"Mon": "Sen", "Tue": "Sel", "Wed": "Rab", "Thu": "Kam", "Fri": "Jum", "Sat": "Sab", "Sun": "Min"}

# The school day the calendar shows and the teacher may place sessions in, widened to the timetable if it runs
# earlier or later. The Scheduler still places sessions in literacy periods; the teacher may move them to any hour.
SCHOOL_DAY = ("07:00", "14:00")
SCHOOL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

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

# Fields a student record may carry, and nothing else. Every metric is computed on the phone by rules;
# agents never see a field here as something they may write (scope_check enforces it).
STUDENT_FIELDS = {"code", "confirmedLevel", "confirmedAt", "levelHistory", "metrics", "practice"}
METRIC_FIELDS = {
    "unit", "accuracy", "correctUnitsPerMinute", "errorCounts", "patterns", "longPauses", "selfCorrections",
    "comprehension", "confidence",
}
PRACTICE_FIELDS = {"sessions", "correctUnitsPerMinuteFirstRead", "correctUnitsPerMinuteThirdRead", "wordsReadBack"}
# A kept clip stays on the phone; the payload may only point at it.
EXAMPLE_FIELDS = {"word", "heard", "clipId"}
MAX_EXAMPLES = 3
MAX_QUESTIONS = 3

# The only fields an agent's output may carry. Anything else is discarded and logged.
AGENT_FIELDS = {
    "evidence": {"level", "lines"},
    "planner": {"week", "kind", "activityId", "passageIds", "minutes", "focus"},
}


def banned_words() -> list[str]:
    with open(os.path.join(HERE, "banned_words.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    return [w.lower() for key in ("diagnosis", "ranking") for w in data[key]]
