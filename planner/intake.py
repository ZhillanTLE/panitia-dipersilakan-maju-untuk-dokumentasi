"""Stage 0: validate the sync payload, group students by confirmed level, compute per-group facts. Code only."""
from __future__ import annotations

import math
import re
import statistics
from collections import Counter

from . import config, patterns
from .timeutil import parse_date, to_min

CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
# A pointer to a clip kept on the phone, never the clip itself.
CLIP_ID = re.compile(r"^[A-Za-z0-9:_-]{1,80}$")
AUDIO_QUALITY = {"ok", "retry_suggested", "not_measured"}
ERROR_TYPES = {"substituted", "omitted", "teacherRead", "uncertain"}
MAX_WORD = 40


class PayloadError(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def _forbidden(node, path="$") -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if str(key).lower() in config.FORBIDDEN_FIELDS:
                found.append(f"{path}.{key}")
            found += _forbidden(value, f"{path}.{key}")
    elif isinstance(node, list):
        for k, value in enumerate(node):
            found += _forbidden(value, f"{path}[{k}]")
    return found


def _is_int(v, lo: int = 0, hi: int | None = None) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= lo and (hi is None or v <= hi)


def _is_num(v, lo: float = 0, hi: float | None = None) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= lo and (hi is None or v <= hi)


def _is_word(v) -> bool:
    return isinstance(v, str) and 0 < len(v) <= MAX_WORD


def _is_date(v) -> bool:
    try:
        parse_date(str(v))
        return True
    except ValueError:
        return False


def _validate_metrics(code: str, level: str, m) -> list[str]:
    if not isinstance(m, dict):
        return [f"{code}: angka bacaan (metrics) tidak ada. Setiap murid terkonfirmasi membawa angka dari bacaannya."]
    p: list[str] = []
    extra = set(m) - config.METRIC_FIELDS
    if extra:
        p.append(f"{code}: kolom metrik tidak dikenal {sorted(extra)}")
    unit = m.get("unit")
    if unit not in config.UNITS:
        p.append(f"{code}: satuan '{unit}' tidak dikenal.")
    elif unit != config.LEVEL_UNIT[level]:
        p.append(f"{code}: satuan '{unit}' tidak cocok dengan tingkat {level} (harus '{config.LEVEL_UNIT[level]}').")
    acc = m.get("accuracy")
    if not (isinstance(acc, dict) and set(acc) == {"correct", "attempted"} and _is_int(acc["attempted"], 1) and _is_int(acc["correct"], 0, acc["attempted"])):
        p.append(f"{code}: accuracy harus {{correct, attempted}} dengan 0 <= correct <= attempted.")
    if m.get("correctUnitsPerMinute") is not None and not _is_num(m["correctUnitsPerMinute"], 0, 400):
        p.append(f"{code}: correctUnitsPerMinute harus angka 0 sampai 400, atau kosong.")
    errors = m.get("errorCounts")
    if not (isinstance(errors, dict) and set(errors) == ERROR_TYPES and all(_is_int(v) for v in errors.values())):
        p.append(f"{code}: errorCounts harus berisi {sorted(ERROR_TYPES)} sebagai bilangan bulat.")
    for key in ("longPauses", "selfCorrections"):
        if not _is_int(m.get(key)):
            p.append(f"{code}: {key} harus bilangan bulat.")
    hits = m.get("patterns")
    if not isinstance(hits, list):
        p.append(f"{code}: patterns harus daftar.")
        hits = []
    seen: set[str] = set()
    for hit in hits:
        if not isinstance(hit, dict) or set(hit) - {"id", "count", "examples"}:
            p.append(f"{code}: isi pola tidak valid: {hit}")
            continue
        pid = hit.get("id")
        if pid not in patterns.IDS:
            p.append(f"{code}: pola '{pid}' tidak ada di daftar tetap.")
            continue
        if pid in seen:
            p.append(f"{code}: pola '{pid}' ganda.")
        seen.add(pid)
        if not _is_int(hit.get("count"), 1):
            p.append(f"{code}: jumlah pola '{pid}' harus bilangan bulat 1 ke atas.")
        examples = hit.get("examples", [])
        if not isinstance(examples, list) or len(examples) > config.MAX_EXAMPLES:
            p.append(f"{code}: contoh pola '{pid}' paling banyak {config.MAX_EXAMPLES}.")
            continue
        for ex in examples:
            ok = (
                isinstance(ex, dict)
                and not set(ex) - config.EXAMPLE_FIELDS
                and _is_word(ex.get("word"))
                and (ex.get("heard") is None or (isinstance(ex["heard"], str) and len(ex["heard"]) <= MAX_WORD))
                and (ex.get("clipId") is None or (isinstance(ex["clipId"], str) and CLIP_ID.match(ex["clipId"])))
            )
            if not ok:
                p.append(f"{code}: contoh pola '{pid}' tidak valid. Hanya kata, yang terdengar, dan penunjuk klip di perangkat.")
    comp = m.get("comprehension")
    if comp is not None:
        ok = (
            isinstance(comp, dict)
            and set(comp) == {"correct", "asked", "cardUnit"}
            and comp["cardUnit"] == "paragraf"
            and _is_int(comp["asked"], 1, config.MAX_QUESTIONS)
            and _is_int(comp["correct"], 0, comp["asked"])
        )
        if not ok:
            p.append(f"{code}: comprehension hanya untuk kartu paragraf, {{correct, asked, cardUnit}} dengan 1 sampai {config.MAX_QUESTIONS} pertanyaan.")
    conf = m.get("confidence")
    ok = (
        isinstance(conf, dict)
        and set(conf) == {"uncertainWordShare", "teacherCorrections", "audioQuality"}
        and _is_num(conf["uncertainWordShare"], 0, 1)
        and _is_int(conf["teacherCorrections"])
        and conf["audioQuality"] in AUDIO_QUALITY
    )
    if not ok:
        p.append(f"{code}: confidence harus {{uncertainWordShare 0..1, teacherCorrections, audioQuality}}.")
    return p


def _validate_practice(code: str, pr) -> list[str]:
    if pr is None:
        return []
    if not isinstance(pr, dict):
        return [f"{code}: practice harus objek."]
    p: list[str] = []
    extra = set(pr) - config.PRACTICE_FIELDS
    if extra:
        p.append(f"{code}: kolom latihan tidak dikenal {sorted(extra)}")
    if not _is_int(pr.get("sessions", 0)):
        p.append(f"{code}: practice.sessions harus bilangan bulat.")
    for key in ("correctUnitsPerMinuteFirstRead", "correctUnitsPerMinuteThirdRead"):
        if pr.get(key) is not None and not _is_num(pr[key], 0, 400):
            p.append(f"{code}: practice.{key} harus angka 0 sampai 400.")
    words = pr.get("wordsReadBack", [])
    if not isinstance(words, list) or len(words) > 20 or not all(_is_word(w) for w in words):
        p.append(f"{code}: practice.wordsReadBack harus daftar kata (paling banyak 20).")
    return p


def validate(payload: dict) -> list[str]:
    """Every problem found, in plain words. Empty means the payload may enter planning."""
    if not isinstance(payload, dict):
        return ["Payload harus berupa objek JSON."]
    problems = [f"Kolom tidak diperbolehkan (audio, nama atau catatan bebas): {p}" for p in _forbidden(payload)]
    if payload.get("schemaVersion") != config.SCHEMA_VERSION:
        problems.append(f"schemaVersion harus {config.SCHEMA_VERSION}.")
    cls = payload.get("class")
    if not isinstance(cls, dict):
        problems.append("Data kelas (class) tidak ada.")
        cls = {}
    if not CODE.match(str(cls.get("code", ""))):
        problems.append("Kode kelas tidak valid.")
    if not _is_date(cls.get("startDate", "")):
        problems.append("startDate harus berformat YYYY-MM-DD.")
    weeks = cls.get("cycleWeeks")
    if not _is_int(weeks, 1, config.MAX_CYCLE_WEEKS):
        problems.append(f"cycleWeeks harus bilangan bulat 1 sampai {config.MAX_CYCLE_WEEKS}.")
    if not _is_int(cls.get("phones"), 1, 6):
        problems.append("phones harus bilangan bulat 1 sampai 6.")
    for h in cls.get("holidays", []) or []:
        if not _is_date(h):
            problems.append(f"Tanggal libur tidak valid: {h}")

    slots = payload.get("timetable")
    if not isinstance(slots, list) or not slots:
        problems.append("Jadwal (timetable) kosong: isi minimal satu jam literasi.")
        slots = []
    for slot in slots:
        ok = (
            isinstance(slot, dict)
            and slot.get("day") in config.DAYS
            and HHMM.match(str(slot.get("start", "")))
            and HHMM.match(str(slot.get("end", "")))
        )
        if not ok:
            problems.append(f"Jam jadwal tidak valid: {slot}")
        elif to_min(slot["end"]) <= to_min(slot["start"]):
            problems.append(f"Jam selesai harus setelah jam mulai: {slot['day']} {slot['start']}")

    students = payload.get("students")
    if not isinstance(students, list) or not students:
        problems.append("Daftar murid kosong.")
        students = []
    seen: set[str] = set()
    for s in students:
        if not isinstance(s, dict) or not CODE.match(str(s.get("code", ""))):
            problems.append(f"Kode murid tidak valid: {s.get('code') if isinstance(s, dict) else s}")
            continue
        code = s["code"]
        if code in seen:
            problems.append(f"Kode murid ganda: {code}")
        seen.add(code)
        extra = set(s) - config.STUDENT_FIELDS
        if extra:
            problems.append(f"{code}: kolom tidak dikenal {sorted(extra)}")
        level = s.get("confirmedLevel")
        if level is None:
            problems.append(f"{code}: tingkat belum dikonfirmasi guru. Tingkat yang belum dikonfirmasi tidak masuk perencanaan.")
            continue
        if level not in config.LEVELS:
            problems.append(f"{code}: tingkat '{level}' tidak dikenal.")
            continue
        if "confirmedAt" in s and not _is_date(s["confirmedAt"]):
            problems.append(f"{code}: confirmedAt harus berformat YYYY-MM-DD.")
        history = s.get("levelHistory", [])
        if not isinstance(history, list) or not all(isinstance(h, dict) and h.get("level") in config.LEVELS and _is_date(h.get("confirmedAt")) and not set(h) - {"level", "confirmedAt"} for h in history):
            problems.append(f"{code}: levelHistory harus daftar {{level, confirmedAt}}.")
        problems += _validate_metrics(code, level, s.get("metrics"))
        problems += _validate_practice(code, s.get("practice"))
    return problems


def _r(x):
    """One decimal place, and whole numbers stay whole: the Checker compares numbers at this precision."""
    if x is None:
        return None
    x = round(float(x), 1)
    return int(x) if x == int(x) else x


def _median(values: list[float]):
    return _r(statistics.median(values)) if values else None


def _group_patterns(kids: list[dict]) -> list[dict]:
    """Per pattern: how many children hit it, how many words in all, and up to three example words."""
    children: Counter = Counter()
    words: Counter = Counter()
    examples: dict[str, list[str]] = {}
    for k in kids:
        for hit in k["metrics"]["patterns"]:
            children[hit["id"]] += 1
            words[hit["id"]] += hit["count"]
            for ex in hit.get("examples", []):
                bucket = examples.setdefault(hit["id"], [])
                word = patterns.normalize(ex["word"])
                if word and word not in bucket and len(bucket) < config.MAX_EXAMPLES:
                    bucket.append(word)
    out = [
        {"id": pid, "label": patterns.LABEL[pid], "children": children[pid], "count": words[pid], "examples": examples.get(pid, [])}
        for pid in patterns.IDS
        if children[pid]
    ]
    # Patterns, not children, are put in order: most children first, then most words, then the fixed list order.
    out.sort(key=lambda p: (-p["children"], -p["count"], patterns.IDS.index(p["id"])))
    return out


def top_patterns(group: dict) -> list[str]:
    """The group's most frequent pattern(s): most children, then most words. Ties are all returned."""
    if not group["patterns"]:
        return []
    first = group["patterns"][0]
    return [p["id"] for p in group["patterns"] if (p["children"], p["count"]) == (first["children"], first["count"])]


def intake(payload: dict) -> dict:
    """Validated payload -> groups with facts. Raises PayloadError on any problem."""
    problems = validate(payload)
    if problems:
        raise PayloadError(problems)
    done = payload.get("sessionsDone") or []
    by_level: dict[str, list[dict]] = {level: [] for level in config.LEVELS}
    for s in payload["students"]:
        by_level[s["confirmedLevel"]].append(s)

    groups = []
    for level in config.LEVELS:
        kids = sorted(by_level[level], key=lambda k: k["code"])
        if not kids:
            continue
        metrics = [k["metrics"] for k in kids]
        practice = [k.get("practice") or {} for k in kids]
        speeds = [m["correctUnitsPerMinute"] for m in metrics if m.get("correctUnitsPerMinute") is not None]
        changes = [
            p["correctUnitsPerMinuteThirdRead"] - p["correctUnitsPerMinuteFirstRead"]
            for p in practice
            if p.get("correctUnitsPerMinuteFirstRead") is not None and p.get("correctUnitsPerMinuteThirdRead") is not None
        ]
        comp = [m["comprehension"] for m in metrics if m.get("comprehension")]
        words = Counter(w for p in practice for w in p.get("wordsReadBack", []) or [])
        g_done = [d for d in done if str(d.get("planSessionId", "")).startswith(f"{level}-")]
        unit = config.LEVEL_UNIT[level]
        group = {
            "level": level,
            "name": config.LEVEL_NAME[level],
            "size": len(kids),
            "students": [k["code"] for k in kids],
            "unit": unit,
            "unitName": config.UNIT_NAME[unit],
            "accuracy": {
                "medianCorrect": _median([m["accuracy"]["correct"] for m in metrics]),
                "medianAttempted": _median([m["accuracy"]["attempted"] for m in metrics]),
            },
            "correctUnitsPerMinute": {"median": _median(speeds), "children": len(speeds)} if speeds else None,
            "practice": {
                "medianSessions": _median([p.get("sessions", 0) for p in practice]),
                "medianChange": _median(changes),
                "children": len(changes),
            },
            "comprehension": {"medianCorrect": _median([c["correct"] for c in comp]), "medianAsked": _median([c["asked"] for c in comp]), "children": len(comp)} if comp else None,
            "patterns": _group_patterns(kids),
            "topReadBackWords": [w for w, _ in words.most_common(5)],
            "lastCycle": {"planned": len(g_done), "done": sum(1 for d in g_done if d.get("done"))},
        }
        group["topPatterns"] = top_patterns(group)
        groups.append(group)
    return {
        "groups": groups,
        "students": len(payload["students"]),
        "lastCycle": {"planned": len(done), "done": sum(1 for d in done if d.get("done"))},
    }


def evidence_facts(group: dict) -> dict:
    """What the Evidence Summarizer sees for a group: the facts, without the children's codes."""
    return {k: v for k, v in group.items() if k not in ("students", "topPatterns")}
