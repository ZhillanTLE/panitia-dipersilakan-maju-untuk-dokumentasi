"""The shared banned-word check: diagnosis and ranking words. Used by the Checker, the agents' sanitiser and scope_check."""
from __future__ import annotations

import re

from . import config


def contains_banned(text: str) -> list[str]:
    low = text.lower()
    return [w for w in config.banned_words() if re.search(r"\b" + re.escape(w) + r"\b", low)]
