"""
End-of-cycle report. Counts only, never percentages; each child compared only with their own earlier
result; groups in level order, never sorted by score. There is no class ranking and no view of
lowest performers.
"""
from __future__ import annotations

from . import config, intake as intake_mod


def build(payload: dict, plan: dict, calendar: dict) -> dict:
    problems = intake_mod.validate(payload)
    if problems:
        raise intake_mod.PayloadError(problems)
    start = plan["levelsAtStart"]
    start_wcpm = plan.get("wcpmUnseenStart") or {}
    cycle_start = plan["startDate"]
    done_ids = {d["planSessionId"] for d in payload.get("sessionsDone") or [] if d.get("done")}
    rank = {lvl: k for k, lvl in enumerate(config.LEVELS)}  # position on the ladder, to tell up from down only

    students = {s["code"]: s for s in payload["students"]}
    groups = []
    for g in plan["groups"]:
        planned = [s for s in g["sessions"] if s["kind"] == "practice"]
        done = [s for s in planned if s["id"] in done_ids]
        kids = []
        up = stay = down = waiting = 0
        for code in g["students"]:
            s = students.get(code)
            before = start.get(code)
            if not s or before is None:
                continue
            # Re-placed means the teacher confirmed a level after the cycle began, even if it did not change.
            replaced = bool(s.get("confirmedAt")) and s["confirmedAt"] > cycle_start
            after = s["confirmedLevel"] if replaced else None
            if after is None:
                waiting += 1
                move = "belum"
            elif rank[after] > rank[before]:
                up += 1
                move = "naik"
            elif rank[after] < rank[before]:
                down += 1
                move = "turun"
            else:
                stay += 1
                move = "tetap"
            kids.append({
                "code": code,
                "before": before,
                "after": after,
                "move": move,
                "wcpmBefore": start_wcpm.get(code),
                "wcpmAfter": s.get("wcpmUnseen") if replaced else None,
            })
        groups.append({
            "level": g["level"],
            "name": g["name"],
            "size": g["size"],
            "moved": {"up": up, "stayed": stay, "down": down, "notYet": waiting},
            "sessions": {"planned": len(planned), "done": len(done)},
            "children": kids,
        })
    return {"planId": plan["id"], "classCode": plan["classCode"], "groups": groups, "nextCycle": {"available": True}}
