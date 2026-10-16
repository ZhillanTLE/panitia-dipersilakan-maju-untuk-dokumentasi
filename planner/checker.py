"""
Stage 3: the Checker. Code first; an agent is only ever asked to repair.

Deterministic rules on whatever the Planner returned. A failed rule is sent back to the Planner for a
repair, at most REPAIR_ATTEMPTS times; after that the rule-based default plan is used and the trace says
so. The teacher always gets a valid plan.
"""
from __future__ import annotations

from . import config, library
from .wordlist import contains_banned
from .calendar_slots import replacement_minutes


def check(sessions: dict[str, list[dict]], groups: list[dict], weeks: list[int], budgets: dict[str, dict[int, int]], skip_replacement: set[str] | None = None) -> list[dict]:
    skip_replacement = skip_replacement or set()
    acts = library.activities()
    last = weeks[-1]
    failures: list[dict] = []

    def fail(level, rule, detail):
        failures.append({"group": level, "rule": rule, "detail": detail})

    for g in groups:
        level = g["level"]
        mine = sessions.get(level)
        if not mine:
            fail(level, "empty", "Kelompok ini belum punya sesi.")
            continue
        used = {w: 0 for w in weeks}
        replacements = 0
        pack = set(library.pack(level))
        for s in mine:
            week = s.get("week")
            if week not in used:
                fail(level, "week", f"Minggu {week} di luar siklus yang direncanakan.")
                continue
            for text in (s.get("focus") or "",):
                hits = contains_banned(str(text))
                if hits:
                    fail(level, "banned_word", "Kata terlarang di teks agen: " + ", ".join(hits))
            if s.get("kind") == "replacement":
                replacements += 1
                if week != last:
                    fail(level, "replacement_week", "Penempatan ulang harus di minggu terakhir.")
                continue
            if s.get("kind") != "practice":
                fail(level, "kind", f"Jenis sesi tidak dikenal: {s.get('kind')}")
                continue
            act = acts.get(s.get("activityId"))
            if not act:
                fail(level, "activity_id", f"activityId tidak ada di pustaka: {s.get('activityId')}")
                continue
            if act["level"] != level:
                fail(level, "activity_level", f"{act['id']} bukan kegiatan untuk tingkat {level}.")
            if s.get("minutes") != act["minutes"]:
                fail(level, "minutes", f"{act['id']} berdurasi {act['minutes']} menit, bukan {s.get('minutes')}.")
            for pid in s.get("passageIds") or []:
                if pid not in pack:
                    fail(level, "passage_id", f"Bacaan {pid} tidak ada di paket tingkat {level}.")
            used[week] += act["minutes"]
        for week, minutes in used.items():
            room = budgets[level].get(week, 0) - (replacement_minutes(g["size"]) if week == last and level not in skip_replacement else 0)
            if minutes > max(0, room):
                fail(level, "budget", f"Minggu {week}: {minutes} menit melebihi batas {max(0, room)} menit.")
        if level not in skip_replacement and replacements != 1:
            fail(level, "replacement", f"Harus ada tepat satu sesi penempatan ulang di minggu {last} (ada {replacements}).")
        if level in skip_replacement and replacements:
            fail(level, "replacement", "Kelompok ini sudah ditempatkan ulang; tidak perlu sesi lagi.")
    return failures


def normalise(sessions: dict[str, list[dict]], groups: list[dict]) -> dict[str, list[dict]]:
    """Code owns replacement minutes; the agent's number is overwritten, never trusted."""
    size = {g["level"]: g["size"] for g in groups}
    for level, mine in sessions.items():
        for s in mine:
            if s.get("kind") == "replacement":
                s["minutes"] = replacement_minutes(size.get(level, 0))
                s["activityId"] = None
                s["passageIds"] = []
                s["focus"] = "Penempatan ulang"
    return sessions
