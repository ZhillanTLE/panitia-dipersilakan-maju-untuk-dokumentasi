"""
Write planner/fixtures/K2.sync.json, the SAMPLE schema 2.0 payload the replay fixture is captured from.

    python -m planner.tools.build_sample

Each child's misreadings are listed as words on the card at their level; accuracy and patterns are
computed from them with the same rules the phone uses, so the sample can never disagree with them.
Not a real class.
"""
from __future__ import annotations

import json
import os

from planner import config, library, patterns

# The card each level reads first on the phone (cardFor in src/lib/cards.ts): the first card of that level.
FIRST_CARD = {}
for _card in library._load("cards.json")["cards"]:
    FIRST_CARD.setdefault(_card["level"], _card)
FIRST_CARD["pemula"] = FIRST_CARD["huruf"]

# code: (level, misreadings as (word, heard or None, status), speed on that card, practice first/third read, words read back,
#        comprehension (correct, asked) or None, level history)
CHILDREN = {
    "K2-01": ("pemula", [("b", "de", "substituted"), ("m", "en", "substituted"), ("k", "ge", "substituted"), ("r", None, "omitted")], 9, None, [], None, []),
    "K2-02": ("huruf", [("b", "d", "substituted"), ("t", None, "omitted")], 28, (10, 13), [], None, []),
    "K2-03": ("huruf", [("m", "n", "substituted"), ("u", "n", "substituted")], 12, (24, 22), ["ba"], None, []),
    "K2-04": ("suku_kata", [("ba", "da", "substituted"), ("pa", "ba", "substituted")], 12, (21, 22), [], None, [("huruf", "2026-09-30")]),
    "K2-05": ("suku_kata", [("ba", "da", "substituted"), ("ta", None, "supplied")], 13, (21, 28), [], None, []),
    "K2-06": ("suku_kata", [("ru", "lu", "substituted")], 28, (28, 35), [], None, []),
    "K2-07": ("kata", [("bintang", "bintan", "substituted"), ("lampu", "lapu", "substituted"), ("gurun", None, "omitted")], 27, (9, 7), ["buku"], None, [("suku_kata", "2026-09-30")]),
    "K2-08": ("kata", [("domba", "doba", "substituted"), ("pasir", "pasi", "substituted")], 27, (17, 17), ["buku", "meja", "rumah"], None, []),
    "K2-09": ("kata", [("rubah", "rudah", "substituted"), ("sumur", "sumu", "substituted")], 36, (26, 32), ["buku", "meja"], None, []),
    "K2-10": ("kalimat", [("bersinar", "sinar", "substituted"), ("mencari", "cari", "substituted"), ("pohon", "poho", "substituted"), ("sekuntum", None, "supplied")], 13, (11, 14), ["ibu"], None, []),
    "K2-11": ("kalimat", [("mencari", "cari", "substituted"), ("langit", "lagit", "substituted")], 11, (30, 37), [], None, []),
    "K2-12": ("paragraf", [("membersihkan", "bersihkan", "substituted"), ("menyiram", "siram", "substituted"), ("sekuntum", None, "omitted"), ("berjalan", "jalan", "substituted"), ("gunung", "gunun", "substituted")], 27, (14, 22), ["bintang", "rubah", "mawar"], (2, 3), []),
    "K2-13": ("paragraf", [("sangat", "sanat", "substituted"), ("akhirnya", "akirnya", "substituted"), ("bertemu", "temu", "substituted")], 39, (18, 25), ["bintang", "rubah", "mawar"], (3, 3), []),
    "K2-14": ("huruf", [("t", "de", "substituted")], 35, (19, 20), ["ba", "bu"], None, []),
}


def items(card: dict) -> list[str]:
    return library._items(card)


def metrics(level: str, misreads: list[tuple], speed: int, comprehension) -> dict:
    card = FIRST_CARD[level]
    words = {patterns.normalize(w) for w in items(card)}
    for word, _, _ in misreads:
        assert patterns.normalize(word) in words, f"{word} is not on {card['id']}"
    hits: dict[str, dict] = {}
    for word, heard, status in misreads:
        for pid in patterns.classify(word, heard if status == "substituted" else None):
            hit = hits.setdefault(pid, {"id": pid, "count": 0, "examples": []})
            hit["count"] += 1
            if len(hit["examples"]) < config.MAX_EXAMPLES:
                hit["examples"].append({"word": word, "heard": heard if status == "substituted" else None, "clipId": None})
    count = lambda s: sum(1 for _, _, st in misreads if st == s)  # noqa: E731
    attempted = len(items(card))
    return {
        "unit": config.LEVEL_UNIT[level],
        "accuracy": {"correct": attempted - len(misreads), "attempted": attempted},
        "correctUnitsPerMinute": speed,
        "errorCounts": {"substituted": count("substituted"), "omitted": count("omitted"), "teacherRead": count("supplied"), "uncertain": 0},
        "patterns": [hits[pid] for pid in patterns.IDS if pid in hits],
        "longPauses": min(3, len(misreads) - 1),
        "selfCorrections": 1 if len(misreads) > 2 else 0,
        "comprehension": {"correct": comprehension[0], "asked": comprehension[1], "cardUnit": "paragraf"} if comprehension else None,
        "confidence": {"uncertainWordShare": 0.05, "teacherCorrections": len(misreads) // 2, "audioQuality": "ok"},
    }


def main() -> int:
    students = []
    for code, (level, misreads, speed, reads, back, comp, history) in CHILDREN.items():
        practice = {"sessions": 0, "wordsReadBack": back}
        if reads:
            practice = {"sessions": 3 + len(back), "correctUnitsPerMinuteFirstRead": reads[0], "correctUnitsPerMinuteThirdRead": reads[1], "wordsReadBack": back}
        students.append({
            "code": code,
            "confirmedLevel": level,
            "confirmedAt": "2026-10-14",
            "levelHistory": [{"level": lv, "confirmedAt": at} for lv, at in history],
            "metrics": metrics(level, misreads, speed, comp),
            "practice": practice,
        })
    payload = {
        "_sample": "Data contoh untuk mode rekaman. Bukan murid sungguhan.",
        "schemaVersion": config.SCHEMA_VERSION,
        "class": {"code": "K2", "teacherCode": "G-01", "phones": 1, "cycleWeeks": 2, "startDate": "2026-10-19", "holidays": ["2026-10-28"]},
        "timetable": [
            {"day": "Mon", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Tue", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Wed", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Thu", "start": "08:00", "end": "08:35", "kind": "literacy"},
            {"day": "Fri", "start": "10:00", "end": "10:35", "kind": "literacy"},
        ],
        "students": students,
        "sessionsDone": [],
    }
    out = os.path.join(config.FIXTURE_DIR, "K2.sync.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
