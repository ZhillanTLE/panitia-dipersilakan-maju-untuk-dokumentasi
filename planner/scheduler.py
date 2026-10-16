"""
Stage 4: the Scheduler. A small deterministic solver; no model is ever called from here.

Agents choose what to teach; this decides when. Constraints:
  - `phones` lanes per slot, so no more groups practise at the same moment than there are phones
  - a group never overlaps itself
  - holidays skipped (the slots come from calendar_slots, which already drops them)
  - a group's sessions spread over different days of the week where it can
  - the re-placement session goes in the final week, as late as it fits
What does not fit goes on the `unscheduled` list with a reason.
"""
from __future__ import annotations

from . import config
from .calendar_slots import slots_for
from .timeutil import to_hhmm


def _free_start(busy: list[tuple[int, int]], start: int, end: int, minutes: int):
    """Earliest start inside [start, end] that clears every busy interval, or None."""
    t = start
    for b0, b1 in sorted(busy):
        if t + minutes <= b0:
            break
        t = max(t, b1)
    return t if t + minutes <= end else None


def _latest_start(busy: list[tuple[int, int]], start: int, end: int, minutes: int):
    t = end - minutes
    for b0, b1 in sorted(busy, reverse=True):
        if t >= b1:
            break
        t = min(t, b0 - minutes)
    return t if t >= start else None


class _Board:
    def __init__(self, payload: dict, weeks: list[int], not_before: str | None):
        self.phones = payload["class"]["phones"]
        self.slots = slots_for(payload, weeks, not_before)
        for k, s in enumerate(self.slots):
            s["id"] = k
            s["lanes"] = [[] for _ in range(self.phones)]
        self.group_busy: dict[tuple[str, str], list[tuple[int, int]]] = {}

    def reserve(self, event: dict) -> bool:
        """Marks a fixed (already done) event as busy. Returns False if no slot holds it."""
        a, b = _mins(event["start"]), _mins(event["end"])
        for slot in self.slots:
            if slot["date"] == event["date"] and slot["start"] <= a and b <= slot["end"]:
                lane = min(range(self.phones), key=lambda L: len([1 for x0, x1 in slot["lanes"][L] if x0 < b and a < x1]))
                slot["lanes"][lane].append((a, b))
                self.group_busy.setdefault((event["groupLevel"], event["date"]), []).append((a, b))
                return True
        return False

    def try_place(self, slot: dict, level: str, minutes: int, latest: bool):
        group = self.group_busy.get((level, slot["date"]), [])
        best = None
        for lane in range(self.phones):
            busy = slot["lanes"][lane]
            # Candidate starts must clear this lane and the group's own sessions that day.
            merged = busy + group
            t = (_latest_start if latest else _free_start)(merged, slot["start"], slot["end"], minutes)
            if t is None:
                continue
            if best is None or (t > best[0] if latest else t < best[0]):
                best = (t, lane)
        return best

    def commit(self, slot: dict, lane: int, level: str, start: int, minutes: int):
        slot["lanes"][lane].append((start, start + minutes))
        self.group_busy.setdefault((level, slot["date"]), []).append((start, start + minutes))


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def schedule(payload: dict, sessions: list[dict], weeks: list[int], fixed_events: list[dict] | None = None, not_before: str | None = None) -> dict:
    """
    sessions: [{planSessionId, groupLevel, kind, week, minutes, activityId, passageIds, focus, students?}]
    -> {events: [...], unscheduled: [...]}
    """
    board = _Board(payload, weeks, not_before)
    for e in fixed_events or []:
        board.reserve(e)

    events: list[dict] = []
    unscheduled: list[dict] = []
    last = weeks[-1]
    used_days: dict[tuple[str, int], set[str]] = {}

    def make(session, slot, lane, start):
        events.append({
            "id": session["planSessionId"],
            "planSessionId": session["planSessionId"],
            "groupLevel": session["groupLevel"],
            "kind": session["kind"],
            "week": slot["week"],
            "date": slot["date"],
            "day": slot["day"],
            "start": to_hhmm(start),
            "end": to_hhmm(start + session["minutes"]),
            "minutes": session["minutes"],
            "lane": lane,
            "activityId": session.get("activityId"),
            "passageIds": session.get("passageIds") or [],
            "focus": session.get("focus"),
            "tip": session.get("tip") or "",
            "students": session.get("students") or [],
        })

    def fail(session, reason):
        unscheduled.append({
            "planSessionId": session["planSessionId"],
            "groupLevel": session["groupLevel"],
            "kind": session["kind"],
            "week": session["week"],
            "minutes": session["minutes"],
            "activityId": session.get("activityId"),
            "passageIds": session.get("passageIds") or [],
            "focus": session.get("focus"),
            "tip": session.get("tip") or "",
            "students": session.get("students") or [],
            "reason": reason,
        })

    # Re-placement first: it has the tightest rule (final week), so practice cannot crowd it out.
    for s in [s for s in sessions if s["kind"] == "replacement"]:
        placed = False
        for slot in reversed([x for x in board.slots if x["week"] == last]):
            found = board.try_place(slot, s["groupLevel"], s["minutes"], latest=True)
            if found:
                board.commit(slot, found[1], s["groupLevel"], found[0], s["minutes"])
                make(s, slot, found[1], found[0])
                placed = True
                break
        if not placed:
            fail(s, f"Tidak ada slot literasi yang muat untuk penempatan ulang di minggu {last}.")

    # Practice: round-robin over groups, so one group does not take the best slots of a week.
    practice = [s for s in sessions if s["kind"] == "practice"]
    by_group: dict[str, list[dict]] = {}
    for s in practice:
        by_group.setdefault(s["groupLevel"], []).append(s)
    order: list[dict] = []
    for week in weeks:
        queues = {lvl: [s for s in lst if s["week"] == week] for lvl, lst in by_group.items()}
        while any(queues.values()):
            for lvl in config.LEVELS:
                if queues.get(lvl):
                    order.append(queues[lvl].pop(0))

    for s in order:
        options = []
        for slot in board.slots:
            if slot["week"] != s["week"]:
                continue
            found = board.try_place(slot, s["groupLevel"], s["minutes"], latest=False)
            if found:
                same_day = slot["date"] in used_days.get((s["groupLevel"], s["week"]), set())
                options.append((same_day, slot["date"], found[0], slot, found[1]))
        if not options:
            has_slot = any(x["week"] == s["week"] for x in board.slots)
            fail(s, f"Slot literasi minggu {s['week']} sudah penuh." if has_slot else f"Tidak ada slot literasi di minggu {s['week']}.")
            continue
        options.sort(key=lambda o: o[:3])
        _, _, start, slot, lane = options[0]
        board.commit(slot, lane, s["groupLevel"], start, s["minutes"])
        used_days.setdefault((s["groupLevel"], s["week"]), set()).add(slot["date"])
        make(s, slot, lane, start)

    events.sort(key=lambda e: (e["date"], e["start"], e["lane"]))
    return {"events": events, "unscheduled": unscheduled}
