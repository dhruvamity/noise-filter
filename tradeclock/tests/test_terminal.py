"""Unit tests for terminal slot lookups, exact boundaries, and CLI modes."""
import subprocess
from pathlib import Path
import pytest

from tradeclock.terminal.app import get_active_slot_and_next, load_schedule_file


def test_terminal_slot_lookup_boundaries():
    slots = [
        {"start_time": "00:00", "end_time": "03:30", "duration_minutes": 210, "label": "NO_TRADE", "score": 35.0, "confidence": "HIGH", "stats": {}},
        {"start_time": "03:30", "end_time": "05:00", "duration_minutes": 90, "label": "SMALL_TRADES", "score": 58.0, "confidence": "MED", "stats": {}},
        {"start_time": "05:00", "end_time": "17:30", "duration_minutes": 750, "label": "NO_TRADE", "score": 40.0, "confidence": "HIGH", "stats": {}},
        {"start_time": "17:30", "end_time": "21:30", "duration_minutes": 240, "label": "PRIME", "score": 75.0, "confidence": "HIGH", "stats": {}},
        {"start_time": "21:30", "end_time": "00:00", "duration_minutes": 150, "label": "SMALL_TRADES", "score": 50.0, "confidence": "MED", "stats": {}},
    ]

    # 1. Exact start of day: 00:00
    cur, nxt, rem = get_active_slot_and_next(slots, 0, 0)
    assert cur is not None
    assert cur["start_time"] == "00:00"
    assert cur["label"] == "NO_TRADE"
    assert rem == 210 # 3.5 hours = 210m
    assert nxt["start_time"] == "03:30"

    # 2. Exact slot boundary: 03:30 (should be the second slot)
    cur, nxt, rem = get_active_slot_and_next(slots, 3, 30)
    assert cur is not None
    assert cur["start_time"] == "03:30"
    assert cur["label"] == "SMALL_TRADES"
    assert rem == 90

    # 3. Exact slot boundary: 17:30 (PRIME slot)
    cur, nxt, rem = get_active_slot_and_next(slots, 17, 30)
    assert cur is not None
    assert cur["label"] == "PRIME"
    assert rem == 240

    # 4. Minute before midnight: 23:59
    cur, nxt, rem = get_active_slot_and_next(slots, 23, 59)
    assert cur is not None
    assert cur["start_time"] == "21:30"
    assert cur["end_time"] == "00:00"
    assert rem == 1


def test_schedule_loading_graceful():
    # Load demo schedule
    sched = load_schedule_file(demo=True)
    assert "instruments" in sched
    assert "BTCUSDT" in sched["instruments"]
    assert "XAUUSD_MT5" in sched["instruments"]
    assert "XAUUSDT_BINANCE" in sched["instruments"]


def test_cli_modes_execution():
    import os
    env = os.environ.copy()
    src_dir = str(Path(__file__).resolve().parents[1] / "src")
    env["PYTHONPATH"] = f"{src_dir}:{env.get('PYTHONPATH', '')}"

    # Test --now
    res_now = subprocess.run(["python3", "-m", "tradeclock", "--demo", "--now"], capture_output=True, text=True, env=env)
    assert res_now.returncode == 0
    assert "IST" in res_now.stdout
    assert "BTCUSDT" in res_now.stdout

    # Test --day mon --json
    res_json = subprocess.run(["python3", "-m", "tradeclock", "--demo", "--day", "mon", "--json"], capture_output=True, text=True, env=env)
    assert res_json.returncode == 0
    assert '"symbol": "BTCUSDT"' in res_json.stdout
    assert '"active_slot"' in res_json.stdout
