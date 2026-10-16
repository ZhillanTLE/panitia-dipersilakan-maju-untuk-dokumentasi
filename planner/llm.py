"""
llm.py -- one Gemini call, and three honest ways not to make it.

  PLANNER_FIXTURES=1       replay a captured run (offline demo)
  MOCK_LLM=true            plumbing work; the agents write labelled "mock" text
  PLANNER_LIVE_INFERENCE=1 call the model; refuses (503) without GEMINI_API_KEY

The default, with none of these set, is mock, and the header says so. Live mode with no key is
a misconfiguration, not a mode: it raises LiveInferenceUnavailable instead of filling the trace
with templates that look like model output. Temperature is zero and prompts are constants.
"""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

MODEL = "gemini-flash-latest"
TEMPERATURE = 0.0
MAX_OUTPUT_TOKENS = 2048
TIMEOUT_S = 40


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


def load_env_file() -> None:
    """Reads planner/.env once, without overriding variables that are already set."""
    if _flag("PLANNER_NO_DOTENV"):
        return  # tests: never read a real key
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class LiveInferenceUnavailable(RuntimeError):
    """Live mode was requested but no GEMINI_API_KEY is configured."""


def has_key() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


# The teacher's switch on the website, for one request: "live" or "mock". Replay still wins.
_chosen: ContextVar[Optional[str]] = ContextVar("planner_inference", default=None)


@contextmanager
def chosen(mode: Optional[str]) -> Iterator[None]:
    """Runs the block with the inference mode the teacher picked; anything else keeps the server's own mode."""
    token = _chosen.set(mode if mode in ("live", "mock") else None)
    try:
        yield
    finally:
        _chosen.reset(token)


def inference_mode() -> str:
    """'replay', 'live' or 'mock'. Replay wins, then the teacher's switch, then an explicit mock, then live, then the mock default."""
    if _flag("PLANNER_FIXTURES"):
        return "replay"
    if _chosen.get():
        return _chosen.get()
    if _flag("MOCK_LLM"):
        return "mock"
    if _flag("PLANNER_LIVE_INFERENCE"):
        return "live"
    return "mock"


def require_configured() -> None:
    if inference_mode() == "live" and not has_key():
        raise LiveInferenceUnavailable(
            "Live inference is on but GEMINI_API_KEY is not set, so the Evidence Summarizer and "
            "Planner cannot run. Set GEMINI_API_KEY (planner/.env), or set PLANNER_FIXTURES=1 to replay "
            "the captured run, or MOCK_LLM=true for plumbing work. Refusing to substitute template text "
            "for model output."
        )


def available() -> bool:
    return inference_mode() == "live" and has_key()


def _extract_json(raw: str) -> Optional[dict]:
    match = re.search(r"\{[\s\S]*\}", raw or "")
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def complete_json(system: str, payload: dict) -> Optional[dict]:
    """Parsed JSON from the model, or None. None is always survivable: callers have a fallback."""
    if not available():
        return None
    model = os.environ.get("GEMINI_MODEL", "").strip() or MODEL
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = json.dumps({
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps(payload, ensure_ascii=False)}]}],
        "generationConfig": {
            "temperature": TEMPERATURE,
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")
    headers = {"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"].strip()}
    for attempt in range(2):  # one retry on a transport error, then the fallback
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return _extract_json(text)
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as exc:
            logger.warning("[planner] model call failed (attempt %d): %s", attempt + 1, exc)
    return None
