"""
End-of-cycle report. Counts only, never percentages; each child compared only with their own earlier
result; groups in level order, never sorted by score. There is no class ranking and no view of
lowest performers. Speeds are compared only in the same unit: letters per minute and words per minute
are different scales.
"""
from __future__ import annotations

from . import config, patterns
from . import intake as intake_mod


def build(payload: dict, plan: dict, calendar: dict) -> dict:
    problems = intake_mod.validate(payload)
    if problems:
        raise intake_mod.PayloadError(problems)
    start = plan["levelsAtStart"]
    start_speed = plan.get("speedAtStart") or {}
    start_patterns = plan.get("patternsAtStart") or {}
    cycle_start = plan["startDate"]
    done_ids = {d["planSessionId"] for d in payload.get("sessionsDone") or [] if d.get("done")}
    rank = {lvl: k for k, lvl in enumerate(config.LEVELS)}  # position on the ladder, to tell up from down only

    students = {s["code"]: s for s in payload["students"]}
    groups = []
    for g in plan["groups"]:
        planned = [s for s in g["sessions"] if s["kind"] == "practice"]
        done = [s for s in planned if s["id"] in done_ids]
        kids = []
        replaced_codes = []
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
            if replaced:
                replaced_codes.append(code)
            speed_before = start_speed.get(code) or {}
            unit = speed_before.get("unit")
            now_unit = s["metrics"]["unit"] if replaced else None
            kids.append({
                "code": code,
                "before": before,
                "after": after,
                "move": move,
                "unit": unit,
                "speedBefore": speed_before.get("value"),
                # Only in the same unit; a child who moved from syllables to words has no "after" to set beside it.
                "speedAfter": s["metrics"]["correctUnitsPerMinute"] if replaced and now_unit == unit else None,
                "unitChanged": bool(replaced and unit and now_unit != unit),
            })
        targeted = list(dict.fromkeys(s["focus"] for s in planned if s.get("focus")))
        pattern_rows = []
        for pid in targeted:
            had = sum(1 for c in replaced_codes if pid in start_patterns.get(c, []))
            has = sum(1 for c in replaced_codes if any(h["id"] == pid for h in students[c]["metrics"]["patterns"]))
            pattern_rows.append({"id": pid, "label": patterns.LABEL.get(pid, pid), "children": len(replaced_codes), "before": had, "after": has})
        groups.append({
            "level": g["level"],
            "name": g["name"],
            "size": g["size"],
            "moved": {"up": up, "stayed": stay, "down": down, "notYet": waiting},
            "sessions": {"planned": len(planned), "done": len(done)},
            "patterns": pattern_rows,
            "children": kids,
        })
    return {"planId": plan["id"], "classCode": plan["classCode"], "groups": groups, "nextCycle": {"available": True}}
