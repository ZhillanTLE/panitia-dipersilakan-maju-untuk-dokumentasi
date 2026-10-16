"""
The two agents: Evidence Summarizer and Planner.

They write evidence lines and choose activity and passage IDs. They never place a time, never set or
move a level, never write a metric, never rank, and never diagnose. This module only keeps the fields
an agent may write (config.AGENT_FIELDS) and logs the rest as discarded; the content rules, including
"every number matches the facts", are the Checker's (checker.check_evidence, checker.check). In mock
mode the same functions run without a model and say so in `writtenBy` / `plannedBy`, so rule-built
text is never mistaken for model output.
"""
from __future__ import annotations

from . import config, library, llm
from .calendar_slots import replacement_minutes

EVIDENCE_SYSTEM = (
    "Kamu merangkum bukti bacaan satu kelas untuk guru SD di Indonesia. "
    "Untuk setiap kelompok (sudah dikelompokkan berdasarkan tingkat yang dikonfirmasi guru), tulis 1 sampai 3 kalimat "
    "bahasa Indonesia sederhana. Setiap angka yang kamu tulis HARUS persis salah satu angka di data kelompok itu "
    "(atau jumlah murid dan jumlah kelompok di data kelas); jangan menghitung angka baru, jangan membulatkan, jangan menjumlahkan. "
    "Pakai kata, bukan angka, untuk urutan bacaan (bacaan pertama, bacaan ketiga). "
    "Sebut pola kesalahan dengan label yang diberikan dan contoh katanya, misalnya: "
    "'Kelompok Suku Kata: 7 anak, 5 di antaranya keliru pada suku kata tertutup (contoh: ban, sar, tum).' "
    "'Nilai tengah' berarti median. 'unitName' adalah satuan kelompok itu (huruf, suku kata, atau kata); "
    "jangan membandingkan satuan yang berbeda. Arti kolom: size = jumlah anak; accuracy = nilai tengah benar dari jumlah item "
    "di kartu asesmen; correctUnitsPerMinute = kecepatan pada kartu asesmen (bacaan yang belum pernah dilihat), bukan latihan; "
    "patterns[].children = jumlah anak yang keliru pada pola itu; patterns[].count = jumlah kata keliru pada pola itu; "
    "patterns[].examples = contoh kata (bukan jumlah); practice = bacaan latihan, bacaan pertama dan ketiga; "
    "comprehension = jawaban benar dari pertanyaan lisan setelah paragraf. Pakai setiap angka sesuai artinya. "
    "Tulis desimal dengan koma, misalnya 2,5. "
    "ATURAN: jangan menyebut atau menyarankan tingkat baru, jangan membandingkan atau mengurutkan anak atau kelompok, "
    "jangan menyebut kode murid, jangan memakai kata diagnosis atau gangguan, jangan memakai persen. "
    "Jika ada 'repair', tulis ulang kalimat untuk kelompok itu dan hindari kesalahan yang disebut. "
    'Balas hanya JSON: {"groups":[{"level":"<level kelompok persis seperti diberikan>","lines":["..."]}]}'
)

PLANNER_SYSTEM = (
    "Kamu menyusun urutan sesi latihan membaca untuk setiap kelompok selama beberapa minggu. "
    "Kamu HANYA boleh memilih activityId dan passageIds dari katalog yang diberikan untuk tingkat kelompok itu; "
    "jangan membuat kegiatan atau bacaan baru, dan jangan memilih waktu atau hari. "
    "Setiap sesi latihan punya 'focus': id pola dari daftar 'patterns' kelompok itu (misalnya closed_syllable). "
    "Sesi pertama kelompok harus melatih salah satu pola di 'topPatterns'. Bila 'patterns' kosong, focus null. "
    "Pilih kegiatan yang 'patterns'-nya memuat focus bila ada, dan bacaan dari 'passagesByPattern' untuk focus itu bila ada. "
    "Jumlah menit sesi latihan sebuah kelompok dalam satu minggu tidak boleh melebihi practiceMinutes minggu itu; menit sesi sama dengan menit kegiatannya. "
    "Bila tidak ada kegiatan yang muat, jangan beri sesi latihan pada minggu itu. "
    "Bila needsReplacement true, tambahkan satu sesi penempatan ulang pada minggu terakhir: {\"week\": <minggu terakhir>, \"kind\": \"replacement\"}. "
    "Jangan menulis tingkat baru, angka bacaan, peringkat, atau kata diagnosis. "
    "Jika ada 'repair', perbaiki kesalahan yang disebut. "
    'Balas hanya JSON: {"groups":[{"level":"...","sessions":[{"week":1,"kind":"practice","activityId":"...","passageIds":["..."],"minutes":15,"focus":"closed_syllable"}]}]}'
)


def _num(x) -> str:
    """Indonesian number formatting: 3,5 not 3.5."""
    if x is None:
        return "-"
    return str(round(x, 1)).replace(".", ",").removesuffix(",0")


def rule_evidence(group: dict) -> list[str]:
    """Evidence lines built by rules from the stage-0 facts. Every number in them is a fact, by construction."""
    name, unit = group["name"], group["unitName"]
    lines = []
    top = group["patterns"][0] if group["patterns"] else None
    if top:
        ex = f" (contoh: {', '.join(top['examples'])})" if top["examples"] else ""
        who = "semuanya" if top["children"] == group["size"] else f"{top['children']} di antaranya"
        lines.append(f"Kelompok {name}: {group['size']} anak, {who} keliru pada pola {top['label'].lower()}{ex}.")
    else:
        lines.append(f"Kelompok {name}: {group['size']} anak, belum ada pola kesalahan yang berulang.")
    acc = group["accuracy"]
    line = f"Nilai tengah ketepatan: {_num(acc['medianCorrect'])} dari {_num(acc['medianAttempted'])} {unit} benar"
    if group["correctUnitsPerMinute"]:
        line += f", {_num(group['correctUnitsPerMinute']['median'])} {unit} benar per menit"
    lines.append(line + ".")
    comp, practice = group["comprehension"], group["practice"]
    if comp:
        lines.append(f"Pemahaman paragraf: nilai tengah {_num(comp['medianCorrect'])} dari {_num(comp['medianAsked'])} pertanyaan dijawab benar ({comp['children']} anak).")
    elif practice["children"]:
        change = practice["medianChange"]
        verb = "naik" if change > 0 else "turun" if change < 0 else "tetap"
        lines.append(f"Kecepatan baca saat latihan {verb} dari bacaan pertama ke bacaan ketiga ({practice['children']} anak).")
    elif len(group["patterns"]) > 1:
        other = group["patterns"][1]
        lines.append(f"Pola lain: {other['label'].lower()} ({other['children']} anak).")
    return lines[:3]


def summarize(groups: list[dict], facts: dict[str, dict], class_facts: dict, repair: list[dict] | None = None) -> dict:
    """-> {lines: {level: [str]}, discarded: [..], writtenBy: str}. Lines are unchecked; the Checker checks them."""
    if not llm.available():
        by = "aturan (mode uji coba)" if llm.inference_mode() == "mock" else "replay"
        return {"lines": {g["level"]: rule_evidence(g) for g in groups}, "discarded": [], "writtenBy": by}

    payload: dict = {"class": class_facts, "groups": [facts[g["level"]] for g in groups]}
    if repair:
        payload["repair"] = repair
    raw = llm.complete_json(EVIDENCE_SYSTEM, payload)
    lines: dict[str, list[str]] = {}
    discarded: list[dict] = []
    known = {g["level"] for g in groups}
    if raw and isinstance(raw.get("groups"), list):
        for item in raw["groups"]:
            if not isinstance(item, dict):
                continue
            level = item.get("level")
            for key in set(item) - config.AGENT_FIELDS["evidence"]:
                discarded.append({"level": level, "field": key, "rule": "field", "reason": "Agen tidak boleh menulis kolom ini; nilainya dibuang."})
            if level not in known:
                discarded.append({"level": level, "field": "level", "rule": "level", "reason": "Tingkat dari agen dibuang; tingkat hanya dari konfirmasi guru."})
                continue
            lines[level] = [line for line in item.get("lines") or [] if isinstance(line, str)]
    return {"lines": lines, "discarded": discarded, "writtenBy": "gemini"}


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
                "unit": g["unit"],
                "evidence": evidence.get(g["level"], []),
                "patterns": [{"id": p["id"], "label": p["label"], "children": p["children"], "count": p["count"]} for p in g["patterns"]],
                "topPatterns": g["topPatterns"],
                "weeklyMinutes": {str(w): budgets[g["level"]].get(w, 0) for w in weeks},
                # What is left for practice once re-placement has its minutes; the Checker holds the plan to this.
                "practiceMinutes": {
                    str(w): max(0, budgets[g["level"]].get(w, 0) - (replacement_minutes(g["size"]) if w == weeks[-1] and g["level"] not in skip_replacement else 0))
                    for w in weeks
                },
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
                discarded.append({"level": level, "rule": "level", "reason": "Tingkat dari agen dibuang."})
                continue
            out = []
            for s in item.get("sessions") or []:
                if not isinstance(s, dict):
                    continue
                for key in set(s) - config.AGENT_FIELDS["planner"]:
                    discarded.append({"level": level, "field": key, "rule": "field", "reason": "Agen tidak boleh menulis kolom ini; nilainya dibuang."})
                out.append({
                    "week": s.get("week"),
                    "kind": s.get("kind", "practice"),
                    "activityId": s.get("activityId"),
                    "passageIds": s.get("passageIds") or [],
                    "minutes": s.get("minutes"),
                    "focus": s.get("focus") or None,
                })
            sessions[level] = out
    return {"sessions": sessions, "discarded": discarded, "plannedBy": "gemini"}


def default_plan(groups: list[dict], weeks: list[int], budgets: dict[str, dict[int, int]], carry: dict[str, int] | None = None, skip_replacement: set[str] | None = None, offsets: dict[str, int] | None = None) -> dict[str, list[dict]]:
    """The rule-based default plan for every group, each targeting its single most frequent pattern. Valid by construction."""
    carry = carry or {}
    skip_replacement = skip_replacement or set()
    offsets = offsets or {}
    out: dict[str, list[dict]] = {}
    last = weeks[-1]
    for g in groups:
        level = g["level"]
        focus = g["topPatterns"][0] if g["topPatterns"] else None
        need = replacement_minutes(g["size"])
        reserve = {} if level in skip_replacement else {last: need}
        sessions = [dict(s, kind="practice") for s in library.default_sessions(level, focus, weeks, budgets[level], reserve, carry.get(level, 0), offsets.get(level, 0))]
        if level not in skip_replacement:
            sessions.append({"week": last, "kind": "replacement", "activityId": None, "passageIds": [], "minutes": need, "focus": None})
        out[level] = sessions
    return out
