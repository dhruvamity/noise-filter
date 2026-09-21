"""IST 30-minute bin construction, Fri-late/Mon-early session mapping, and weekend masking."""
from __future__ import annotations

from datetime import datetime, timezone
import numpy as np
import pandas as pd

from tradeclock.timemodel.timezone import TZ_IST, TZ_UTC
from tradeclock.timemodel.regimes import tag_dst_regimes

BIN_LABELS = [
    f"{h:02d}:{m:02d}-{(h + (m + 30) // 60) % 24:02d}:{(m + 30) % 60:02d}"
    for h in range(24)
    for m in (0, 30)
]

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def get_bin_id(hour: int, minute: int) -> int:
    """Map IST hour (0..23) and minute (0..59) to 30-minute bin index (0..47)."""
    return hour * 2 + (minute // 30)


def format_bin_str(bin_id: int) -> str:
    """Return formatted time string for bin index, e.g. '09:30-10:00'."""
    return BIN_LABELS[bin_id % 48]


def tag_ist_structure(df_5m: pd.DataFrame, is_gold: bool = False) -> pd.DataFrame:
    """Attach IST timestamps, weekday tags, 30-min bins, DST regimes, and special blocks."""
    df = df_5m.copy()

    # Convert open_time (ms) to IST pandas Series
    ist_series = pd.to_datetime(df["open_time"], unit="ms", utc=True).dt.tz_convert(TZ_IST)

    df["ist_datetime"] = ist_series
    df["ist_date"] = ist_series.dt.date
    df["ist_weekday"] = ist_series.dt.weekday # 0 = Mon, 4 = Fri, 5 = Sat, 6 = Sun
    df["ist_weekday_name"] = [WEEKDAY_NAMES[w] for w in df["ist_weekday"]]
    df["ist_hour"] = ist_series.dt.hour
    df["ist_minute"] = ist_series.dt.minute
    df["bin_id"] = df["ist_hour"] * 2 + (df["ist_minute"] // 30)
    df["bin_str"] = [BIN_LABELS[b] for b in df["bin_id"]]

    # Tag DST regimes
    df = tag_dst_regimes(df, time_col="open_time")

    # Special session tagging:
    # 1. Fri-late: Saturday 00:00 - 04:00 IST (bins 0 to 7) -> mapped to Friday US Session tail
    is_fri_late = (df["ist_weekday"] == 5) & (df["ist_hour"] < 4)

    # 2. Mon-early: Monday 03:30 - 06:30 IST (bins 7 to 12) -> Asian open / Gold weekly restart
    is_mon_early = (df["ist_weekday"] == 0) & (
        ((df["ist_hour"] == 3) & (df["ist_minute"] >= 30)) |
        ((df["ist_hour"] >= 4) & (df["ist_hour"] < 6)) |
        ((df["ist_hour"] == 6) & (df["ist_minute"] < 30))
    )

    # 3. Weekend rest: Saturday 04:00 onwards through Sunday all day until Monday 03:30 IST
    is_weekend_rest = (
        ((df["ist_weekday"] == 5) & (df["ist_hour"] >= 4)) |
        (df["ist_weekday"] == 6) |
        ((df["ist_weekday"] == 0) & ((df["ist_hour"] < 3) | ((df["ist_hour"] == 3) & (df["ist_minute"] < 30))))
    )

    df["is_fri_late"] = is_fri_late
    df["is_mon_early"] = is_mon_early
    df["is_weekend_rest"] = is_weekend_rest

    # Assign analysis weekday group
    # Monday to Friday retain their name; Saturday morning is "Fri-late"
    analysis_weekday = df["ist_weekday_name"].copy()
    analysis_weekday[is_fri_late] = "Fri-late"
    df["analysis_weekday"] = analysis_weekday

    # Market status tag
    if is_gold:
        # Gold is closed during weekend rest or daily maintenance
        df["market_status"] = np.where(df["is_market_closed"] | df["is_weekend_rest"], "CLOSED", "OPEN")
    else:
        # BTC trades 24/7, but weekend rest is designated as NO_TRADE per specification
        df["market_status"] = np.where(df["is_weekend_rest"], "WEEKEND_NO_TRADE", "OPEN")

    return df
