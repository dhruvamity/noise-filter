"""TradeClock Live IST Terminal & CLI Application."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from tradeclock.timemodel.timezone import TZ_IST
from tradeclock.timemodel.regimes import get_dst_info

ROOT = Path(__file__).resolve().parents[3] # tradeclock root
console = Console()

COLOR_MAP = {
    "PRIME": "bold green",
    "SWING_ENTRY": "bold cyan",
    "SMALL_TRADES": "bold yellow",
    "NO_TRADE": "bold red",
    "CLOSED": "bold bright_black",
    "WEEKEND_NO_TRADE": "bold bright_black",
}

BADGE_STYLE = {
    "PRIME": "on green black",
    "SWING_ENTRY": "on cyan black",
    "SMALL_TRADES": "on yellow black",
    "NO_TRADE": "on red white",
    "CLOSED": "on bright_black white",
}

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def load_schedule_file(demo: bool = False) -> dict:
    """Load schedule.json or fallback demo_schedule.json safely without crashing."""
    schedule_dir = ROOT / "schedule"
    target = schedule_dir / ("demo_schedule.json" if demo else "schedule.json")
    if not target.exists():
        target = schedule_dir / "demo_schedule.json"
    if not target.exists():
        # Minimal empty fallback
        return {"instruments": {}, "generated_at_utc": datetime.now(timezone.utc).isoformat()}

    try:
        with open(target, "r") as f:
            return json.load(f)
    except Exception as exc:
        console.print(f"[bold red]Error loading schedule {target}:[/] {exc}")
        return {"instruments": {}, "generated_at_utc": datetime.now(timezone.utc).isoformat()}


def get_active_slot_and_next(slots: list[dict], cur_hour: int, cur_minute: int) -> tuple[dict | None, dict | None, int]:
    """Find current slot, next slot, and minutes remaining in current slot."""
    cur_mins = cur_hour * 60 + cur_minute
    active_slot = None
    next_slot = None
    mins_remaining = 0

    for idx, s in enumerate(slots):
        sh, sm = map(int, s["start_time"].split(":"))
        eh, em = map(int, s["end_time"].split(":"))
        s_mins = sh * 60 + sm
        e_mins = (24 * 60) if (eh == 0 and em == 0 and s_mins > 0) else (eh * 60 + em)

        if s_mins <= cur_mins < e_mins:
            active_slot = s
            mins_remaining = e_mins - cur_mins
            if idx + 1 < len(slots):
                next_slot = slots[idx + 1]
            elif len(slots) > 0:
                next_slot = slots[0]
            break

    return active_slot, next_slot, mins_remaining


def build_timeline_bar(slots: list[dict], cur_hour: int, cur_minute: int, width: int = 48) -> Text:
    """Build 24h timeline ASCII bar with color-coded slots and [NOW] pin."""
    cur_mins = cur_hour * 60 + cur_minute
    bar = Text()

    # Total minutes in day = 1440
    for col in range(width):
        col_mid_mins = int((col + 0.5) / width * 1440)
        # Find which slot owns this time
        slot_label = "NO_TRADE"
        for s in slots:
            sh, sm = map(int, s["start_time"].split(":"))
            eh, em = map(int, s["end_time"].split(":"))
            s_mins = sh * 60 + sm
            e_mins = (24 * 60) if (eh == 0 and em == 0 and s_mins > 0) else (eh * 60 + em)
            if s_mins <= col_mid_mins < e_mins:
                slot_label = s["label"]
                break

        # Check if now is near this column
        is_now = abs(cur_mins - col_mid_mins) <= (1440 / width / 2)
        char = "▼" if is_now else "█"
        color = "bold white" if is_now else COLOR_MAP.get(slot_label, "white")
        bar.append(char, style=color)

    return bar


def render_instrument_panel(
    symbol: str,
    sym_data: dict,
    active_regime: str,
    view_weekday: str,
    now_ist: datetime,
    is_live_day: bool,
) -> Panel:
    """Render comprehensive terminal panel for an instrument."""
    disp_name = sym_data.get("display_name", symbol)
    regimes = sym_data.get("regimes", {})
    reg_data = regimes.get(active_regime, regimes.get("POOLED", {}))
    slots_map = reg_data.get("slots", {})
    slots = slots_map.get(view_weekday, [])

    # If weekend outside Fri-late
    if view_weekday in ("Saturday", "Sunday") and not slots:
        status_text = Text()
        status_text.append("\n  WEEKEND / MARKET REST\n", style="bold bright_black")
        status_text.append(f"  Trades avoided until Asian / Monday open (03:30 IST)\n", style="dim")
        return Panel(status_text, title=f"[bold]{disp_name}[/]", border_style="bright_black")

    active_slot, next_slot, mins_rem = get_active_slot_and_next(slots, now_ist.hour, now_ist.minute)

    content = Text()

    # Slot Status Banner
    if is_live_day and active_slot:
        lbl = active_slot["label"]
        style = COLOR_MAP.get(lbl, "white")
        badge = BADGE_STYLE.get(lbl, "bold white")
        score = active_slot["score"]
        conf = active_slot["confidence"]

        content.append(f" CURRENT SLOT: ", style="bold white")
        content.append(f" {lbl} ", style=badge)
        content.append(f"  (Score: {score} | Conf: {conf})\n", style=style)
        content.append(f"  Time Window: {active_slot['start_time']} -> {active_slot['end_time']}  ", style="bold")
        content.append(f"[{mins_rem}m remaining]\n", style="bold green" if mins_rem > 15 else "bold red")

        if next_slot:
            content.append(f"  Next: {next_slot['label']} at {next_slot['start_time']} ({next_slot['duration_minutes']}m)\n", style="dim")

        # Key stats
        st = active_slot.get("stats", {})
        content.append(f"  ER: {st.get('er_mean', 0.0):.3f} | Range/Cost: {st.get('range_cost_ratio', 0.0)}x | FT Prob: {int(st.get('follow_through_prob', 0.5)*100)}% | False Break: {int(st.get('false_breakout_rate', 0.5)*100)}%\n\n", style="cyan")
    elif is_live_day:
        content.append(" CURRENT STATUS: NO_TRADE (Outside Active Sessions)\n\n", style="bold red")

    # Timeline bar
    content.append(" 24h Timeline (IST): [00:00 ── 06:00 ── 12:00 ── 18:00 ── 24:00]\n ", style="dim")
    content.append(build_timeline_bar(slots, now_ist.hour, now_ist.minute, width=44))
    content.append("\n\n")

    # Slots Table
    table = Table(box=None, show_edge=False, pad_edge=False, expand=True)
    table.add_column("Window", style="bold", width=14)
    table.add_column("Classification", width=14)
    table.add_column("Score", justify="right", width=6)
    table.add_column("Conf", justify="center", width=6)
    table.add_column("ER", justify="right", width=6)
    table.add_column("R/Cost", justify="right", width=7)

    for s in slots:
        is_cur = is_live_day and active_slot and (s["start_time"] == active_slot["start_time"])
        arrow = "► " if is_cur else "  "
        lbl_style = COLOR_MAP.get(s["label"], "white")
        row_style = "bold white on grey15" if is_cur else ""

        table.add_row(
            f"{arrow}{s['start_time']}-{s['end_time']}",
            Text(s["label"], style=lbl_style),
            str(s["score"]),
            s["confidence"][:1],
            f"{s['stats']['er_mean']:.2f}",
            f"{s['stats']['range_cost_ratio']}x",
            style=row_style,
        )

    panel_group = Layout()
    panel_group.split_column(
        Layout(content, size=9),
        Layout(table),
    )

    border_color = "green" if (is_live_day and active_slot and active_slot["label"] in ("PRIME", "SWING_ENTRY")) else "blue"
    return Panel(panel_group, title=f"[bold]{disp_name} — {view_weekday}[/]", border_style=border_color)


def run_interactive_terminal(demo: bool = False):
    """Run full interactive live terminal."""
    schedule = load_schedule_file(demo=demo)
    instruments = schedule.get("instruments", {})

    gen_date_str = schedule.get("generated_at_utc", "")[:10]
    gen_dt = datetime.fromisoformat(schedule.get("generated_at_utc", datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00"))
    age_days = (datetime.now(timezone.utc) - gen_dt).days

    view_idx = 0 # Offset in days from today (0 = today)
    active_sym_idx = 0
    sym_keys = list(instruments.keys()) or ["BTCUSDT", "XAUUSD_MT5", "XAUUSDT_BINANCE"]

    with Live(console=console, screen=True, refresh_per_second=2) as live:
        while True:
            now_utc = datetime.now(timezone.utc)
            now_ist = now_utc.astimezone(TZ_IST)

            # Check DST regime
            dst_info = get_dst_info(now_utc)
            active_regime = dst_info["regime"]
            if active_regime == "DESYNC":
                active_regime = "US_SUMMER" # default fallback

            # Current day in IST
            today_weekday_idx = now_ist.weekday() # 0 = Mon, 4 = Fri, 5 = Sat, 6 = Sun
            view_day_num = (today_weekday_idx + view_idx) % 7
            view_weekday = WEEKDAY_NAMES[view_day_num]
            if view_day_num == 5 and now_ist.hour < 4:
                view_weekday = "Fri-late"
            elif view_day_num in (5, 6):
                # Map weekend to Friday schedule preview or show closed
                pass

            is_live_day = (view_idx == 0)

            # Header Panel
            header_text = Text()
            header_text.append(" TradeClock Live IST Terminal ", style="bold white on blue")
            header_text.append(f"  IST: {now_ist.strftime('%Y-%m-%d %H:%M:%S')}  |  Day: {WEEKDAY_NAMES[today_weekday_idx]}  |  Regime: {active_regime}  ")
            if age_days > 30:
                header_text.append(" [WARNING: Schedule >30 days old; run refresh]", style="bold red")

            # Panels for instruments (side by side)
            panels = []
            for k in sym_keys:
                if k in instruments:
                    p = render_instrument_panel(
                        symbol=k,
                        sym_data=instruments[k],
                        active_regime=active_regime,
                        view_weekday=view_weekday,
                        now_ist=now_ist,
                        is_live_day=is_live_day,
                    )
                    panels.append(p)

            # Grid layout
            grid = Table.grid(expand=True)
            for _ in panels:
                grid.add_column()
            grid.add_row(*panels)

            # Footer Panel
            footer_text = Text()
            footer_text.append(" [q] Quit  [r] Reload  [←/→] Browse Day  [t] Toggle Symbols  |  ", style="bold white")
            footer_text.append("DISCLAIMER: Historical statistical tendencies, not trade signals or financial advice.", style="dim")

            root_layout = Layout()
            root_layout.split_column(
                Layout(Panel(header_text, box=None), size=3),
                Layout(grid),
                Layout(Panel(footer_text, box=None), size=3),
            )

            live.update(root_layout)
            time.sleep(0.5)


def run_single_status(now_mode: bool = False, json_mode: bool = False, day_filter: str | None = None, demo: bool = False):
    """Run non-interactive CLI modes for tmux, scripts, or json export."""
    schedule = load_schedule_file(demo=demo)
    instruments = schedule.get("instruments", {})

    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(TZ_IST)
    active_regime = get_dst_info(now_utc)["regime"]
    if active_regime == "DESYNC":
        active_regime = "US_SUMMER"

    weekday = WEEKDAY_NAMES[now_ist.weekday()]
    if now_ist.weekday() == 5 and now_ist.hour < 4:
        weekday = "Fri-late"
    elif day_filter:
        day_map = {"mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday", "fri": "Friday", "sat": "Fri-late"}
        weekday = day_map.get(day_filter.lower(), day_filter.capitalize())

    results = {}
    lines = []

    for sym_key, sym_data in instruments.items():
        reg_data = sym_data.get("regimes", {}).get(active_regime, sym_data.get("regimes", {}).get("POOLED", {}))
        slots = reg_data.get("slots", {}).get(weekday, [])
        active_slot, next_slot, mins_rem = get_active_slot_and_next(slots, now_ist.hour, now_ist.minute)

        label = active_slot["label"] if active_slot else "NO_TRADE"
        score = active_slot["score"] if active_slot else 0.0
        conf = active_slot["confidence"] if active_slot else "N/A"

        results[sym_key] = {
            "symbol": sym_key,
            "ist_time": now_ist.strftime("%H:%M:%S"),
            "weekday": weekday,
            "regime": active_regime,
            "active_slot": active_slot,
            "mins_remaining": mins_rem,
            "next_slot": next_slot,
        }

        color = COLOR_MAP.get(label, "white")
        lines.append(f"{sym_key}: [{color}]{label}[/] ({score} {conf}) {mins_rem}m left")

    if json_mode:
        print(json.dumps(results, indent=2))
    elif now_mode:
        # Single line suitable for tmux / status bars
        out_line = f"IST {now_ist.strftime('%H:%M')} [{active_regime}] | " + " | ".join(lines)
        console.print(out_line)
    else:
        console.print(f"[bold blue]TradeClock Status — {weekday} ({active_regime}) IST {now_ist.strftime('%H:%M:%S')}[/]\n")
        for sym_key, res in results.items():
            slot = res.get("active_slot")
            if slot:
                lbl = slot["label"]
                style = COLOR_MAP.get(lbl, "white")
                console.print(f"[{style}]• {sym_key}: {lbl}[/] (Score: {slot['score']}, Conf: {slot['confidence']}) — {slot['start_time']} to {slot['end_time']} ({res['mins_remaining']}m remaining)")
            else:
                console.print(f"[dim]• {sym_key}: NO_TRADE / CLOSED[/]")


def run_refresh_pipeline():
    """Incremental refresh subcommand: downloads latest candles, re-validates, and rebuilds schedule."""
    console.print("[bold cyan]Running incremental data download and schedule refresh...[/]")
    from tradeclock.download.runner import run_download
    from tradeclock.clean.validator import run_validation
    from tradeclock.classify.classifier import run_full_schedule_generation

    run_download(lookback_days=1095)
    run_validation()
    run_full_schedule_generation()
    console.print("[bold green]Refresh complete! Schedule updated successfully.[/]")


def main():
    parser = argparse.ArgumentParser(description="TradeClock Live IST Terminal & CLI")
    parser.add_argument("--demo", action="store_true", help="Run with bundled demo schedule")
    parser.add_argument("--now", action="store_true", help="Print single-line status for tmux/status bars")
    parser.add_argument("--day", type=str, default=None, help="Inspect schedule for specific day (e.g. mon, tue)")
    parser.add_argument("--json", action="store_true", help="Export status as JSON")
    parser.add_argument("subcommand", nargs="?", choices=["refresh"], help="Subcommand to execute (e.g. refresh)")

    args = parser.parse_args()

    if args.subcommand == "refresh":
        run_refresh_pipeline()
    elif args.now or args.json or args.day:
        run_single_status(now_mode=args.now, json_mode=args.json, day_filter=args.day, demo=args.demo)
    else:
        # Check if running in an interactive terminal TTY
        if sys.stdin.isatty():
            try:
                run_interactive_terminal(demo=args.demo)
            except (KeyboardInterrupt, SystemExit):
                console.print("\n[dim]TradeClock terminal closed.[/]")
        else:
            run_single_status(now_mode=False, demo=args.demo)


if __name__ == "__main__":
    main()
