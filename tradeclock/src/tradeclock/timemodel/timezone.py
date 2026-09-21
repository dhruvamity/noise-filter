"""Strict timezone definitions and conversion utilities using Python standard zoneinfo."""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

TZ_IST = ZoneInfo("Asia/Kolkata")
TZ_NY = ZoneInfo("America/New_York")
TZ_LON = ZoneInfo("Europe/London")
TZ_UTC = timezone.utc


def ms_to_utc(ms: int) -> datetime:
    """Convert epoch millisecond timestamp to UTC datetime."""
    return datetime.fromtimestamp(ms / 1000.0, tz=TZ_UTC)


def ms_to_ist(ms: int) -> datetime:
    """Convert epoch millisecond timestamp to IST datetime."""
    return datetime.fromtimestamp(ms / 1000.0, tz=TZ_IST)


def dt_to_ist(dt: datetime) -> datetime:
    """Convert any aware or UTC datetime to IST."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ_UTC)
    return dt.astimezone(TZ_IST)


def dt_to_ny(dt: datetime) -> datetime:
    """Convert any aware or UTC datetime to New York time."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ_UTC)
    return dt.astimezone(TZ_NY)


def dt_to_lon(dt: datetime) -> datetime:
    """Convert any aware or UTC datetime to London time."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ_UTC)
    return dt.astimezone(TZ_LON)
