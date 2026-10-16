"""
The two agents: Evidence Summarizer and Planner.

They write evidence lines and choose activity and passage IDs. They never place a time, never set or
move a level, never rank, and never diagnose. Whatever they return is sanitised in code first. In mock
mode the same functions run without a model and say so in `writtenBy` / `plannedBy`, so template text
is never mistaken for model output.
"""
from __future__ import annotations

import re

from . import library, llm
from .wordlist import contains_banned

EVIDENCE_SYSTEM = (
    "Kamu merangkum bukti latihan membaca satu kelas untuk guru SD di Indonesia. "
    "Untuk setiap kelompok (sudah dikelompokkan berdasarkan tingkat yang dikonfirmasi guru), tulis 1 sampai 3 kalimat "
    "bahasa Indonesia sederhana yang hanya memakai angka dari data yang diberikan. "
    "ATURAN: jangan menyebut atau menyarankan tingkat baru, jangan membandingkan atau mengurutkan anak atau kelompok, "
    "jangan memakai kata diagnosis atau gangguan, jangan memakai persen. "
    'Balas hanya JSON: {"groups":[{"level":"<level kelompok persis seperti diberikan>","lines":["..."]}]}'
)

PLANNER_SYSTEM = (
    "Kamu menyusun urutan sesi latihan membaca untuk setiap kelompok selama beberapa minggu. "
    "Kamu HANYA boleh memilih activityId dan passageIds dari katalog yang diberikan untuk tingkat kelompok itu; "
    "jangan membuat kegiatan atau bacaan baru, dan jangan memilih waktu atau hari. "
    "Setiap kelompok mendapat sesi latihan per minggu dalam batas menit mingguan (weeklyMinutes) "
    "dan satu sesi penempatan ulang pada minggu terakhir: {\"week\": <minggu terakhir>, \"kind\": \"replacement\"}. "
    "Jangan menulis tingkat baru, peringkat, atau kata diagnosis. "
    'Balas hanya JSON: {"groups":[{"level":"...","sessions":[{"week":1,"kind":"practice","activityId":"...","passageIds":["..."],"minutes":15,"focus":"..."}]}]}'
)

# Phrases that would move a child or group to another level. The value is dropped, never used.
LEVEL_MOVE = re.compile(r"\b(naik|turun|pindah|dipindah|dinaikkan|diturunkan|promosi)\b[^.]*\b(tingkat|level|kelompok)\b", re.I)


def _num(x) -> str:
    """Indonesian number formatting: 3,5 not 3.5."""
    if x is None:
        return "-"
    return str(round(x, 1)).replace(".", ",").removesuffix(",0")


def mock_evidence(group: dict) -> list[str]:
    lines = [f"Kelompok {group['name']}: {group['size']} anak."]
    if group["medianSessions"] is not None and group["medianSessions"] > 0:
        lines[0] = f"Kelompok {group['name']}: {group['size']} anak, tengah {_num(group['medianSessions'])} sesi latihan."
    else:
        lines.append("Belum ada sesi latihan yang tercatat untuk kelompok ini.")
    change = group["medianWcpmChange"]
    if change is not None:
        verb = "naik" if change > 0 else "turun" if change < 0 else "tetap"
        lines.append(f"Kata benar per menit dari bacaan pertama ke ketiga {verb}" + (f" {_num(abs(change))} kata ({group['wcpmReaders']} anak)." if change else f" ({group['wcpmReaders']} anak)."))
    if group["topReadBackWords"]:
        lines.append("Kata yang sering dibaca ulang: " + ", ".join(group["topReadBackWords"][:4]) + ".")
    return lines[:3]


def summarize(groups: list[dict]) -> dict:
    """-> {lines: {level: [str]}, discarded: [..], writtenBy: str}"""
    if not llm.available():
        by = "mock" if llm.inference_mode() == "mock" else "replay"
        return {"lines": {g["level"]: mock_evidence(g) for g in groups}, "discarded": [], "writtenBy": by}

    facts = [{k: g[k] for k in ("level", "name", "size", "medianSessions", "medianWcpmChange", "wcpmReaders", "topReadBackWords", "lastCycle")} for g in groups]
    raw = llm.complete_json(EVIDENCE_SYSTEM, {"groups": facts})
    lines: dict[str, list[str]] = {}
    discarded: list[dict] = []
    if raw and isinstance(raw.get("groups"), list):
        for item in raw["groups"]:
            if not isinstance(item, dict):
                continue
            level = item.get("level")
            extra = set(item) - {"level", "lines"}
            for key in extra:
                discarded.append({"level": level, "field": key, "reason": "Agen tidak boleh menulis kolom ini; nilainya dibuang."})
            if level not in {g["level"] for g in groups}:
                discarded.append({"level": level, "field": "level", "reason": "Tingkat dari agen dibuang; tingkat hanya dari konfirmasi guru."})
                continue
            kept = []
            for line in item.get("lines") or []:
                if not isinstance(line, str):
                    continue
                hits = contains_banned(line)
                if hits:
                    discarded.append({"level": level, "line": line, "reason": "Kata terlarang: " + ", ".join(hits)})
                elif LEVEL_MOVE.search(line) or "%" in line:
                    discarded.append({"level": level, "line": line, "reason": "Menyarankan perpindahan tingkat atau memakai persen."})
                else:
                    kept.append(line)
            lines[level] = kept[:3]
    written_by = "gemini"
    for g in groups:
        if not lines.get(g["level"]):
            lines[g["level"]] = mock_evidence(g)
            written_by = "gemini (sebagian cadangan)"
    return {"lines": lines, "discarded": discarded, "writtenBy": written_by}


def plan(groups: list[dict], evidence: dict, weeks: list[int], budgets: dict[str, dict[int, int]], repair: list[dict] | None = None, carry: dict[str, int] | None = None, skip_replacement: set[str] | None = None) -> dict:
    """-> {sessions: {level: [session dicts]}, discarded: [..], plannedBy: str}"""
    skip_replacement = skip_replacement or set()
    if not llm.available():
        by = "mock (rencana dasar)" if llm.inference_mode() == "mock" else "replay"
        return {"sessions": default_plan(groups, weeks, budgets, carry, skip_replacement), "discarded": [], "plannedBy": by}

    payload = {
        "weeks": weeks,
        "lastWeek": weeks[-1],
        "groups": [
            {
                "level": g["level"],
                "size": g["size"],
                "evidence": evidence.get(g["level"], []),
                "weeklyMinutes": {str(w): budgets[g["level"]].get(w, 0) for w in weeks},
                "catalog": library.catalog_for(g["level"]),
                "needsReplacement": g["level"] not in skip_replacement,
            }
            for g in groups
        ],
    }
    if repair:
        payload["repair"] = repair
    raw = llm.complete_json(PLANNER_SYSTEM, payload)
    sessions: dict[str, list[dict]] = {}
    discarded: list[dict] = []
    known = {g["level"] for g in groups}
    if raw and isinstance(raw.get("groups"), list):
        for item in raw["groups"]:
            level = item.get("level") if isinstance(item, dict) else None
            if level not in known:
                discarded.append({"level": level, "reason": "Tingkat dari agen dibuang."})
                continue
            out = []
            for s in item.get("sessions") or []:
                if isinstance(s, dict):
                    out.append({
                        "week": s.get("week"),
                        "kind": s.get("kind", "practice"),
                        "activityId": s.get("activityId"),
                        "passageIds": s.get("passageIds") or [],
                        "minutes": s.get("minutes"),
                        "focus": s.get("focus") or "",
                    })
            sessions[level] = out
    return {"sessions": sessions, "discarded": discarded, "plannedBy": "gemini"}


def default_plan(groups: list[dict], weeks: list[int], budgets: dict[str, dict[int, int]], carry: dict[str, int] | None = None, skip_replacement: set[str] | None = None, offsets: dict[str, int] | None = None) -> dict[str, list[dict]]:
    """The rule-based default plan for every group. Valid by construction."""
    from .calendar_slots import replacement_minutes

    carry = carry or {}
    skip_replacement = skip_replacement or set()
    offsets = offsets or {}
    out: dict[str, list[dict]] = {}
    last = weeks[-1]
    for g in groups:
        level = g["level"]
        need = replacement_minutes(g["size"])
        reserve = {} if level in skip_replacement else {last: need}
        sessions = [dict(s, kind="practice") for s in library.default_sessions(level, weeks, budgets[level], reserve, carry.get(level, 0), offsets.get(level, 0))]
        if level not in skip_replacement:
            sessions.append({"week": last, "kind": "replacement", "activityId": None, "passageIds": [], "minutes": need, "focus": "Penempatan ulang"})
        out[level] = sessions
    return out
