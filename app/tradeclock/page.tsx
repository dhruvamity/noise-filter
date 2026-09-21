"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";

interface SlotStats {
  er_mean: number;
  range_cost_ratio: number;
  false_breakout_rate: number;
  follow_through_prob: number;
}

interface Slot {
  start_time: string;
  end_time: string;
  duration_minutes: number;
  label: "PRIME" | "SWING_ENTRY" | "SMALL_TRADES" | "NO_TRADE" | "CLOSED" | "WEEKEND_NO_TRADE";
  score: number;
  confidence: "HIGH" | "MED" | "LOW";
  bin_count: number;
  stats: SlotStats;
  bins: string[];
}

interface InstrumentSchedule {
  symbol: string;
  display_name: string;
  data_start_utc: string;
  data_end_utc: string;
  bar_count_5m: number;
  regimes: {
    [key: string]: {
      slots: {
        [weekday: string]: Slot[];
      };
      bins?: any;
    };
  };
}

interface ScheduleData {
  generated_at_utc: string;
  instruments: {
    [symbol: string]: InstrumentSchedule;
  };
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Fri-late"];

const LABEL_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  PRIME: { bg: "rgba(16, 185, 129, 0.15)", text: "#10b981", border: "#10b981", glow: "0 0 20px rgba(16, 185, 129, 0.3)" },
  SWING_ENTRY: { bg: "rgba(6, 182, 212, 0.15)", text: "#06b6d4", border: "#06b6d4", glow: "0 0 20px rgba(6, 182, 212, 0.3)" },
  SMALL_TRADES: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b", border: "#f59e0b", glow: "0 0 20px rgba(245, 158, 11, 0.2)" },
  NO_TRADE: { bg: "rgba(239, 68, 68, 0.15)", text: "#ef4444", border: "#ef4444", glow: "0 0 20px rgba(239, 68, 68, 0.2)" },
  CLOSED: { bg: "rgba(107, 114, 128, 0.15)", text: "#9ca3af", border: "#4b5563", glow: "none" },
  WEEKEND_NO_TRADE: { bg: "rgba(107, 114, 128, 0.15)", text: "#9ca3af", border: "#4b5563", glow: "none" },
};

export default function TradeClockPage() {
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("BTCUSDT");
  const [selectedWeekday, setSelectedWeekday] = useState<string>("Monday");
  const [nowIst, setNowIst] = useState<Date>(new Date());
  const [audioAlert, setAudioAlert] = useState<boolean>(false);

  // Fetch precomputed schedule on mount
  useEffect(() => {
    fetch("/tradeclock_schedule.json")
      .then((res) => res.json())
      .then((data) => {
        setSchedule(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load schedule:", err);
        setLoading(false);
      });
  }, []);

  // Real-time IST clock update
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // IST is UTC + 5 hours 30 minutes
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const istDate = new Date(utcMs + 5.5 * 3600000);
      setNowIst(istDate);
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Determine current active IST day
  const currentIstWeekday = useMemo(() => {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const day = dayNames[nowIst.getDay()];
    const hour = nowIst.getHours();
    if (day === "Saturday" && hour < 4) {
      return "Fri-late";
    }
    return day;
  }, [nowIst]);

  // Set default selected weekday to current IST weekday if weekday
  useEffect(() => {
    if (WEEKDAYS.includes(currentIstWeekday)) {
      setSelectedWeekday(currentIstWeekday);
    }
  }, [currentIstWeekday]);

  // Active DST regime based on date (US Summer: second Sunday March to first Sunday Nov)
  const activeRegime = useMemo(() => {
    const month = nowIst.getMonth() + 1; // 1-12
    if (month > 3 && month < 11) return "US_SUMMER";
    return "US_WINTER";
  }, [nowIst]);

  const activeInstrument = schedule?.instruments[selectedSymbol];
  const activeRegimeData = activeInstrument?.regimes[activeRegime] || activeInstrument?.regimes["POOLED"];
  const currentSlots = activeRegimeData?.slots[selectedWeekday] || [];

  // Find active slot right now
  const { currentSlot, nextSlot, secondsRemaining } = useMemo(() => {
    if (!currentSlots || currentSlots.length === 0) {
      return { currentSlot: null, nextSlot: null, secondsRemaining: 0 };
    }

    const curHour = nowIst.getHours();
    const curMin = nowIst.getMinutes();
    const curSec = nowIst.getSeconds();
    const curTotalSec = curHour * 3600 + curMin * 60 + curSec;

    let foundCurrent: Slot | null = null;
    let foundNext: Slot | null = null;
    let remSec = 0;

    for (let i = 0; i < currentSlots.length; i++) {
      const s = currentSlots[i];
      const [sh, sm] = s.start_time.split(":").map(Number);
      const [eh, em] = s.end_time.split(":").map(Number);
      const startSec = sh * 3600 + sm * 60;
      const endSec = eh === 0 && em === 0 && startSec > 0 ? 86400 : eh * 3600 + em * 60;

      if (curTotalSec >= startSec && curTotalSec < endSec) {
        foundCurrent = s;
        remSec = endSec - curTotalSec;
        foundNext = currentSlots[(i + 1) % currentSlots.length];
        break;
      }
    }

    return { currentSlot: foundCurrent, nextSlot: foundNext, secondsRemaining: remSec };
  }, [currentSlots, nowIst]);

  const minutesRem = Math.floor(secondsRemaining / 60);
  const secsRem = secondsRemaining % 60;

  // Timeline position (0% to 100%)
  const nowPercent = useMemo(() => {
    const totalSec = nowIst.getHours() * 3600 + nowIst.getMinutes() * 60 + nowIst.getSeconds();
    return ((totalSec / 86400) * 100).toFixed(2);
  }, [nowIst]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#090a0d", color: "#38bdf8" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: "12px", animation: "pulse 1.5s infinite" }}>◈</div>
          <div style={{ fontFamily: "JetBrains Mono", fontSize: "0.95rem" }}>LOADING TRADECLOCK IST PIPELINE...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#080b11", color: "#f3f5f9", padding: "24px 20px 60px", fontFamily: "JetBrains Mono, monospace" }}>
      <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
        
        {/* Top Header & Navigation */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "20px", borderBottom: "1px solid #1a2233", marginBottom: "28px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 10px #10b981" }} />
              <h1 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff", margin: 0 }}>
                TRADECLOCK <span style={{ color: "#38bdf8", fontWeight: 400, fontSize: "0.9rem" }}>v1.0 &bull; LIVE IST TERMINAL</span>
              </h1>
            </div>
            <div style={{ color: "#616b80", fontSize: "0.8rem", marginTop: "4px" }}>
              When to trade & when to stay flat &bull; 0 lookahead &bull; 5m IST alignment
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <Link
              href="/"
              style={{
                background: "#111726",
                border: "1px solid #222d42",
                color: "#9aa2b2",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "0.8rem",
                textDecoration: "none",
                transition: "all 0.2s ease",
              }}
            >
              &larr; Main Regime Terminal
            </Link>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ffffff", letterSpacing: "0.02em" }}>
                {nowIst.toTimeString().split(" ")[0]} <span style={{ fontSize: "0.8rem", color: "#38bdf8" }}>IST</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#9aa2b2" }}>
                {currentIstWeekday}, {nowIst.toISOString().split("T")[0]} &bull; <span style={{ color: "#10b981" }}>{activeRegime}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Instrument Selector Tabs */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
          {schedule &&
            Object.keys(schedule.instruments).map((sym) => {
              const isSelected = selectedSymbol === sym;
              const isGold = sym.includes("XAU");
              return (
                <button
                  key={sym}
                  onClick={() => setSelectedSymbol(sym)}
                  style={{
                    background: isSelected ? "rgba(56, 189, 248, 0.12)" : "#10141f",
                    border: isSelected ? "1px solid #38bdf8" : "1px solid #1a2333",
                    color: isSelected ? "#38bdf8" : "#9aa2b2",
                    padding: "12px 20px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: isSelected ? 600 : 400,
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ color: isGold ? "#f59e0b" : "#38bdf8" }}>{isGold ? "🪙" : "₿"}</span>
                  <span>{schedule.instruments[sym].display_name}</span>
                </button>
              );
            })}
        </div>

        {/* Hero Current Slot Card */}
        {currentSlot && (
          <div
            style={{
              background: "#101622",
              border: `1px solid ${LABEL_COLORS[currentSlot.label]?.border || "#38bdf8"}`,
              borderRadius: "12px",
              padding: "24px",
              marginBottom: "28px",
              boxShadow: LABEL_COLORS[currentSlot.label]?.glow || "none",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "24px", alignItems: "center" }}>
              {/* Status Banner */}
              <div>
                <div style={{ fontSize: "0.75rem", color: "#616b80", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                  CURRENT IST ACTIVE SLOT ({selectedWeekday})
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                  <span
                    style={{
                      fontSize: "2.2rem",
                      fontWeight: 800,
                      color: LABEL_COLORS[currentSlot.label]?.text || "#ffffff",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {currentSlot.label}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: "rgba(255,255,255,0.06)",
                      color: "#9aa2b2",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    CONF: {currentSlot.confidence}
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem", color: "#ffffff", marginTop: "8px", fontWeight: 500 }}>
                  Window: {currentSlot.start_time} &rarr; {currentSlot.end_time} ({currentSlot.duration_minutes}m total)
                </div>
              </div>

              {/* Countdown Clock */}
              <div style={{ borderLeft: "1px solid #1c2638", paddingLeft: "24px" }}>
                <div style={{ fontSize: "0.75rem", color: "#616b80", textTransform: "uppercase", marginBottom: "4px" }}>
                  COUNTDOWN TO SLOT EXPIRY
                </div>
                <div style={{ fontSize: "2rem", fontWeight: 700, color: minutesRem < 15 ? "#ef4444" : "#10b981", fontVariantNumeric: "tabular-nums" }}>
                  {String(minutesRem).padStart(2, "0")}:{String(secsRem).padStart(2, "0")}
                </div>
                {nextSlot && (
                  <div style={{ fontSize: "0.8rem", color: "#9aa2b2", marginTop: "6px" }}>
                    Next slot: <strong style={{ color: LABEL_COLORS[nextSlot.label]?.text || "#fff" }}>{nextSlot.label}</strong> at {nextSlot.start_time}
                  </div>
                )}
              </div>

              {/* Driving Metrics */}
              <div style={{ borderLeft: "1px solid #1c2638", paddingLeft: "24px" }}>
                <div style={{ fontSize: "0.75rem", color: "#616b80", textTransform: "uppercase", marginBottom: "10px" }}>
                  SLOT STATISTICAL PROFILE
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.82rem" }}>
                  <div>
                    <span style={{ color: "#616b80" }}>Trend Score: </span>
                    <strong style={{ color: "#ffffff" }}>{currentSlot.score} / 100</strong>
                  </div>
                  <div>
                    <span style={{ color: "#616b80" }}>ER (60m): </span>
                    <strong style={{ color: "#ffffff" }}>{currentSlot.stats.er_mean.toFixed(3)}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#616b80" }}>Range/Cost: </span>
                    <strong style={{ color: "#ffffff" }}>{currentSlot.stats.range_cost_ratio}x</strong>
                  </div>
                  <div>
                    <span style={{ color: "#616b80" }}>Follow-Thru: </span>
                    <strong style={{ color: "#ffffff" }}>{(currentSlot.stats.follow_through_prob * 100).toFixed(0)}%</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 24-Hour Visual Timeline Bar */}
        <div style={{ background: "#101622", border: "1px solid #1a2333", borderRadius: "10px", padding: "20px", marginBottom: "28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#ffffff" }}>
              24-HOUR IST TIMELINE &bull; {selectedWeekday.toUpperCase()}
            </span>
            <div style={{ display: "flex", gap: "16px", fontSize: "0.75rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#10b981" }} /> PRIME
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#06b6d4" }} /> SWING
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#f59e0b" }} /> SMALL
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#ef4444" }} /> NO TRADE
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#4b5563" }} /> CLOSED
              </span>
            </div>
          </div>

          {/* Continuous Multi-slot Bar */}
          <div style={{ position: "relative", height: "36px", background: "#0b0f17", borderRadius: "6px", overflow: "hidden", display: "flex" }}>
            {currentSlots.map((s, idx) => {
              const widthPct = ((s.duration_minutes / 1440) * 100).toFixed(2);
              const colorInfo = LABEL_COLORS[s.label] || LABEL_COLORS.NO_TRADE;
              return (
                <div
                  key={idx}
                  title={`${s.start_time} - ${s.end_time} | ${s.label} (${s.score} pts)`}
                  style={{
                    width: `${widthPct}%`,
                    height: "100%",
                    background: colorInfo.bg,
                    borderRight: "1px solid #1a2333",
                    borderTop: `3px solid ${colorInfo.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.65rem",
                    color: colorInfo.text,
                    fontWeight: 600,
                    cursor: "pointer",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.duration_minutes >= 90 ? s.label.replace("_TRADES", "").replace("_ENTRY", "") : ""}
                </div>
              );
            })}

            {/* Live [NOW] Pin */}
            {selectedWeekday === currentIstWeekday && (
              <div
                style={{
                  position: "absolute",
                  left: `${nowPercent}%`,
                  top: 0,
                  bottom: 0,
                  width: "2px",
                  background: "#ffffff",
                  boxShadow: "0 0 8px #ffffff",
                  zIndex: 10,
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "-8px",
                    left: "-5px",
                    width: "0",
                    height: "0",
                    borderLeft: "6px solid transparent",
                    borderRight: "6px solid transparent",
                    borderTop: "8px solid #ffffff",
                  }}
                />
              </div>
            )}
          </div>

          {/* Time markers */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#616b80", marginTop: "6px" }}>
            <span>00:00</span>
            <span>03:00</span>
            <span>06:00 (Asia Open)</span>
            <span>09:00</span>
            <span>12:00</span>
            <span>15:00 (London)</span>
            <span>18:00 (NY Open)</span>
            <span>21:00</span>
            <span>24:00</span>
          </div>
        </div>

        {/* Weekday Selector */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {WEEKDAYS.map((wd) => {
            const isSel = selectedWeekday === wd;
            const isToday = currentIstWeekday === wd;
            return (
              <button
                key={wd}
                onClick={() => setSelectedWeekday(wd)}
                style={{
                  background: isSel ? "#38bdf8" : "#111726",
                  color: isSel ? "#080b11" : isToday ? "#38bdf8" : "#9aa2b2",
                  border: isToday ? "1px solid #38bdf8" : "1px solid #1c2638",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: isSel || isToday ? 600 : 400,
                  transition: "all 0.15s ease",
                }}
              >
                {wd} {isToday && "(Today)"}
              </button>
            );
          })}
        </div>

        {/* Schedule Slots Table */}
        <div style={{ background: "#101622", border: "1px solid #1a2333", borderRadius: "10px", overflow: "hidden", marginBottom: "32px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid #1c2638", color: "#616b80" }}>
                <th style={{ padding: "12px 16px" }}>IST WINDOW</th>
                <th style={{ padding: "12px 16px" }}>DURATION</th>
                <th style={{ padding: "12px 16px" }}>CLASSIFICATION</th>
                <th style={{ padding: "12px 16px" }}>SCORE</th>
                <th style={{ padding: "12px 16px" }}>CONFIDENCE</th>
                <th style={{ padding: "12px 16px" }}>EFFICIENCY (ER)</th>
                <th style={{ padding: "12px 16px" }}>RANGE / COST</th>
                <th style={{ padding: "12px 16px" }}>FOLLOW-THROUGH</th>
                <th style={{ padding: "12px 16px" }}>FALSE BREAK</th>
              </tr>
            </thead>
            <tbody>
              {currentSlots.map((s, idx) => {
                const isCur = selectedWeekday === currentIstWeekday && currentSlot && s.start_time === currentSlot.start_time;
                const cInfo = LABEL_COLORS[s.label] || LABEL_COLORS.NO_TRADE;
                return (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid #151d2a",
                      background: isCur ? "rgba(56, 189, 248, 0.08)" : "transparent",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontWeight: isCur ? 700 : 500, color: isCur ? "#38bdf8" : "#ffffff" }}>
                      {isCur ? "► " : ""}{s.start_time} &ndash; {s.end_time}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#9aa2b2" }}>{s.duration_minutes}m</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 8px",
                          borderRadius: "4px",
                          background: cInfo.bg,
                          color: cInfo.text,
                          border: `1px solid ${cInfo.border}`,
                          fontWeight: 600,
                          fontSize: "0.75rem",
                        }}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#ffffff" }}>{s.score}</td>
                    <td style={{ padding: "12px 16px", color: s.confidence === "HIGH" ? "#10b981" : s.confidence === "MED" ? "#38bdf8" : "#9ca3af" }}>
                      {s.confidence}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#ffffff" }}>{s.stats.er_mean.toFixed(3)}</td>
                    <td style={{ padding: "12px 16px", color: "#ffffff" }}>{s.stats.range_cost_ratio}x</td>
                    <td style={{ padding: "12px 16px", color: "#ffffff" }}>{(s.stats.follow_through_prob * 100).toFixed(0)}%</td>
                    <td style={{ padding: "12px 16px", color: "#9aa2b2" }}>{(s.stats.false_breakout_rate * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Guidance */}
        <div style={{ textAlign: "center", color: "#616b80", fontSize: "0.75rem", borderTop: "1px solid #1a2233", paddingTop: "20px" }}>
          TradeClock IST Research & Live Terminal &bull; Historical statistical tendencies, not trade signals or financial advice &bull; Strictly 0 lookahead
        </div>

      </div>
    </div>
  );
}
