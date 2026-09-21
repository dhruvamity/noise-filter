"""DST regimes, London/NY clock change tracking, and desync transition week tagging."""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
import pandas as pd

from tradeclock.timemodel.timezone import TZ_NY, TZ_LON, TZ_UTC


def get_dst_info(dt_utc: datetime) -> dict:
    """Analyze daylight saving time status for US and UK at a given UTC datetime."""
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=TZ_UTC)

    dt_ny = dt_utc.astimezone(TZ_NY)
    dt_lon = dt_utc.astimezone(TZ_LON)

    # US DST: In America/New_York, UTC-4 is Daylight Saving (Summer), UTC-5 is Standard (Winter)
    # dst() timedelta is nonzero when DST is active
    us_dst = bool(dt_ny.dst() and dt_ny.dst().total_seconds() != 0)

    # UK DST: In Europe/London, UTC+1 (BST) is Daylight Saving (Summer), UTC+0 (GMT) is Standard (Winter)
    uk_dst = bool(dt_lon.dst() and dt_lon.dst().total_seconds() != 0)

    # Out of sync if one is in Summer and the other is in Winter
    is_desync = us_dst != uk_dst

    if is_desync:
        regime = "DESYNC"
    elif us_dst:
        regime = "US_SUMMER"
    else:
        regime = "US_WINTER"

    return {
        "us_dst": us_dst,
        "uk_dst": uk_dst,
        "is_desync": is_desync,
        "regime": regime,
    }


def tag_dst_regimes(df: pd.DataFrame, time_col: str = "open_time") -> pd.DataFrame:
    """Tag a DataFrame of candles with DST regime metadata based on UTC timestamp."""
    df = df.copy()
    # Cache by unique date to make it fast
    dts = pd.to_datetime(df[time_col], unit="ms", utc=True)
    unique_dates = dts.dt.date.unique()

    date_to_info = {}
    for d in unique_dates:
        # Check midday UTC
        midday = datetime(d.year, d.month, d.day, 12, 0, 0, tzinfo=timezone.utc)
        date_to_info[d] = get_dst_info(midday)

    dates = dts.dt.date
    df["us_dst"] = [date_to_info[d]["us_dst"] for d in dates]
    df["uk_dst"] = [date_to_info[d]["uk_dst"] for d in dates]
    df["is_dst_desync"] = [date_to_info[d]["is_desync"] for d in dates]
    df["dst_regime"] = [date_to_info[d]["regime"] for d in dates]

    return df
