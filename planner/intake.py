"""Stage 0: validate the sync payload, group students by confirmed level, compute per-group facts. Code only."""
from __future__ import annotations

import re
import statistics
from collections import Counter

from . import config
from .timeutil import parse_date, to_min

CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


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
    try:
        parse_date(str(cls.get("startDate", "")))
    except ValueError:
        problems.append("startDate harus berformat YYYY-MM-DD.")
    weeks = cls.get("cycleWeeks")
    if not isinstance(weeks, int) or isinstance(weeks, bool) or not 1 <= weeks <= config.MAX_CYCLE_WEEKS:
        problems.append(f"cycleWeeks harus bilangan bulat 1 sampai {config.MAX_CYCLE_WEEKS}.")
    phones = cls.get("phones")
    if not isinstance(phones, int) or isinstance(phones, bool) or not 1 <= phones <= 6:
        problems.append("phones harus bilangan bulat 1 sampai 6.")
    for h in cls.get("holidays", []) or []:
        try:
            parse_date(str(h))
        except ValueError:
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
        elif level not in config.LEVELS:
            problems.append(f"{code}: tingkat '{level}' tidak dikenal.")
    return problems


def _median(values: list[float]):
    return statistics.median(values) if values else None


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
        kids = by_level[level]
        if not kids:
            continue
        practice = [k.get("practice") or {} for k in kids]
        sessions = [p.get("sessions", 0) for p in practice]
        deltas = [
            p["wcpmThirdRead"] - p["wcpmFirstRead"]
            for p in practice
            if p.get("wcpmFirstRead") is not None and p.get("wcpmThirdRead") is not None
        ]
        words = Counter(w for p in practice for w in p.get("wordsReadBack", []) or [])
        g_done = [d for d in done if str(d.get("planSessionId", "")).startswith(f"{level}-")]
        groups.append({
            "level": level,
            "name": config.LEVEL_NAME[level],
            "size": len(kids),
            "students": sorted(k["code"] for k in kids),
            "medianSessions": _median(sessions),
            "medianWcpmChange": _median(deltas),
            "wcpmReaders": len(deltas),
            "topReadBackWords": [w for w, _ in words.most_common(5)],
            "lastCycle": {"planned": len(g_done), "done": sum(1 for d in g_done if d.get("done"))},
        })
    return {
        "groups": groups,
        "students": len(payload["students"]),
        "lastCycle": {"planned": len(done), "done": sum(1 for d in done if d.get("done"))},
    }
