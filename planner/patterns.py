"""
Error patterns: which letter, syllable or word shapes a misread word has. Fixed rules, no model.

The rules live in src/content/patterns.json and are shared with the phone (src/lib/patterns.ts).
src/lib/patterns.cases.json holds the cases both implementations must agree on; each test suite
runs them. A pattern describes what was read, never why it was read that way.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata

from . import config

with open(os.path.join(config.CONTENT_DIR, "patterns.json"), encoding="utf-8") as _fh:
    RULES = json.load(_fh)

IDS: list[str] = [p["id"] for p in RULES["patterns"]]
LABEL: dict[str, str] = {p["id"]: p["label"] for p in RULES["patterns"]}
_VOWELS = set(RULES["vowels"])
_CONFUSABLE = {frozenset(pair) for pair in RULES["confusable"]}
_DIGRAPHS = RULES["digraphs"]
_CLUSTERS = set(RULES["clusters"])
_PREFIXES = [(a["affix"], a["minStem"]) for a in RULES["prefixes"]]
_SUFFIXES = [(a["affix"], a["minStem"]) for a in RULES["suffixes"]]
_NOT_AFFIXED = set(RULES["notAffixed"])


def normalize(text: str) -> str:
    """Same as normalize() in src/lib/scoring.ts: lower case, accents dropped, letters and digits only."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", text)


def _units(word: str) -> list[str]:
    """Letters, with ng, ny, sy and kh kept as one consonant."""
    out, k = [], 0
    while k < len(word):
        if word[k:k + 2] in _DIGRAPHS:
            out.append(word[k:k + 2])
            k += 2
        else:
            out.append(word[k])
            k += 1
    return out


def syllable_count(word: str) -> int:
    """Same as syllableCount() in src/lib/syllables.ts: one per vowel; word-final ai/au/oi/ei is one."""
    if len(word) <= 1:
        return 1
    count = 0
    for k, ch in enumerate(word):
        if ch not in _VOWELS:
            continue
        count += 1
        if k + 2 == len(word) and word[k:k + 2] in ("ai", "au", "oi", "ei"):
            break
    return max(1, count)


def _is_vowel(unit: str) -> bool:
    return unit in _VOWELS


def has_closed_syllable(word: str) -> bool:
    """A syllable that ends in a consonant: ban, sar, tum, bin-tang, dom-ba."""
    units = _units(word)
    vowels = [k for k, u in enumerate(units) if _is_vowel(u)]
    if len(units) < 2 or not vowels:
        return False
    if not _is_vowel(units[-1]):
        return True
    for a, b in zip(vowels, vowels[1:]):
        run = units[a + 1:b]
        if len(run) > 2 or (len(run) == 2 and run[0] + run[1] not in _CLUSTERS):
            return True
    return False


def has_digraph_or_cluster(word: str) -> bool:
    return any(d in word for d in _DIGRAPHS) or any(word[k:k + 2] in _CLUSTERS for k in range(len(word) - 1))


def is_long(word: str) -> bool:
    return syllable_count(word) >= RULES["longWordSyllables"]


def is_affixed(word: str) -> bool:
    """me-, ber-, -kan, -an and the rest, only when what is left is long enough to be a root word."""
    if word in _NOT_AFFIXED:
        return False
    return any(word.startswith(a) and len(word) - len(a) >= stem for a, stem in _PREFIXES) or any(
        word.endswith(a) and len(word) - len(a) >= stem for a, stem in _SUFFIXES
    )


def letter_confusion(expected: str, heard: str | None) -> bool:
    """Same length, and every letter that differs is one of the fixed similar pairs (b-d, p-q, m-n...)."""
    if not heard:
        return False
    e, h = normalize(expected), normalize(heard)
    if len(e) == 1:
        h = RULES["letterNames"].get(h, h)
    if len(e) != len(h) or e == h:
        return False
    return all(frozenset((x, y)) in _CONFUSABLE for x, y in zip(e, h) if x != y)


def classify(expected: str, heard: str | None = None) -> list[str]:
    """Pattern ids for one misread word, in the fixed list order."""
    word = normalize(expected)
    hits = []
    if letter_confusion(expected, heard):
        hits.append("letter_confusion")
    if len(word) >= 2 and any(ch in _VOWELS for ch in word):
        if has_closed_syllable(word):
            hits.append("closed_syllable")
        if has_digraph_or_cluster(word):
            hits.append("digraph_cluster")
        if is_long(word):
            hits.append("long_word")
        if is_affixed(word):
            hits.append("affixed_word")
    return hits


def shapes(item: str) -> list[str]:
    """Shapes a card item has before anyone reads it; indexes the passage packs. Letter pairs count as confusable."""
    word = normalize(item)
    out = []
    if any(ch in {c for pair in _CONFUSABLE for c in pair} for ch in word) and len(word) <= 2:
        out.append("letter_confusion")
    return out + [p for p in classify(item) if p != "letter_confusion"]
