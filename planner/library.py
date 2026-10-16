"""Activity library and passage packs, read from the app's own content files, plus the rule-based default plan."""
from __future__ import annotations

import json
import os

from . import config

_cache: dict = {}


def _load(name: str) -> dict:
    if name not in _cache:
        with open(os.path.join(config.CONTENT_DIR, name), encoding="utf-8") as fh:
            _cache[name] = json.load(fh)
    return _cache[name]


def activities() -> dict[str, dict]:
    return {a["id"]: a for a in _load("activities.json")["activities"]}


def activities_for(level: str) -> list[dict]:
    return [a for a in _load("activities.json")["activities"] if a["level"] == level]


def passages() -> dict[str, dict]:
    return {c["id"]: c for c in _load("cards.json")["cards"]}


def pack(level: str) -> list[str]:
    """Pre-checked passage IDs for a level. Pemula has no printed card, so its pack is empty."""
    return sorted(c["id"] for c in _load("cards.json")["cards"] if c["level"] == level)


def catalog_for(level: str) -> dict:
    """What the Planner may choose from for a group: IDs and plain facts only."""
    return {
        "activities": [{"id": a["id"], "title": a["title"], "minutes": a["minutes"]} for a in activities_for(level)],
        "passageIds": pack(level),
    }


def default_sessions(level: str, weeks: list[int], budget: dict[int, int], reserve: dict[int, int], carry: int = 0, offset: int = 0) -> list[dict]:
    """
    The rule-based default plan for one group: the level's activities in fixed order, cycling, with
    the level's passages cycling alongside. Per week it takes as many sessions as the budget (minus
    the minutes reserved for re-placement) allows, at most SESSIONS_PER_WEEK, plus one session of
    `carry` missed earlier. Always valid, never clever.
    """
    acts = activities_for(level)
    cards = pack(level)
    out: list[dict] = []
    k = offset
    extra = carry
    for week in weeks:
        room = budget.get(week, 0) - reserve.get(week, 0)
        want = config.SESSIONS_PER_WEEK + (1 if extra > 0 else 0)
        if extra > 0:
            extra -= 1
        taken = 0
        while taken < want and acts:
            act = acts[k % len(acts)]
            if act["minutes"] > room:
                shorter = [a for a in acts if a["minutes"] <= room]
                if not shorter:
                    break
                act = shorter[0]
            ids = [cards[(k + j) % len(cards)] for j in range(min(2, len(cards)))] if cards else []
            out.append({"week": week, "activityId": act["id"], "passageIds": ids, "minutes": act["minutes"], "focus": act["title"]})
            room -= act["minutes"]
            k += 1
            taken += 1
    return out
