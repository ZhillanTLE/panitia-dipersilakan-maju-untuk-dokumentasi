"""
Stage 3: the Checker. Code first; an agent is only ever asked to repair.

Two sets of deterministic rules. The evidence rules run on every line the Evidence Summarizer writes:
no banned word, no level move, no percentage, no child's code, and every number must be one of the
stage-0 facts for that group, exactly (Windfall's "no unmeasured numbers", enforced in code). The plan
rules run on whatever the Planner returned. A failed rule is sent back to the agent for a repair, at
most REPAIR_ATTEMPTS times; after that the rule-based default is used and the trace says so. The
teacher always gets a valid plan.
"""
from __future__ import annotations

import re

from . import config, library
from .calendar_slots import replacement_minutes
from .wordlist import contains_banned

# Phrases that would move a child or group to another level. The line is dropped, never used.
LEVEL_MOVE = re.compile(r"\b(naik|turun|pindah|dipindah|dinaikkan|diturunkan|promosi)\b[^.]*\b(tingkat|level|kelompok)\b", re.I)
PERCENT = re.compile(r"%|\bpersen\b", re.I)
CHILD_CODE = re.compile(r"\b[a-z]+\d+[a-z0-9]*-\d+\b", re.I)
DIGITS = re.compile(r"(?<![\w.,])(ke-?\s?)?(\d+(?:[.,]\d+)?)(?![\w])", re.I)
UNIT_WORDS = {"nol": 0, "satu": 1, "dua": 2, "tiga": 3, "empat": 4, "lima": 5, "enam": 6, "tujuh": 7, "delapan": 8, "sembilan": 9}
WHOLE_WORDS = {"sepuluh": 10, "sebelas": 11, "seratus": 100}


def numbers_in(text: str) -> list[float]:
    """Every cardinal number in a line, in digits (3, 2,5) or in words (lima, dua belas, tiga puluh dua).
    Ordinals (pertama, ketiga, ke-3) name which reading is meant and are not counted."""
    out: list[float] = []
    for m in DIGITS.finditer(text):
        if m.group(1):
            continue
        out.append(float(m.group(2).replace(",", ".")))
    words = re.findall(r"[a-z]+", text.lower())
    k = 0
    while k < len(words):
        w = words[k]
        nxt = words[k + 1] if k + 1 < len(words) else ""
        if w in WHOLE_WORDS:
            out.append(WHOLE_WORDS[w])
        elif w in UNIT_WORDS and not (w == "satu" and k > 0 and words[k - 1] == "salah"):
            value = UNIT_WORDS[w]
            if nxt == "belas":
                value, k = 10 + value, k + 1
            elif nxt == "puluh":
                value, k = 10 * value, k + 1
                after = words[k + 1] if k + 1 < len(words) else ""
                if after in UNIT_WORDS:
                    value, k = value + UNIT_WORDS[after], k + 1
            out.append(value)
        k += 1
    return out


def fact_numbers(node) -> set[float]:
    """Every number anywhere in a facts object, at the precision intake rounds to."""
    found: set[float] = set()
    if isinstance(node, bool):
        return found
    if isinstance(node, (int, float)):
        found.add(round(float(node), 1))
    elif isinstance(node, dict):
        for v in node.values():
            found |= fact_numbers(v)
    elif isinstance(node, list):
        for v in node:
            found |= fact_numbers(v)
    return found


def check_line(line: str, allowed: set[float]) -> tuple[str, str] | None:
    """(rule, reason) for the first evidence rule the line breaks, or None when it may stay."""
    hits = contains_banned(line)
    if hits:
        return "banned_word", "Kata terlarang: " + ", ".join(hits)
    if LEVEL_MOVE.search(line):
        return "level_move", "Menyarankan perpindahan tingkat; tingkat hanya dari konfirmasi guru."
    if PERCENT.search(line):
        return "percent", "Memakai persen; laporan ini hanya memakai hitungan."
    if CHILD_CODE.search(line):
        return "child_code", "Menyebut kode murid; bukti hanya tentang kelompok."
    for n in numbers_in(line):
        if round(n, 1) not in allowed:
            shown = str(int(n)) if n == int(n) else str(n).replace(".", ",")
            return "number_mismatch", f"Angka {shown} tidak ada di data kelompok ini."
    return None


def check_evidence(lines: dict[str, list[str]], facts: dict[str, dict], class_facts: dict) -> tuple[dict[str, list[str]], list[dict]]:
    """Keeps the lines that pass every evidence rule (at most three per group); the rest are recorded as discarded."""
    kept: dict[str, list[str]] = {}
    discarded: list[dict] = []
    base = fact_numbers(class_facts)
    for level, group_lines in lines.items():
        allowed = base | fact_numbers(facts.get(level, {}))
        mine = []
        for line in group_lines:
            if not isinstance(line, str) or not line.strip():
                continue
            broken = check_line(line, allowed)
            if broken:
                discarded.append({"level": level, "line": line, "rule": broken[0], "reason": broken[1]})
            else:
                mine.append(line.strip())
        kept[level] = mine[:3]
    return kept, discarded


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
        shown = {p["id"] for p in g["patterns"]}
        practice = []
        for s in mine:
            week = s.get("week")
            if week not in used:
                fail(level, "week", f"Minggu {week} di luar siklus yang direncanakan.")
                continue
            if s.get("kind") == "replacement":
                replacements += 1
                if week != last:
                    fail(level, "replacement_week", "Penempatan ulang harus di minggu terakhir.")
                continue
            if s.get("kind") != "practice":
                fail(level, "kind", f"Jenis sesi tidak dikenal: {s.get('kind')}")
                continue
            practice.append(s)
            focus = s.get("focus")
            if shown and focus not in shown:
                fail(level, "focus", f"Fokus '{focus}' tidak muncul di data kelompok ini; pilih dari {sorted(shown)}.")
            if not shown and focus:
                fail(level, "focus", f"Kelompok ini tidak menunjukkan pola apa pun, jadi sesi tidak boleh punya fokus ('{focus}').")
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
        top = g.get("topPatterns") or []
        if top and practice:
            first = min(practice, key=lambda s: s["week"])
            if first.get("focus") not in top:
                fail(level, "first_focus", f"Sesi pertama harus melatih pola yang paling sering muncul: {', '.join(top)}.")
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
                s["focus"] = None
    return sessions
