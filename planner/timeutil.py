from __future__ import annotations

import datetime as dt

from .config import DAYS


def to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def to_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def parse_date(text: str) -> dt.date:
    return dt.date.fromisoformat(text)


def day_name(date: dt.date) -> str:
    return DAYS[date.weekday()]


def week_start(start: dt.date, week: int) -> dt.date:
    """Monday of the given 1-based cycle week; week 1 is the week containing `start`."""
    monday = start - dt.timedelta(days=start.weekday())
    return monday + dt.timedelta(days=7 * (week - 1))
