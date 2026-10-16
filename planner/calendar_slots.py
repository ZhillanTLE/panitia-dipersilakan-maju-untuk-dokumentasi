"""Expands the weekly timetable into concrete dated slots for the weeks being planned."""
from __future__ import annotations

import datetime as dt

from . import config
from .timeutil import day_name, to_min, week_start


def slots_for(payload: dict, weeks: list[int], not_before: str | None = None) -> list[dict]:
    cls = payload["class"]
    start = dt.date.fromisoformat(cls["startDate"])
    floor = dt.date.fromisoformat(not_before) if not_before else start
    holidays = set(cls.get("holidays") or [])
    out = []
    for week in weeks:
        monday = week_start(start, week)
        for k in range(7):
            date = monday + dt.timedelta(days=k)
            if date < max(start, floor) or date.isoformat() in holidays:
                continue
            for slot in payload["timetable"]:
                if slot["day"] == day_name(date):
                    out.append({
                        "week": week,
                        "date": date.isoformat(),
                        "day": slot["day"],
                        "start": to_min(slot["start"]),
                        "end": to_min(slot["end"]),
                    })
    out.sort(key=lambda s: (s["date"], s["start"]))
    return out


def weekly_minutes(payload: dict, weeks: list[int], not_before: str | None = None) -> dict[int, int]:
    """Phone-minutes on offer per week, holidays removed."""
    phones = payload["class"]["phones"]
    totals = {w: 0 for w in weeks}
    for slot in slots_for(payload, weeks, not_before):
        totals[slot["week"]] += (slot["end"] - slot["start"]) * phones
    return totals


def replacement_minutes(size: int) -> int:
    return max(config.REPLACEMENT_MIN_MINUTES, size * config.REPLACEMENT_MINUTES_PER_CHILD)
