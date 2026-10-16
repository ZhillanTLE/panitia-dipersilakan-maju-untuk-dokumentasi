"""Activity library and passage packs, read from the app's own content files, plus the rule-based default plan."""
from __future__ import annotations

import json
import os
import re

from . import config, patterns

_cache: dict = {}

# A card joins a pattern's pack when at least this many of its items have that shape.
PACK_MIN_ITEMS = 2


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


def _items(card: dict) -> list[str]:
    return list(card["blocks"]) if card["layout"] == "grid" else [w for block in card["blocks"] for w in block.split()]


def pack_by_pattern(level: str) -> dict[str, list[str]]:
    """The level's passages indexed by pattern, from the shapes of the words actually printed on each card."""
    out: dict[str, list[str]] = {}
    for cid in pack(level):
        card = passages()[cid]
        counts: dict[str, int] = {}
        for item in _items(card):
            for pid in patterns.shapes(item):
                counts[pid] = counts.get(pid, 0) + 1
        for pid in patterns.IDS:
            if counts.get(pid, 0) >= PACK_MIN_ITEMS:
                out.setdefault(pid, []).append(cid)
    return out


CONTOH = re.compile(r"\s*\([^()]*\{contoh\}[^()]*\)")
REPLACEMENT_TIP = "Dengarkan setiap anak membaca kartu tingkatnya lagi, satu per satu, lalu konfirmasi tingkatnya di Tinjau."


def tip_for(session: dict, group: dict) -> str:
    """
    The teacher's one-line instruction for a session: the chosen activity's tip, with example words the
    group itself misread on the session's focus pattern. Built by code from the library and the stage-0
    facts; no agent writes it.
    """
    if session.get("kind") == "replacement":
        return REPLACEMENT_TIP
    act = activities().get(session.get("activityId") or "")
    if not act:
        return ""
    tip = act.get("tip") or act["title"]
    words = next((p["examples"] for p in group.get("patterns", []) if p["id"] == session.get("focus")), [])
    if words:
        return tip.replace("{contoh}", ", ".join(words))
    return CONTOH.sub("", tip)


def catalog_for(level: str) -> dict:
    """What the Planner may choose from for a group: IDs and plain facts only."""
    return {
        "activities": [{"id": a["id"], "title": a["title"], "minutes": a["minutes"], "patterns": a["patterns"]} for a in activities_for(level)],
        "passageIds": pack(level),
        "passagesByPattern": pack_by_pattern(level),
    }


def default_sessions(level: str, focus: str | None, weeks: list[int], budget: dict[int, int], reserve: dict[int, int], carry: int = 0, offset: int = 0) -> list[dict]:
    """
    The rule-based default plan for one group. Every session targets `focus`, the group's single most
    frequent pattern (None when the group showed none). Activities come in the library's fixed order,
    the ones that practise `focus` first, cycling; passages from the focus pack first, then the rest of
    the level's pack. Per week it takes as many sessions as the budget (minus the minutes reserved for
    re-placement) allows, at most SESSIONS_PER_WEEK, plus one session of `carry` missed earlier.
    Always valid, never clever.
    """
    acts = activities_for(level)
    acts = [a for a in acts if focus in a["patterns"]] + [a for a in acts if focus not in a["patterns"]]
    focused = pack_by_pattern(level).get(focus, []) if focus else []
    cards = focused + [c for c in pack(level) if c not in focused]
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
            out.append({"week": week, "activityId": act["id"], "passageIds": ids, "minutes": act["minutes"], "focus": focus})
            room -= act["minutes"]
            k += 1
            taken += 1
    return out
