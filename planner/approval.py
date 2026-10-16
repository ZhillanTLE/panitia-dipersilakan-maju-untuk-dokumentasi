"""
Stage 5: the teacher's edits are checked again in code before anything is saved or queued for the phone.
The teacher may move or delete sessions; she may not break the timetable or the phone count.
"""
from __future__ import annotations

import datetime as dt

from . import config, store
from .calendar_slots import slots_for
from .scheduler import _mins
from .timeutil import day_name


def validate_events(events: list[dict], plan: dict, draft_events: list[dict]) -> list[str]:
    problems: list[str] = []
    known = {e["id"] for e in draft_events} | {s["id"] for g in plan["groups"] for s in g["sessions"]}
    payload_like = {
        "class": {"startDate": plan["startDate"], "holidays": plan["holidays"], "phones": plan["phones"]},
        "timetable": plan["timetable"],
    }
    weeks = list(range(1, plan["cycleWeeks"] + 1))
    slots = slots_for(payload_like, weeks)
    seen: set[str] = set()
    for e in events:
        if e.get("id") not in known:
            problems.append(f"Sesi tidak dikenal: {e.get('id')}")
            continue
        if e["id"] in seen:
            problems.append(f"Sesi ganda: {e['id']}")
        seen.add(e["id"])
        try:
            date = dt.date.fromisoformat(e["date"])
            a, b = _mins(e["start"]), _mins(e["end"])
        except (ValueError, KeyError):
            problems.append(f"{e['id']}: tanggal atau jam tidak valid.")
            continue
        if b - a != e.get("minutes"):
            problems.append(f"{e['id']}: durasi harus {e.get('minutes')} menit.")
        if day_name(date) != e.get("day"):
            problems.append(f"{e['id']}: hari tidak cocok dengan tanggal.")
        if not any(s["date"] == e["date"] and s["start"] <= a and b <= s["end"] for s in slots):
            problems.append(f"{e['id']}: di luar jam literasi atau pada hari libur.")
        if e.get("kind") == "replacement" and not any(s["week"] == weeks[-1] and s["date"] == e["date"] for s in slots):
            problems.append(f"{e['id']}: penempatan ulang harus di minggu terakhir.")
    # Phone count: at no moment may more sessions run than there are phones; a group never runs twice.
    phones = plan["phones"]
    for i, x in enumerate(events):
        for y in events[i + 1:]:
            if x.get("date") != y.get("date"):
                continue
            try:
                overlap = _mins(x["start"]) < _mins(y["end"]) and _mins(y["start"]) < _mins(x["end"])
            except (KeyError, ValueError):
                continue
            if overlap and x.get("groupLevel") == y.get("groupLevel"):
                problems.append(f"{x['id']} dan {y['id']}: kelompok yang sama tidak bisa berlatih bersamaan.")
    by_date: dict[str, list[dict]] = {}
    for e in events:
        by_date.setdefault(e.get("date", ""), []).append(e)
    for date, items in by_date.items():
        for e in items:
            try:
                a, b = _mins(e["start"]), _mins(e["end"])
                at = [x for x in items if _mins(x["start"]) < b and a < _mins(x["end"])]
            except (KeyError, ValueError):
                continue
            if len(at) > phones:
                problems.append(f"{date}: lebih banyak sesi bersamaan ({len(at)}) daripada jumlah ponsel ({phones}).")
                break
    return list(dict.fromkeys(problems))


def approve(class_code: str, plan_id: str, events: list[dict]) -> dict:
    state = store.load(class_code)
    draft = state.get("draft")
    if not draft or draft["plan"]["id"] != plan_id:
        raise LookupError("Tidak ada draf rencana dengan id itu. Jalankan rencana lagi.")
    problems = validate_events(events, draft["plan"], draft["calendar"]["events"])
    if problems:
        raise ValueError("; ".join(problems))
    approved_at = store._now()
    state["approved"] = {
        "plan": draft["plan"],
        "calendar": {"events": events, "unscheduled": draft["calendar"]["unscheduled"]},
        "approvedAt": approved_at,
        "queuedForPhone": True,
        "syncedToPhoneAt": None,
    }
    store.save(class_code, state)
    return {"approvedAt": approved_at, "queuedForPhone": True, "events": len(events)}


def phone_pull(class_code: str) -> dict:
    """What the phone fetches on its next sync. Marks the calendar as delivered."""
    state = store.load(class_code)
    approved = state.get("approved")
    if not approved:
        return {"approved": False}
    approved["queuedForPhone"] = False
    approved["syncedToPhoneAt"] = store._now()
    store.save(class_code, state)
    return {"approved": True, "planId": approved["plan"]["id"], "events": approved["calendar"]["events"], "approvedAt": approved["approvedAt"]}
