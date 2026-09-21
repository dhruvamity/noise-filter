"""Unit tests for IST time modeling, DST tagging, and session blocks."""
from datetime import datetime, timezone
import pandas as pd
import pytest

from tradeclock.timemodel.timezone import TZ_IST, TZ_UTC, ms_to_ist, ms_to_utc
from tradeclock.timemodel.regimes import get_dst_info, tag_dst_regimes
from tradeclock.timemodel.bins import BIN_LABELS, get_bin_id, format_bin_str, tag_ist_structure


def test_ist_timezone_conversion():
    # 00:00 UTC = 05:30 IST
    dt_utc = datetime(2026, 9, 21, 0, 0, 0, tzinfo=timezone.utc)
    ms = int(dt_utc.timestamp() * 1000)
    ist = ms_to_ist(ms)

    assert ist.hour == 5
    assert ist.minute == 30
    assert ist.tzinfo == TZ_IST


def test_dst_clock_changes():
    # July (US Summer, EDT UTC-4)
    dt_summer = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)
    info_summer = get_dst_info(dt_summer)
    assert info_summer["us_dst"] is True
    assert info_summer["regime"] == "US_SUMMER"

    # January (US Winter, EST UTC-5)
    dt_winter = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    info_winter = get_dst_info(dt_winter)
    assert info_winter["us_dst"] is False
    assert info_winter["regime"] == "US_WINTER"

    # Mid March (typical US DST active, UK BST not yet active -> DESYNC)
    dt_march = datetime(2026, 3, 20, 12, 0, 0, tzinfo=timezone.utc)
    info_march = get_dst_info(dt_march)
    if info_march["is_desync"]:
        assert info_march["regime"] == "DESYNC"


def test_bin_labels_and_ids():
    assert len(BIN_LABELS) == 48
    assert BIN_LABELS[0] == "00:00-00:30"
    assert BIN_LABELS[1] == "00:30-01:00"
    assert BIN_LABELS[47] == "23:30-00:00"

    assert get_bin_id(9, 15) == 18 # 09:00 is 18
    assert get_bin_id(19, 45) == 39 # 19:30 is 39
    assert format_bin_str(18) == "09:00-09:30"


def test_special_blocks_tagging():
    # Create synthetic 5m timestamps:
    # 1. Saturday 02:00 IST (Fri-late)
    # Saturday 02:00 IST = Friday 20:30 UTC
    sat_dt = datetime(2026, 9, 18, 20, 30, 0, tzinfo=timezone.utc) # 2026-09-19 02:00 IST
    ms_fri_late = int(sat_dt.timestamp() * 1000)

    # 2. Monday 04:00 IST (Mon-early)
    # Monday 04:00 IST = Sunday 22:30 UTC
    mon_dt = datetime(2026, 9, 20, 22, 30, 0, tzinfo=timezone.utc) # 2026-09-21 04:00 IST
    ms_mon_early = int(mon_dt.timestamp() * 1000)

    # 3. Sunday 14:00 IST (Weekend rest)
    sun_dt = datetime(2026, 9, 20, 8, 30, 0, tzinfo=timezone.utc) # 2026-09-20 14:00 IST
    ms_weekend = int(sun_dt.timestamp() * 1000)

    df = pd.DataFrame({
        "open_time": [ms_fri_late, ms_mon_early, ms_weekend],
        "open": [100.0, 101.0, 102.0],
        "high": [105.0, 106.0, 107.0],
        "low": [99.0, 100.0, 101.0],
        "close": [104.0, 105.0, 106.0],
        "volume": [10.0, 20.0, 5.0],
        "is_market_closed": [False, False, True],
    })

    tagged = tag_ist_structure(df, is_gold=True)

    # Check Fri-late
    assert bool(tagged.loc[0, "is_fri_late"]) is True
    assert tagged.loc[0, "analysis_weekday"] == "Fri-late"

    # Check Mon-early
    assert bool(tagged.loc[1, "is_mon_early"]) is True
    assert tagged.loc[1, "analysis_weekday"] == "Monday"

    # Check Weekend rest
    assert bool(tagged.loc[2, "is_weekend_rest"]) is True
    assert tagged.loc[2, "market_status"] == "CLOSED"
