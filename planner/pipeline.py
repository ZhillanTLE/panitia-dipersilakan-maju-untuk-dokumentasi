"""
The pipeline: Intake -> Evidence Summarizer -> Planner -> Checker -> Scheduler, in one synchronous request.
Every stage appends to `trace` with its real start time and measured duration. Nothing is simulated.
"""
from __future__ import annotations

import datetime as dt
import time

from . import agents, checker, config, intake as intake_mod, llm, scheduler
from .calendar_slots import replacement_minutes, weekly_minutes
from .timeutil import week_start


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


class _Stage:
    def __init__(self, trace: list, name: str):
        self.trace, self.name = trace, name
        self.entry = {"stage": name, "status": "running", "startedAt": _now()}
        self.t0 = time.perf_counter()
        trace.append(self.entry)

    def done(self, status="done", **fields):
        self.entry["status"] = status
        self.entry["ms"] = round((time.perf_counter() - self.t0) * 1000)
        self.entry.update(fields)


def _plan_id(payload: dict) -> str:
    return f"plan-{payload['class']['code']}-{payload['class']['startDate']}"


def _mode() -> dict:
    return {"inference": llm.inference_mode(), "data": "synced"}


def run(payload: dict, replan: dict | None = None) -> dict:
    """
    Full run (stages 0-4). With `replan` = {fromDate, previous: {plan, calendar}, done: [ids], replacedGroups: [levels]}
    it re-runs stages 2-4 for the remaining weeks only, keeping completed sessions fixed.
    """
    llm.require_configured()
    trace: list[dict] = []
    cls = payload.get("class", {}) if isinstance(payload, dict) else {}

    st = _Stage(trace, "intake")
    info = intake_mod.intake(payload)  # PayloadError is for the route to report
    groups = info["groups"]
    st.done(summary=f"{len(groups)} kelompok, {info['students']} anak", groups=[{"level": g["level"], "size": g["size"]} for g in groups])

    cycle = cls["cycleWeeks"]
    start = dt.date.fromisoformat(cls["startDate"])
    all_weeks = list(range(1, cycle + 1))
    skip: set[str] = set()
    carry: dict[str, int] = {}
    fixed_events: list[dict] = []
    fixed_sessions: dict[str, list[dict]] = {}
    not_before = None
    offsets: dict[str, int] = {}
    weeks = all_weeks
    prev_evidence = None

    if replan:
        from_date = dt.date.fromisoformat(replan["fromDate"])
        not_before = from_date.isoformat()
        weeks = [w for w in all_weeks if week_start(start, w) + dt.timedelta(days=6) >= from_date]
        if not weeks:
            raise intake_mod.PayloadError(["Siklus sudah berakhir; tidak ada minggu tersisa untuk direncanakan ulang."])
        done_ids = set(replan.get("done") or [])
        skip = set(replan.get("replacedGroups") or [])
        prev_cal = replan["previous"]["calendar"]["events"]
        prev_plan = replan["previous"]["plan"]
        prev_evidence = {g["level"]: g.get("evidence", []) for g in prev_plan["groups"]}
        for e in prev_cal:
            if e["id"] in done_ids:
                fixed_events.append(e)
            elif e["date"] < from_date.isoformat() and e["kind"] == "practice":
                carry[e["groupLevel"]] = carry.get(e["groupLevel"], 0) + 1
        for g in prev_plan["groups"]:
            fixed_sessions[g["level"]] = [s for s in g["sessions"] if s["id"] in done_ids]
            offsets[g["level"]] = sum(1 for s in g["sessions"] if s["kind"] == "practice" and (s["id"] in done_ids or any(e["id"] == s["id"] and e["date"] < from_date.isoformat() for e in prev_cal)))

    # Time budget per group per week: the phone-minutes on offer, shared evenly between groups.
    totals = weekly_minutes(payload, weeks, not_before)
    # Done sessions already use up part of the remaining time in their own week.
    for e in fixed_events:
        if e["week"] in totals and e["date"] >= (not_before or ""):
            totals[e["week"]] = max(0, totals[e["week"]] - e["minutes"])
    budgets = {g["level"]: {w: totals[w] // len(groups) for w in weeks} for g in groups}

    # Stage 1 -- Evidence Summarizer
    if replan:
        st = _Stage(trace, "evidence")
        st.done(status="reused", summary="Bukti dari rencana sebelumnya dipakai ulang.", lines=prev_evidence, discarded=[], writtenBy="rencana sebelumnya")
        evidence = prev_evidence
    else:
        st = _Stage(trace, "evidence")
        ev = agents.summarize(groups)
        evidence = ev["lines"]
        st.done(
            summary=f"{sum(len(v) for v in evidence.values())} baris bukti",
            lines=evidence,
            discarded=ev["discarded"],
            writtenBy=ev["writtenBy"],
        )

    # Stages 2 and 3 -- Planner and Checker, with repair and fallback
    st_plan = _Stage(trace, "planner")
    attempts = 1
    out = agents.plan(groups, evidence, weeks, budgets, None, carry, skip)
    sessions = checker.normalise(out["sessions"], groups)
    st_plan.done(summary=f"{sum(len(v) for v in sessions.values())} sesi untuk {len(groups)} kelompok", attempts=attempts, plannedBy=out["plannedBy"], discarded=out["discarded"])

    st_check = _Stage(trace, "checker")
    failures = checker.check(sessions, groups, weeks, budgets, skip)
    first_failures = list(failures)
    fallback = False
    while failures and attempts <= config.REPAIR_ATTEMPTS:
        attempts += 1
        out = agents.plan(groups, evidence, weeks, budgets, failures, carry, skip)
        sessions = checker.normalise(out["sessions"], groups)
        failures = checker.check(sessions, groups, weeks, budgets, skip)
    if failures:
        fallback = True
        sessions = agents.default_plan(groups, weeks, budgets, carry, skip, offsets)
        reason = f"Pemeriksaan gagal setelah {attempts - 1} perbaikan; memakai rencana dasar berbasis aturan."
    else:
        reason = None
    st_plan.entry["attempts"] = attempts
    if fallback:
        st_plan.entry["plannedBy"] = "rencana dasar (cadangan)"
    st_check.done(
        status="fallback" if fallback else "done",
        summary="Rencana dasar dipakai." if fallback else f"{sum(len(v) for v in sessions.values())} sesi lolos pemeriksaan",
        failures=first_failures,
        fallbackUsed=fallback,
        fallbackReason=reason,
    )

    # Plan with stable session ids
    plan_groups = []
    flat: list[dict] = []
    for g in groups:
        level = g["level"]
        mine = []
        counters = {"practice": len(fixed_sessions.get(level, [])), "replacement": 0}
        for s in fixed_sessions.get(level, []):
            mine.append(s)
        for s in sessions[level]:
            counters[s["kind"]] = counters.get(s["kind"], 0) + 1
            sid = f"{level}-w{s['week']}-{s['kind'][0]}{counters[s['kind']]}"
            item = {
                "id": sid, "week": s["week"], "kind": s["kind"], "activityId": s["activityId"],
                "passageIds": s["passageIds"], "minutes": s["minutes"], "focus": s["focus"],
            }
            if s["kind"] == "replacement":
                item["students"] = g["students"]
            mine.append(item)
            flat.append({**item, "planSessionId": sid, "groupLevel": level})
        plan_groups.append({"level": level, "name": g["name"], "size": g["size"], "students": g["students"], "evidence": evidence.get(level, []), "sessions": mine})

    # Stage 4 -- Scheduler
    st = _Stage(trace, "scheduler")
    cal = scheduler.schedule(payload, flat, weeks, fixed_events, not_before)
    st.done(
        summary=f"{len(cal['events'])} sesi terjadwal, {len(cal['unscheduled'])} belum muat",
        unscheduled=cal["unscheduled"],
    )
    cal["events"] = sorted(fixed_events + cal["events"], key=lambda e: (e["date"], e["start"], e["lane"]))

    plan = {
        "id": _plan_id(payload),
        "classCode": cls["code"],
        "startDate": cls["startDate"],
        "cycleWeeks": cycle,
        "weeksPlanned": weeks,
        "groups": plan_groups,
        "levelsAtStart": (replan or {}).get("previous", {}).get("plan", {}).get("levelsAtStart") or {s["code"]: s["confirmedLevel"] for s in payload["students"]},
        "wcpmUnseenStart": (replan or {}).get("previous", {}).get("plan", {}).get("wcpmUnseenStart") or {s["code"]: s["wcpmUnseen"] for s in payload["students"] if s.get("wcpmUnseen") is not None},
        "phones": cls["phones"],
        "timetable": payload["timetable"],
        "holidays": cls.get("holidays") or [],
    }
    return {"mode": _mode(), "trace": trace, "plan": plan, "calendar": cal}
