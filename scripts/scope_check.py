"""
scope_check.py -- mechanical pre-commit gate for the online planner.

    python scripts/scope_check.py

Fails on:
  - a diagnosis or ranking word in planner copy (the website's planner files and the replay fixtures)
  - an audio or name field in the sync schema
  - a model call, or an import of the agents or the model client, inside the deterministic modules
    (scheduler, calendar slots, approval, checker, report, intake, store)
The word list lives in planner/banned_words.json and is shared with the Checker.
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANNER = os.path.join(ROOT, "planner")
FAILURES: list[str] = []

COPY_FILES = [
    "src/views/PlannerView.tsx",
    "src/views/PlannerView.css",
    "src/lib/planner.ts",
    "src/plannerStrings.ts",
    "planner/fixtures/K2.golden.json",
]
DETERMINISTIC = ["scheduler.py", "calendar_slots.py", "approval.py", "checker.py", "report.py", "intake.py", "store.py", "library.py", "timeutil.py"]
SCHEMA_BANNED = {"audio", "name", "nama", "notes", "catatan", "transcript", "recording"}


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def banned() -> list[str]:
    data = json.loads(read(os.path.join(PLANNER, "banned_words.json")))
    return [w.lower() for key in ("diagnosis", "ranking") for w in data[key]]


for rel in COPY_FILES:
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        continue
    text = read(path).lower()
    for word in banned():
        if re.search(r"\b" + re.escape(word) + r"\b", text):
            FAILURES.append(f"{rel}: banned word '{word}' in planner copy")

# The sync schema: the student fields the validator accepts may never include audio or names.
sys.path.insert(0, ROOT)
from planner import config  # noqa: E402

for field in config.STUDENT_FIELDS:
    if field.lower() in SCHEMA_BANNED:
        FAILURES.append(f"planner/config.py: STUDENT_FIELDS allows '{field}'")

for name in DETERMINISTIC:
    path = os.path.join(PLANNER, name)
    if not os.path.isfile(path):
        continue
    src = read(path)
    code = re.sub(r'""".*?"""', "", src, flags=re.S)
    code = re.sub(r"(?m)#.*$", "", code)
    if re.search(r"^\s*(from\s+\.\s+import\s+[^\n]*\b(llm|agents)\b|from\s+\.(llm|agents)\s+import|import\s+planner\.(llm|agents))", code, flags=re.M):
        FAILURES.append(f"planner/{name}: imports the model client or the agents; scheduling and checking are deterministic")
    if re.search(r"complete_json|generativelanguage|urllib\.request", code):
        FAILURES.append(f"planner/{name}: makes a model or network call")

if FAILURES:
    print("scope_check FAILED")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1)
print("scope_check ok")
