"""Schema 2.0 sync payloads for the tests. Sample data, not real children."""
from __future__ import annotations

from planner import config

# (level, patterns hit) per student, in code order.
ROSTER = [
    ("pemula", ["letter_confusion"]),
    ("huruf", ["letter_confusion"]),
    ("huruf", ["letter_confusion"]),
    ("suku_kata", ["closed_syllable"]),
    ("suku_kata", ["closed_syllable", "digraph_cluster"]),
    ("kata", ["closed_syllable", "digraph_cluster"]),
    ("kata", ["closed_syllable"]),
    ("kalimat", ["affixed_word", "long_word"]),
    ("paragraf", []),
]

EXAMPLES = {
    "letter_confusion": [("b", "d"), ("m", "n")],
    "closed_syllable": [("ban", "ba"), ("sar", "sa"), ("tum", None)],
    "digraph_cluster": [("bunga", "buna")],
    "long_word": [("berteman", None)],
    "affixed_word": [("membaca", "baca")],
}


def metrics(level: str, hits: list[str], speed: int | None = 20, comprehension: dict | None = None) -> dict:
    return {
        "unit": config.LEVEL_UNIT[level],
        "accuracy": {"correct": 8, "attempted": 10},
        "correctUnitsPerMinute": speed,
        "errorCounts": {"substituted": 1, "omitted": 1, "teacherRead": 0, "uncertain": 0},
        "patterns": [
            {"id": pid, "count": 2, "examples": [{"word": w, "heard": h, "clipId": None} for w, h in EXAMPLES[pid]]}
            for pid in hits
        ],
        "longPauses": 1,
        "selfCorrections": 0,
        "comprehension": comprehension,
        "confidence": {"uncertainWordShare": 0.1, "teacherCorrections": 1, "audioQuality": "ok"},
    }


def student(code: str, level: str, hits: list[str], **over) -> dict:
    s = {
        "code": code,
        "confirmedLevel": level,
        "confirmedAt": "2026-10-14",
        "levelHistory": [],
        "metrics": metrics(level, hits, comprehension={"correct": 2, "asked": 3, "cardUnit": "paragraf"} if level == "paragraf" else None),
        "practice": {"sessions": 4, "correctUnitsPerMinuteFirstRead": 10, "correctUnitsPerMinuteThirdRead": 16, "wordsReadBack": ["kucing"]},
    }
    s.update(over)
    return s


def payload(**over) -> dict:
    base = {
        "schemaVersion": "2.0",
        "class": {"code": "T1", "teacherCode": "G-01", "phones": 1, "cycleWeeks": 2, "startDate": "2026-10-19", "holidays": ["2026-10-28"]},
        "timetable": [
            {"day": "Mon", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Wed", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Fri", "start": "10:00", "end": "10:35", "kind": "literacy"},
        ],
        "students": [student(f"T1-{k:02d}", level, hits) for k, (level, hits) in enumerate(ROSTER, 1)],
        "sessionsDone": [],
    }
    base.update(over)
    return base
