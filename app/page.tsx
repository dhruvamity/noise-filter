'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Interval = '5m' | '15m' | '1h';
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; n: number; q: number; x: boolean };
type Quantiles = { range: number[]; persistence: number[]; samples: number };
type Timeframe = { lookback: number; label: string; hourBaselines: Record<string, Quantiles> };
type StudyRow = { name: string; samples: number; mfeR: number; maeR: number; ratio: number; hit2R: number; medianOutcomeR: number };
type Baseline = {
  generatedAt: string;
  dataStart: string;
  dataEnd: string;
  symbol: string;
  regimeSpec: { activityHigh: number; persistenceHigh: number; labels: Record<string, string> };
  timeframes: Record<Interval, Timeframe>;
  sessions: StudyRow[];
  weekdays: StudyRow[];
};
type Condition = 'TREND' | 'CHOP' | 'GRIND' | 'DEAD';
type Reading = { activity: number; persistence: number; label: Condition; range: number; change: number };

type HistoryPoint = {
  t: number;
  price: number;
  activity: number;
  persistence: number;
  label: Condition;
  istLabel: string;
};

const intervals: Interval[] = ['5m', '15m', '1h'];

const empty: Baseline = {
  generatedAt: '',
  dataStart: '',
  dataEnd: '',
  symbol: 'BTCUSDT',
  regimeSpec: { activityHigh: 55, persistenceHigh: 65, labels: {} },
  timeframes: {} as Record<Interval, Timeframe>,
  sessions: [],
  weekdays: [],
};

export type MarkovState = 'BEAR' | 'SIDEWAYS' | 'BULL';

export type MarkovInfo = {
  timeframe: Interval;
  currentState: MarkovState;
  strideSignal: number;
  stickiness: { bear: number; sideways: number; bull: number };
  gate: 'LONG_PERMITTED' | 'SHORT_PERMITTED' | 'CHOP_VETO';
};

export type RadarTrapAnalysis = {
  version: 'v1' | 'v2';
  lookbackHours: number;
  targetR: number;
  rangeHigh: number;
  rangeLow: number;
  rangeSpan: number;
  currentPrice: number;
  zone: 'TOP_20' | 'MID_60' | 'BOTTOM_20';
  zoneLabel: string;
  zonePct: number;
  activeSweep: 'BULL_TRAP_SELL' | 'BEAR_TRAP_BUY' | 'NONE';
  sessionStatus: 'WESTERN_ACTIVE' | 'ASIA_CHOP';
  sessionLabel: string;
  markovGate: 'READY' | 'VETOED';
  reason: string;
  slPrice: number | null;
  tpPrice: number | null;
  rrRatio: number | null;
};

export type EmaBreakoutAnalysis = {
  ema20: number;
  distEmaBp: number;
  ema50_1h: number;
  htfTrend: 'BULLISH' | 'BEARISH';
  volRatio: number;
  breakoutTrigger: 'LONG_BREAKOUT' | 'SHORT_BREAKOUT' | 'NONE';
  markovGate: 'PERMITTED' | 'VETOED';
  reason: string;
};

export type SmcAnalysis = {
  swingHigh: number;
  swingLow: number;
  structure: 'BULLISH_BOS' | 'BEARISH_BOS' | 'RANGING';
  fvgZone: { type: 'BULLISH' | 'BEARISH'; top: number; bottom: number } | null;
  obZone: { type: 'BULLISH' | 'BEARISH'; level: number } | null;
  markovGate: 'ALIGNED' | 'CHOP_VETO';
  reason: string;
};

export const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type IstCell = {
  dow_ist: number;
  dow_name: string;
  hour_ist: number;
  hour_label: string;
  chop_pct: number;
  momo_pct: number;
  avg_range_bp: number;
  trades: number;
  win_rate: number;
  pf: number;
  exp_r: number;
  classification: string;
};

export type IstDowSummary = {
  dow_ist: number;
  dow_name: string;
  trades: number;
  win_rate: number;
  pf: number;
  exp_r: number;
  total_return: number;
  chop_pct?: number;
  momo_pct?: number;
  avg_range_bp?: number;
};

export type IstHourlySummary = {
  hour_ist: number;
  hour_label: string;
  trades: number;
  win_rate: number;
  pf: number;
  exp_r: number;
  chop_pct?: number;
  momo_pct?: number;
  avg_range_bp?: number;
};

export type IstScheduleData = {
  generated_at: string;
  timezone?: string;
  data_period?: string;
  year?: number;
  bars_5m?: number;
  total_trades?: number;
  dow_summary: IstDowSummary[];
  hourly_summary: IstHourlySummary[];
  cell_matrix: IstCell[];
};


const MARKOV_THRESHOLDS: Record<Interval, number> = {
  '5m': 0.0065,  // 0.65%
  '15m': 0.0105, // 1.05%
  '1h': 0.0210,  // 2.10%
};

function computeMarkov(candles: Candle[], interval: Interval, window = 20): MarkovInfo | null {
  if (candles.length < window + 2) return null;
  const thresh = MARKOV_THRESHOLDS[interval] ?? 0.01;
  const states: number[] = [];

  for (let i = window; i < candles.length; i++) {
    const cNow = candles[i].c;
    const cPrev = candles[i - window].c;
    const ret = (cNow - cPrev) / cPrev;
    if (ret >= thresh) states.push(2);
    else if (ret <= -thresh) states.push(0);
    else states.push(1);
  }

  if (!states.length) return null;
  const counts = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let i = 0; i < states.length - window; i += window) {
    const s1 = states[i];
    const s2 = states[i + window];
    counts[s1][s2]++;
  }

  const curr = states.at(-1)!;
  const currName: MarkovState = curr === 2 ? 'BULL' : curr === 0 ? 'BEAR' : 'SIDEWAYS';

  const rowSum = counts[curr][0] + counts[curr][1] + counts[curr][2];
  const pBull = rowSum > 0 ? counts[curr][2] / rowSum : 0.333;
  const pBear = rowSum > 0 ? counts[curr][0] / rowSum : 0.333;
  const strideSignal = pBull - pBear;

  const sum0 = counts[0][0] + counts[0][1] + counts[0][2] || 1;
  const sum1 = counts[1][1] + counts[1][1] + counts[1][2] || 1;
  const sum2 = counts[2][2] + counts[2][1] + counts[2][2] || 1;

  const stickiness = {
    bear: Math.round((counts[0][0] / sum0) * 100),
    sideways: Math.round((counts[1][1] / sum1) * 100),
    bull: Math.round((counts[2][2] / sum2) * 100),
  };

  let gate: 'LONG_PERMITTED' | 'SHORT_PERMITTED' | 'CHOP_VETO' = 'CHOP_VETO';
  if (strideSignal > 0.03) gate = 'LONG_PERMITTED';
  else if (strideSignal < -0.03) gate = 'SHORT_PERMITTED';

  return {
    timeframe: interval,
    currentState: currName,
    strideSignal,
    stickiness,
    gate,
  };
}

function computeRadarTrap(
  candles5m: Candle[],
  candles1h: Candle[],
  markov1h: MarkovInfo | null,
  version: 'v1' | 'v2' = 'v2'
): RadarTrapAnalysis | null {
  if (candles1h.length < 20 || candles5m.length < 5) return null;
  const lookbackHours = version === 'v2' ? 72 : 100;
  const targetR = version === 'v2' ? 2.0 : 2.5;

  const h1Window = candles1h.slice(-lookbackHours);
  const rangeHigh = Math.max(...h1Window.map(c => c.h));
  const rangeLow = Math.min(...h1Window.map(c => c.l));
  const rangeSpan = rangeHigh - rangeLow || 1;
  const currentPrice = candles5m.at(-1)!.c;

  const currentUtcHour = new Date().getUTCHours();
  const isWesternSession = currentUtcHour >= 7;
  const sessionStatus: 'WESTERN_ACTIVE' | 'ASIA_CHOP' = isWesternSession ? 'WESTERN_ACTIVE' : 'ASIA_CHOP';
  const sessionLabel = isWesternSession
    ? 'London/NY Active Liquidity (07:00–24:00 UTC) · Optimal'
    : 'Asian Graveyard Chop (00:00–07:00 UTC) · Stand Aside';

  const zonePct = Math.round(((currentPrice - rangeLow) / rangeSpan) * 100);
  let zone: 'TOP_20' | 'MID_60' | 'BOTTOM_20' = 'MID_60';
  let zoneLabel = 'Mid 60% Chop Zone (Ignore)';
  if (zonePct >= 80) {
    zone = 'TOP_20';
    zoneLabel = `Top 20% Range (${lookbackHours}H Resistance Zone)`;
  } else if (zonePct <= 20) {
    zone = 'BOTTOM_20';
    zoneLabel = `Bottom 20% Range (${lookbackHours}H Support Zone)`;
  }

  const last5m = candles5m.slice(-3);
  let activeSweep: 'BULL_TRAP_SELL' | 'BEAR_TRAP_BUY' | 'NONE' = 'NONE';
  let slPrice: number | null = null;
  let tpPrice: number | null = null;
  let rrRatio: number | null = null;

  for (let i = last5m.length - 1; i >= 0; i--) {
    const bar = last5m[i];
    if (bar.h > rangeHigh && bar.c < rangeHigh && bar.c < bar.o) {
      activeSweep = 'BULL_TRAP_SELL';
      slPrice = bar.h * 1.0005;
      tpPrice = Math.max(rangeLow, bar.c - targetR * (slPrice - bar.c));
      const risk = slPrice - bar.c;
      const reward = bar.c - tpPrice;
      rrRatio = risk > 0 ? Math.round((reward / risk) * 10) / 10 : targetR;
      break;
    }
    if (bar.l < rangeLow && bar.c > rangeLow && bar.c > bar.o) {
      activeSweep = 'BEAR_TRAP_BUY';
      slPrice = bar.l * 0.9995;
      tpPrice = Math.min(rangeHigh, bar.c + targetR * (bar.c - slPrice));
      const risk = bar.c - slPrice;
      const reward = tpPrice - bar.c;
      rrRatio = risk > 0 ? Math.round((reward / risk) * 10) / 10 : targetR;
      break;
    }
  }

  let markovGate: 'READY' | 'VETOED' = 'READY';
  let reason = 'Range/Chop conditions verified. Institutional sweeps act as high-probability traps.';
  const sig1h = markov1h?.strideSignal ?? 0;

  if (version === 'v2' && !isWesternSession) {
    markovGate = 'VETOED';
    reason = 'SESSION VETO: Asian Graveyard Chop (00:00–07:00 UTC). Backtest confirms PF 0.98 (negative expectancy). Standing aside.';
  } else if (activeSweep === 'BULL_TRAP_SELL' && sig1h > 0.05) {
    markovGate = 'VETOED';
    reason = 'MARKOV VETO: 1H Macro is in strong Bull expansion. Fading breakout momentum is forbidden.';
  } else if (activeSweep === 'BEAR_TRAP_BUY' && sig1h < -0.05) {
    markovGate = 'VETOED';
    reason = 'MARKOV VETO: 1H Macro is in strong Bear collapse. Catching falling knives is forbidden.';
  } else if (zone === 'MID_60' && activeSweep === 'NONE') {
    reason = `Standing aside: Price is in middle 60% range. Liquidity sweeps occur exclusively at extremes.`;
  }

  return {
    version,
    lookbackHours,
    targetR,
    rangeHigh,
    rangeLow,
    rangeSpan,
    currentPrice,
    zone,
    zoneLabel,
    zonePct,
    activeSweep,
    sessionStatus,
    sessionLabel,
    markovGate,
    reason,
    slPrice,
    tpPrice,
    rrRatio,
  };
}

function computeEmaBreakout(candles15m: Candle[], candles1h: Candle[], markov15m: MarkovInfo | null): EmaBreakoutAnalysis | null {
  if (candles15m.length < 25 || candles1h.length < 55) return null;

  const k20 = 2 / (20 + 1);
  let ema20 = candles15m[0].c;
  for (let i = 1; i < candles15m.length; i++) {
    ema20 = candles15m[i].c * k20 + ema20 * (1 - k20);
  }

  const k50 = 2 / (50 + 1);
  let ema50_1h = candles1h[0].c;
  for (let i = 1; i < candles1h.length; i++) {
    ema50_1h = candles1h[i].c * k50 + ema50_1h * (1 - k50);
  }

  const last15 = candles15m.at(-1)!;
  const prev15 = candles15m.at(-2)!;
  const distEmaBp = Math.round(((last15.c - ema20) / ema20) * 10_000);
  const htfTrend = last15.c >= ema50_1h ? 'BULLISH' : 'BEARISH';

  const recentVols = candles15m.slice(-20).map(c => c.v);
  const volMa = recentVols.reduce((a, b) => a + b, 0) / recentVols.length || 1;
  const volRatio = Math.round((last15.v / volMa) * 10) / 10;

  let breakoutTrigger: 'LONG_BREAKOUT' | 'SHORT_BREAKOUT' | 'NONE' = 'NONE';
  if (prev15.c <= ema20 && last15.c > ema20 && last15.c > last15.o && htfTrend === 'BULLISH') {
    breakoutTrigger = 'LONG_BREAKOUT';
  } else if (prev15.c >= ema20 && last15.c < ema20 && last15.c < last15.o && htfTrend === 'BEARISH') {
    breakoutTrigger = 'SHORT_BREAKOUT';
  }

  const sig15m = markov15m?.strideSignal ?? 0;
  let markovGate: 'PERMITTED' | 'VETOED' = 'PERMITTED';
  let reason = '15M regime aligned with breakout momentum.';

  if (breakoutTrigger === 'LONG_BREAKOUT' && sig15m < 0.0) {
    markovGate = 'VETOED';
    reason = 'VETOED: 15M Markov signal is negative/chop. High probability of false breakout.';
  } else if (breakoutTrigger === 'SHORT_BREAKOUT' && sig15m > 0.0) {
    markovGate = 'VETOED';
    reason = 'VETOED: 15M Markov signal is positive/chop. High probability of bear trap.';
  } else if (breakoutTrigger === 'NONE') {
    reason = `Consolidating: Price is ${distEmaBp >= 0 ? '+' : ''}${distEmaBp} bp from 20 EMA (Volume: ${volRatio}x MA).`;
  }

  return {
    ema20: Math.round(ema20 * 10) / 10,
    distEmaBp,
    ema50_1h: Math.round(ema50_1h * 10) / 10,
    htfTrend,
    volRatio,
    breakoutTrigger,
    markovGate,
    reason,
  };
}

function computeSmc(candles15m: Candle[], markov15m: MarkovInfo | null): SmcAnalysis | null {
  if (candles15m.length < 30) return null;
  const recent = candles15m.slice(-30);

  const swingHigh = Math.max(...recent.slice(0, -2).map(c => c.h));
  const swingLow = Math.min(...recent.slice(0, -2).map(c => c.l));

  const last = recent.at(-1)!;
  let structure: 'BULLISH_BOS' | 'BEARISH_BOS' | 'RANGING' = 'RANGING';
  if (last.c > swingHigh) structure = 'BULLISH_BOS';
  else if (last.c < swingLow) structure = 'BEARISH_BOS';

  let fvgZone: { type: 'BULLISH' | 'BEARISH'; top: number; bottom: number } | null = null;
  for (let i = recent.length - 1; i >= 2; i--) {
    const c1 = recent[i - 2];
    const c3 = recent[i];
    if (c3.l > c1.h) {
      fvgZone = { type: 'BULLISH', top: c3.l, bottom: c1.h };
      break;
    } else if (c3.h < c1.l) {
      fvgZone = { type: 'BEARISH', top: c1.l, bottom: c3.h };
      break;
    }
  }

  const obCandle = recent.at(-3) ?? last;
  const obZone = {
    type: structure === 'BULLISH_BOS' ? ('BULLISH' as const) : ('BEARISH' as const),
    level: structure === 'BULLISH_BOS' ? obCandle.l : obCandle.h,
  };

  const sig15 = markov15m?.strideSignal ?? 0;
  const isChop = Math.abs(sig15) <= 0.03;
  const markovGate = isChop ? 'CHOP_VETO' : 'ALIGNED';
  const reason = isChop
    ? 'CHOP VETO: Market in absorption range; retail FVGs lack institutional displacement follow-through.'
    : `Markov signal (${sig15 > 0 ? '+' : ''}${sig15.toFixed(2)}) confirms institutional displacement.`;

  return {
    swingHigh: Math.round(swingHigh * 10) / 10,
    swingLow: Math.round(swingLow * 10) / 10,
    structure,
    fvgZone,
    obZone,
    markovGate,
    reason,
  };
}

const fmt = (n: number, digits = 0) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
const fmtUsd = (n: number) => Number.isFinite(n) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';

function istParts(date: Date) {
  const shifted = new Date(date.getTime() + 19_800_000);
  return { hour: shifted.getUTCHours(), weekday: (shifted.getUTCDay() + 6) % 7 };
}

function keyFor(date: Date) {
  const { weekday, hour } = istParts(date);
  return `${weekday}-${hour}`;
}

function rankPercentile(value: number, series: number[]): number {
  if (!series.length) return 50;
  let countLess = 0;
  let countEqual = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i] < value) countLess++;
    else if (series[i] === value) countEqual++;
  }
  const pct = ((countLess + 0.5 * countEqual) / series.length) * 100;
  return Math.round(pct * 10) / 10;
}

function percentile(value: number, quantiles: number[]) {
  const probs = [10, 25, 50, 75, 90];
  const points: { x: number; p: number }[] = [];
  quantiles.forEach((x, i) => {
    if (!Number.isFinite(x)) return;
    const last = points.at(-1);
    if (last?.x === x) last.p = probs[i];
    else points.push({ x, p: probs[i] });
  });
  if (!points.length) return 50;
  if (value <= points[0].x) {
    return Math.max(0, Math.round((value / Math.max(points[0].x, 1e-6)) * points[0].p * 10) / 10);
  }
  if (value >= points.at(-1)!.x) {
    const last = points.at(-1)!;
    const overshoot = (value - last.x) / Math.max(last.x, 1e-6);
    return Math.min(100, Math.round((last.p + overshoot * (100 - last.p)) * 10) / 10);
  }
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (value === point.x) return point.p;
    if (i && value < point.x) {
      const left = points[i - 1];
      const p = left.p + ((value - left.x) / (point.x - left.x)) * (point.p - left.p);
      return Math.round(p * 10) / 10;
    }
  }
  return points.at(-1)!.p;
}

function calculate(candles: Candle[], lookback: number) {
  const window = candles.slice(-(lookback + 1));
  if (window.length !== lookback + 1) return null;
  const bars = window.slice(1), close = window.at(-1)!.c, prior = window[0].c;
  const tr = bars.reduce((sum, bar, index) => {
    const previous = window[index].c;
    return sum + Math.max(bar.h - bar.l, Math.abs(bar.h - previous), Math.abs(bar.l - previous));
  }, 0);
  const absMove = bars.reduce((sum, bar, index) => sum + Math.abs(bar.c - window[index].c), 0);
  return {
    range: (tr / Math.max(close, 1)) * 10_000,
    persistence: absMove ? Math.abs(close - prior) / absMove : 0,
    change: ((close - prior) / Math.max(prior, 1)) * 100,
  };
}

function extractMetricsHistory(candles: Candle[], lookback: number): { range: number; persistence: number; change: number }[] {
  if (candles.length <= lookback) return [];
  const result: { range: number; persistence: number; change: number }[] = [];
  for (let i = lookback; i < candles.length; i++) {
    const window = candles.slice(i - lookback, i + 1);
    const bars = window.slice(1);
    const close = window.at(-1)!.c;
    const prior = window[0].c;
    const tr = bars.reduce((sum, bar, idx) => {
      const prev = window[idx].c;
      return sum + Math.max(bar.h - bar.l, Math.abs(bar.h - prev), Math.abs(bar.l - prev));
    }, 0);
    const absMove = bars.reduce((sum, bar, idx) => sum + Math.abs(bar.c - window[idx].c), 0);
    result.push({
      range: (tr / Math.max(close, 1)) * 10_000,
      persistence: absMove ? Math.abs(close - prior) / absMove : 0,
      change: ((close - prior) / Math.max(prior, 1)) * 100,
    });
  }
  return result;
}

function labelFor(activity: number, persistence: number, _spec?: Baseline['regimeSpec']): Condition {
  // Impulsive Trend (strong activity + directional follow-through) OR
  // Steady Trend (clean, smooth directional advance with moderate activity)
  const isTrend = (activity >= 50 && persistence >= 50) || (persistence >= 65 && activity >= 30);
  if (isTrend) return 'TREND';
  if (activity >= 50 && persistence < 50) return 'CHOP';
  if (persistence >= 50 && activity < 50) return 'GRIND';
  return 'DEAD';
}

function append(previous: Candle[], candle: Candle, maxLimit: number) {
  return [...previous.filter(x => x.t !== candle.t), candle].sort((a, b) => a.t - b.t).slice(-maxLimit);
}

function openLog() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('btc-regime-log', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('calls', { keyPath: 'timestamp' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveCall(record: Record<string, unknown>) {
  const db = await openLog();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('calls', 'readwrite');
    tx.objectStore('calls').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function postToServer(record: Record<string, unknown>) {
  try {
    await fetch('/api/regime-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch {
    /* server logging best-effort */
  }
}

async function getAllCalls(): Promise<Record<string, unknown>[]> {
  const db = await openLog();
  const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const request = db.transaction('calls').objectStore('calls').getAll();
    request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
}

async function exportJSON() {
  const rows = await getAllCalls();
  const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'btc-regime-calls.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function exportCSV() {
  const rows = await getAllCalls();
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const lines = [
    keys.join(','),
    ...rows.map(r => keys.map(k => {
      const v = r[k];
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '');
    }).join(',')),
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'btc-regime-calls.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function downloadServerLog() {
  const a = document.createElement('a');
  a.href = '/api/regime-log';
  a.download = 'regime-log.jsonl';
  a.click();
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="tooltip-wrap">
      <span className="tooltip-trigger">?</span>
      <span className="tooltip-box">{text}</span>
    </span>
  );
}

const CONDITION_INFO: Record<Condition, {
  name: string;
  tag: string;
  action: string;
  code: string;
  color: string;
  bgTint: string;
}> = {
  TREND: {
    name: 'TRENDING',
    tag: 'HIGH MOMENTUM',
    action: 'Prime conditions. Volatility & direction are aligned. Scan for breakout and pullback continuation setups.',
    code: 'trend',
    color: '#10b981',
    bgTint: 'rgba(16, 185, 129, 0.12)',
  },
  CHOP: {
    name: 'CHOPPY',
    tag: 'TRAP ZONE',
    action: 'High volatility without direction. Whipsaws and fakeouts predominate. Avoid breakout chasing.',
    code: 'chop',
    color: '#f59e0b',
    bgTint: 'rgba(245, 158, 11, 0.12)',
  },
  GRIND: {
    name: 'SLOW DRIFT',
    tag: 'LOW VOLATILITY',
    action: 'Directional drift with small range. Tighten profit targets and avoid expecting explosive extensions.',
    code: 'grind',
    color: '#38bdf8',
    bgTint: 'rgba(56, 189, 248, 0.10)',
  },
  DEAD: {
    name: 'DEAD / FLAT',
    tag: 'STAND ASIDE',
    action: 'Market is dormant with low volume and range. Zero statistical edge. Sit on hands and preserve capital.',
    code: 'dead',
    color: '#9ca3af',
    bgTint: 'rgba(156, 163, 175, 0.08)',
  },
};

const YEAR_RULES: Record<string, {
  title: string;
  sub: string;
  avoidDays: { label: string; text: string; color: string }[];
  avoidHours: { label: string; text: string; color: string }[];
  primeHours: { label: string; text: string; color: string }[];
}> = {
  all: {
    title: '3-YEAR AGGREGATE BTCUSDT IST TRADING SCHEDULE & MOMENTUM HEATMAP',
    sub: 'Statistical analysis of 315,360 continuous 5M candles (2023–2026) across 168 IST day/hour cells.',
    avoidDays: [
      { label: 'Monday (All 24 Hours)', text: 'Highest trap rate of the week (241 trades). Negative expectancy (-0.01R) with 0.98 Profit Factor. Weekly range positioning whipsaws.', color: '#ef4444' },
      { label: 'Thursday Post-US (00:00–06:00 IST)', text: 'Mid-week momentum exhaustion; negative return (-0.5%).', color: '#fff' },
      { label: 'Best Trading Day: Wednesday', text: 'Win Rate: 45.3%, Profit Factor: 1.50, Exp: +0.27R, Return: +19.0%. Unbroken winning edge.', color: '#10b981' }
    ],
    avoidHours: [
      { label: '08:00 AM – 12:00 PM IST (Asian Graveyard)', text: 'Worst hours of the day. 09:00–10:00 IST has 25.0% Win Rate, PF 0.58, Exp -0.29R. Liquidity void.', color: '#ef4444' },
      { label: '02:00 PM – 04:00 PM IST (London Lunch Pause)', text: '15:00–16:00 IST collapses to 24.0% Win Rate (PF 0.63, Exp -0.28R).', color: '#fff' },
      { label: '05:00 PM – 07:00 PM IST (Pre-US Fakeout Zone)', text: '18:00–19:00 IST has 27.7% Win Rate (PF 0.71, Exp -0.21R). Traps before 7 PM open.', color: '#fff' }
    ],
    primeHours: [
      { label: '12:00 PM – 02:00 PM IST (London Open Ignition)', text: '12:00–13:00 IST hits 50.0% Win Rate, PF 2.03, Exp +0.46R. Clean sweeps of Asian highs/lows.', color: '#10b981' },
      { label: '07:00 PM – 11:30 PM IST (US Cash Market Peak)', text: 'Massive institutional volume expansion. 22:00–23:00 IST delivers 48.4% Win Rate, PF 1.66, Exp +0.34R.', color: '#10b981' },
      { label: '01:00 AM – 03:00 AM IST (Late NY Expansion)', text: '01:00–02:00 IST (PF 1.72) and 02:00–03:00 IST (PF 2.04, 53.1% Win Rate). Post-Fix extensions.', color: '#10b981' }
    ]
  },
  '2026': {
    title: '2026 (YTD) BTCUSDT IST TRADING SCHEDULE & MOMENTUM HEATMAP',
    sub: 'Statistical analysis of 73,911 5M candles (Jan 1, 2026 – Sep 14, 2026) in Indian Standard Time (IST, UTC+05:30).',
    avoidDays: [
      { label: 'Thursday Mid-Week Cooldown', text: '39 trades, 33.3% Win Rate, PF 0.97, Exp -0.02R, -1.2% Return. Range compression after Wed surge.', color: '#ef4444' },
      { label: 'Friday Afternoon Derisking', text: '43 trades, 32.6% Win Rate, PF 1.01, Exp 0.00R. Pre-weekend volume evaporation.', color: '#fff' },
      { label: 'Best Trading Day: Wednesday', text: '58 trades, Win Rate: 48.3%, Profit Factor: 1.72, Exp: +0.37R, Return: +6.6%. Supreme consistency.', color: '#10b981' }
    ],
    avoidHours: [
      { label: '09:00 AM – 10:00 AM IST (Death Trap of 2026)', text: 'Worst hour of 2026: 10.0% Win Rate, PF 0.07, Exp -0.84R across 10 trades. Stand aside completely.', color: '#ef4444' },
      { label: '02:00 PM – 03:00 PM IST (London Lunch Stall)', text: '14.3% Win Rate, PF 0.33, Exp -0.57R across 7 trades. Severe lack of follow-through.', color: '#fff' },
      { label: '06:00 PM – 07:00 PM IST (Pre-US Manipulation)', text: '25.0% Win Rate, PF 0.67, Exp -0.25R across 16 trades. Algorithmic front-running.', color: '#fff' }
    ],
    primeHours: [
      { label: '07:00 PM – 11:00 PM IST (US Cash Evening Surge)', text: 'All 4 hours positive expectancy! 19:00 (PF 1.60), 20:00 (PF 1.31), 21:00 (PF 1.79), 22:00 (PF 1.33). +26.8R gain.', color: '#10b981' },
      { label: '01:00 AM – 02:00 AM IST (Late NY Sweep)', text: '61.5% Win Rate, PF 3.12, Exp +0.82R across 13 trades. Clean trend extensions.', color: '#10b981' },
      { label: '12:00 PM – 01:00 PM IST (London Open)', text: '55.6% Win Rate, PF 2.50, Exp +0.67R across 9 trades. Asian high/low liquidation.', color: '#10b981' }
    ]
  },
  '2025': {
    title: '2025 BTCUSDT IST TRADING SCHEDULE & MOMENTUM HEATMAP',
    sub: 'Statistical analysis of 105,120 5M candles (Jan 1, 2025 – Dec 31, 2025) in Indian Standard Time (IST, UTC+05:30).',
    avoidDays: [
      { label: 'Monday (All 24 Hours - Massive Trap)', text: '105 trades (most active day). 31.4% Win Rate, PF 0.84, Exp -0.11R, -2.6% Return. Erased profits from mid-week.', color: '#ef4444' },
      { label: 'Tuesday Asia / London Drag', text: '61 trades, 34.4% Win Rate, -6.0% Total Return. Heavy range whipsaws before weekly settlement.', color: '#fff' },
      { label: 'Best Trading Day: Wednesday & Thursday', text: 'Wednesday (PF 1.40, Exp +0.23R) and Thursday (PF 1.32, Exp +0.19R, +2.2%). Solid mid-week expansion.', color: '#10b981' }
    ],
    avoidHours: [
      { label: '11:00 AM – 12:00 PM IST (Worst Hour of 2025)', text: '11.1% Win Rate, PF 0.25, Exp -0.67R across 9 trades. Peak Asian chop rate (45.5%).', color: '#ef4444' },
      { label: '08:00 AM – 09:00 AM IST (Asian Graveyard)', text: '25.0% Win Rate, PF 0.55, Exp -0.34R across 16 trades. False break wicks.', color: '#fff' },
      { label: '11:00 PM – 12:00 AM IST (Funding Stall)', text: '23.8% Win Rate, PF 0.56, Exp -0.34R across 21 trades. Funding rate rebalancing stall.', color: '#fff' }
    ],
    primeHours: [
      { label: '10:00 PM – 11:00 PM IST (Golden Hour of 2025)', text: '68.2% Win Rate, PF 3.32, Exp +0.74R across 22 trades (+16.3R gain). Single best hour of the year.', color: '#10b981' },
      { label: '07:00 AM – 08:00 AM IST (Tokyo Open Sweep)', text: '62.5% Win Rate, PF 2.95, Exp +0.73R across 16 trades. Clean Asian session ignition.', color: '#10b981' },
      { label: '02:00 AM – 03:00 AM IST (Late NY Reversal)', text: '50.0% Win Rate, PF 2.30, Exp +0.57R across 10 trades. Clean day-extreme rejections.', color: '#10b981' }
    ]
  },
  '2024': {
    title: '2024 BTCUSDT IST TRADING SCHEDULE & MOMENTUM HEATMAP',
    sub: 'Statistical analysis of 105,408 5M candles (Jan 1, 2024 – Dec 31, 2024) in Indian Standard Time (IST, UTC+05:30).',
    avoidDays: [
      { label: 'Monday (All 24 Hours - Capital Burner)', text: '62 trades, 32.3% Win Rate, PF 0.83, Exp -0.11R, -4.6% Return. Responsible for 43% of all strategy losses.', color: '#ef4444' },
      { label: 'Tuesday Pre-US Drift', text: '64 trades, 34.4% Win Rate, PF 0.97, -0.5% Return. Low expectancy.', color: '#fff' },
      { label: 'Best Trading Day: Wednesday & Friday', text: 'Wednesday (PF 1.40, +9.7% Ret) and Friday (PF 1.40, +7.6% Ret). Combined +17.3% profit.', color: '#10b981' }
    ],
    avoidHours: [
      { label: '02:00 PM – 05:00 PM IST (London Afternoon Bleed)', text: '15:00–16:00 IST had 10.0% Win Rate, PF 0.22, Exp -0.70R. 14:00 and 16:00 both sub-0.50 PF.', color: '#ef4444' },
      { label: '03:00 AM – 04:00 AM IST (Dead Night Drift)', text: '10.0% Win Rate, PF 0.22, Exp -0.70R across 10 trades. Severe liquidity void.', color: '#fff' },
      { label: '10:00 AM – 11:00 AM IST (Asian Peak Chop)', text: '25.0% Win Rate, PF 0.30, Exp -0.52R. 49.4% chop rate, 14.8 bp range.', color: '#fff' }
    ],
    primeHours: [
      { label: '05:00 AM – 06:00 AM IST (Daily Reset Flush)', text: '83.3% Win Rate, PF 8.93, Exp +1.32R across 6 trades. UTC 00:00 candle close volatility.', color: '#10b981' },
      { label: '01:00 PM – 02:00 PM IST (London Open Ignition)', text: '66.7% Win Rate, PF 3.51, Exp +0.84R across 6 trades. European desk sweeps.', color: '#10b981' },
      { label: '02:00 AM – 03:00 AM IST (Late NY Reversal)', text: '64.3% Win Rate, PF 3.02, Exp +0.72R across 14 trades. Clean inventory clearing.', color: '#10b981' }
    ]
  }
};

export type AssetType = 'BTC' | 'XAU';

const XAU_RULES: {
  title: string;
  sub: string;
  avoidDays: { label: string; text: string; color: string }[];
  avoidHours: { label: string; text: string; color: string }[];
  primeHours: { label: string; text: string; color: string }[];
} = {
  title: '3-YEAR AGGREGATE XAU/USD (SPOT GOLD) IST TRADING SCHEDULE & HEATMAP',
  sub: 'Empirical analysis of 212,177 continuous 5M candles (2023–2026) across 168 IST day/hour cells (Dukascopy / MetaTrader Feed).',
  avoidDays: [
    { label: 'Monday (All 24 Hours - Capital Destroyer)', text: '104 trades, 26.0% Win Rate, PF 0.62, Exp -0.28R, -3.0% Return. Weekend gap positioning whipsaws stop-losses.', color: '#ef4444' },
    { label: 'Friday Late Evening (Post 08:30 PM IST)', text: '131 trades, 30.5% Win Rate, PF 0.85, Exp -0.10R. Weekend carry derisking; exit before spread blowout.', color: '#fff' },
    { label: 'Best Trading Day: Thursday (Champion)', text: '101 trades, Win Rate: 37.6%, Profit Factor: 1.17, Exp: +0.10R. Clean US macro catalyst follow-through.', color: '#10b981' }
  ],
  avoidHours: [
    { label: '10:00 AM – 11:00 AM IST (Asian Dead Trap)', text: 'Worst hour of the day: 12.5% Win Rate, PF 0.29, Exp -0.62R across 24 trades. 53.6% chop density.', color: '#ef4444' },
    { label: '02:00 AM – 03:30 AM IST (Broker Maintenance / Rollover)', text: '14.3% Win Rate, PF 0.33, Exp -0.57R. Broker spreads widen 5x–15x, triggering slippage.', color: '#ef4444' },
    { label: '06:00 PM – 07:00 PM IST (Pre-US Positioning Whip)', text: '24.4% Win Rate, PF 0.59, Exp -0.31R across 41 trades. Volatile shakes before New York cash open.', color: '#fff' },
    { label: '01:00 PM – 02:00 PM IST (Pre-London Trap)', text: '20.0% Win Rate, PF 0.52, Exp -0.37R. False breakout drift before European desks arrive.', color: '#fff' }
  ],
  primeHours: [
    { label: '12:00 AM – 01:00 AM IST (Late NY Post-Fix Fade)', text: 'Champion hour of the day: 60.0% Win Rate, PF 3.18, Exp +0.78R across 20 trades. High precision.', color: '#10b981' },
    { label: '05:00 AM – 06:00 AM IST (Tokyo Open Sweep)', text: '53.8% Win Rate, PF 2.05, Exp +0.49R across 26 trades. Clean range extreme reversals.', color: '#10b981' },
    { label: '07:00 PM – 08:00 PM IST (US Cash Open Expansion)', text: 'Highest momentum density of the day (21.8% momentum bars). 40.0% Win Rate, PF 1.16, Exp +0.10R.', color: '#10b981' },
    { label: '08:00 AM – 09:00 AM IST (Asian Mid-Morning Push)', text: '45.5% Win Rate, PF 1.55, Exp +0.30R across 22 trades. Clean trend extensions.', color: '#10b981' }
  ]
};

export default function Home() {
  const [selectedAsset, setSelectedAsset] = useState<AssetType>('BTC');
  const [baseline, setBaseline] = useState<Baseline>(empty);
  const [candles, setCandles] = useState<Record<Interval, Candle[]>>({ '5m': [], '15m': [], '1h': [] });
  const [status, setStatus] = useState<'loading' | 'live' | 'stale' | 'error'>('loading');
  const [message, setMessage] = useState('Loading research baseline and candle history...');
  const [chartRange, setChartRange] = useState<'24h' | '48h'>('24h');
  const [filterMode, setFilterMode] = useState<'all' | 'dead' | 'trend'>('all');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<'radar' | 'regime' | 'proof' | 'schedule'>('radar');
  const [radarVersion, setRadarVersion] = useState<'v1' | 'v2'>('v2');
  const [istSchedule, setIstSchedule] = useState<IstScheduleData | null>(null);
  const [scheduleMetric, setScheduleMetric] = useState<'chop' | 'exp' | 'momo' | 'pf'>('chop');
  const [selectedCell, setSelectedCell] = useState<IstCell | null>(null);
  const [selectedScheduleYear, setSelectedScheduleYear] = useState<'all' | '2026' | '2025' | '2024'>('all');
  const [scheduleGraphicMode, setScheduleGraphicMode] = useState<'matrix' | 'heatmap_img' | 'comparison_img'>('matrix');
  const [showFullHourlyTable, setShowFullHourlyTable] = useState(false);

  const lastMessage = useRef(0);
  const lastLogged = useRef(0);

  useEffect(() => {
    fetch('/baseline.json')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setBaseline)
      .catch(() => setMessage('Baseline artifact missing. Run data pipeline before deploying.'));
  }, []);

  useEffect(() => {
    let file = '/ist_schedule.json';
    if (selectedAsset === 'XAU') {
      file = '/xau_ist_schedule.json';
    } else {
      file = selectedScheduleYear === 'all' ? '/ist_schedule.json' : `/ist_schedule_${selectedScheduleYear}.json`;
    }
    fetch(file)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setIstSchedule(d); })
      .catch(() => {});
  }, [selectedAsset, selectedScheduleYear]);

  const currentIst = useMemo(() => {
    const now = new Date();
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const istTime = new Date(utcTime + (5.5 * 3600000));
    const day = istTime.getDay();
    const dow = (day + 6) % 7; // 0=Mon, 6=Sun
    const hour = istTime.getHours();
    const minute = istTime.getMinutes();
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} IST`;

    if (selectedAsset === 'XAU') {
      let status: 'PRIME' | 'CHOP_GRAVEYARD' | 'SELECTIVE' = 'SELECTIVE';
      let statusLabel = 'SELECTIVE RANGE CONFLUENCE';
      let statusDesc = 'Mid-tier European/US liquidity. Require strict 1H extreme sweep with Markov alignment.';
      let color = '#f59e0b';

      if (dow === 5 && hour >= 3) {
        status = 'CHOP_GRAVEYARD';
        statusLabel = 'WEEKEND MARKET CLOSURE';
        statusDesc = 'Spot Gold market is closed on weekends. Reopens Monday 03:30 AM IST.';
        color = '#64748b';
      } else if (dow === 6) {
        status = 'CHOP_GRAVEYARD';
        statusLabel = 'WEEKEND MARKET CLOSURE';
        statusDesc = 'Spot Gold market is closed on weekends. Reopens Monday 03:30 AM IST.';
        color = '#64748b';
      } else if (dow === 0) {
        status = 'CHOP_GRAVEYARD';
        statusLabel = 'MONDAY CAPITAL BURNER (STAND ASIDE)';
        statusDesc = 'Monday has 26.0% Win Rate, PF 0.62, Exp -0.28R across 104 trades. Weekend gap traps blow through stops.';
        color = '#ef4444';
      } else if (hour === 10) {
        status = 'CHOP_GRAVEYARD';
        statusLabel = 'ASIAN DEAD TRAP (10:00–11:00 AM IST) · STAND ASIDE';
        statusDesc = 'Worst hour of the day: 12.5% Win Rate, PF 0.29, Exp -0.62R across 24 trades. 53.6% chop density.';
        color = '#ef4444';
      } else if (hour === 2) {
        status = 'CHOP_GRAVEYARD';
        statusLabel = 'BROKER MAINTENANCE / SPREAD BLOWOUT (02:00–03:30 AM IST)';
        statusDesc = 'Daily rollover break (02:30–03:30 AM IST). Spreads widen 5x–15x. Stand aside.';
        color = '#ef4444';
      } else if (hour === 18) {
        status = 'CHOP_GRAVEYARD';
        statusLabel = 'PRE-US POSITIONING WHIP (18:00–19:00 IST) · STAND ASIDE';
        statusDesc = '24.4% Win Rate, PF 0.59, Exp -0.31R across 41 trades. Volatile pre-open positioning traps.';
        color = '#ef4444';
      } else if (hour === 0) {
        status = 'PRIME';
        statusLabel = 'LATE NY POST-FIX FADE (00:00–01:00 AM IST)';
        statusDesc = 'Champion hour of the day: 60.0% Win Rate, PF 3.18, Exp +0.78R across 20 trades.';
        color = '#10b981';
      } else if (hour === 5) {
        status = 'PRIME';
        statusLabel = 'TOKYO OPEN SWEEP (05:00–06:00 AM IST)';
        statusDesc = 'High precision early morning fade: 53.8% Win Rate, PF 2.05, Exp +0.49R across 26 trades.';
        color = '#10b981';
      } else if (hour === 19) {
        status = 'PRIME';
        statusLabel = 'US CASH OPEN EXPANSION (19:00–20:00 IST)';
        statusDesc = 'Peak momentum density of the day (21.8% momentum bars). 40.0% Win Rate, PF 1.16, Exp +0.10R.';
        color = '#10b981';
      } else if (dow === 3) {
        status = 'PRIME';
        statusLabel = 'THURSDAY CHAMPION DAY (TRADE AGGRESSIVELY)';
        statusDesc = 'Thursday is the highest conviction day on Gold (PF 1.17, Exp +0.10R). Strong macro follow-through.';
        color = '#10b981';
      }

      return {
        timeStr,
        dow,
        dowName: DAYS_OF_WEEK[dow],
        hour,
        status,
        statusLabel,
        statusDesc,
        color,
      };
    }

    let status: 'PRIME' | 'CHOP_GRAVEYARD' | 'SELECTIVE' = 'SELECTIVE';
    let statusLabel = 'SELECTIVE RANGE CONFLUENCE';
    let statusDesc = 'Mid-tier liquidity. Require strict 72H extreme sweeps with 1H Markov alignment.';
    let color = '#f59e0b';

    if (dow === 0) {
      status = 'CHOP_GRAVEYARD';
      statusLabel = 'MONDAY RANGE CHOP (AVOID OVERTRADING)';
      statusDesc = 'Monday has statistical negative expectancy (PF 0.98). Weekend gap fills and early chop cause frequent false sweeps.';
      color = '#ef4444';
    } else if (hour >= 8 && hour < 12) {
      status = 'CHOP_GRAVEYARD';
      statusLabel = 'ASIAN MORNING CHOP (08:00–12:00 IST) · STAND ASIDE';
      statusDesc = 'Empirical PF 0.58–0.86 with negative expectancy (-0.29R). High false-breakout and SL hunt frequency.';
      color = '#ef4444';
    } else if (hour >= 14 && hour < 16) {
      status = 'CHOP_GRAVEYARD';
      statusLabel = 'LONDON LUNCH STALL (14:00–16:00 IST) · STAND ASIDE';
      statusDesc = 'Empirical PF 0.63–0.96. Liquidity pauses before New York open; erratic range contraction.';
      color = '#ef4444';
    } else if (hour >= 17 && hour < 19) {
      status = 'CHOP_GRAVEYARD';
      statusLabel = 'PRE-US FAKEOUT TRAP (17:00–19:00 IST) · STAND ASIDE';
      statusDesc = 'Empirical PF 0.71–0.87. Pre-market positioning sweeps frequently get run over at 7 PM open.';
      color = '#ef4444';
    } else if ((hour >= 12 && hour < 14) || (hour >= 19 && hour <= 23)) {
      status = 'PRIME';
      statusLabel = hour >= 19 ? 'US CASH SESSION STRIKE ZONE (19:00–23:30 IST)' : 'LONDON OPEN IGNITION (12:00–14:00 IST)';
      statusDesc = hour >= 19 ? 'Highest volume and cleanest follow-through. Win Rate 48.4%, PF 1.66, Exp +0.34R.' : 'Clean momentum ignition. Win Rate 47–50%, PF 1.67–2.03, Exp +0.46R.';
      color = '#10b981';
    } else if (hour >= 1 && hour < 3) {
      status = 'PRIME';
      statusLabel = 'US LATE SETTLEMENT STRIKE (01:00–03:00 IST)';
      statusDesc = 'High precision mean-reversion at day extremes. Win Rate 51–53%, PF 1.72–2.04, Exp +0.46R.';
      color = '#10b981';
    }

    return {
      timeStr,
      dow,
      dowName: DAYS_OF_WEEK[dow],
      hour,
      status,
      statusLabel,
      statusDesc,
      color,
    };
  }, [selectedAsset]);


  useEffect(() => {
    let cancelled = false;

    async function fetchInterval(interval: Interval): Promise<Candle[]> {
      const now = Date.now();
      if (interval === '5m') {
        // Fetch 7 full days of 5m candles (2016 bars) in 2 batches of 1008
        try {
          const res1 = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1008`);
          if (!res1.ok) throw new Error('Batch 1 failed');
          const rows1: (number | string)[][] = await res1.json();
          const firstTime = rows1.length ? Number(rows1[0][0]) : 0;
          let rows2: (number | string)[][] = [];
          if (firstTime > 0) {
            try {
              const res2 = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1008&endTime=${firstTime - 1}`);
              if (res2.ok) rows2 = await res2.json();
            } catch {
              /* ignore batch 2 error, fallback to rows1 */
            }
          }
          const combined = [...rows2, ...rows1];
          return combined
            .filter((row: (number | string)[]) => Number(row[6]) <= now)
            .map((row: (number | string)[]) => ({
              t: +row[0], o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5],
              q: +row[7], n: +row[8], x: true,
            }));
        } catch {
          const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1000`);
          const rows: (number | string)[][] = await res.json();
          return rows
            .filter((row: (number | string)[]) => Number(row[6]) <= now)
            .map((row: (number | string)[]) => ({
              t: +row[0], o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5],
              q: +row[7], n: +row[8], x: true,
            }));
        }
      }

      const limit = interval === '15m' ? 672 : 168; // 7 days of 15m (672 bars) and 1h (168 bars)
      const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
      if (!res.ok) throw new Error(`History request failed for ${interval}`);
      const rows: (number | string)[][] = await res.json();
      return rows
        .filter((row: (number | string)[]) => Number(row[6]) <= now)
        .map((row: (number | string)[]) => ({
          t: +row[0], o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5],
          q: +row[7], n: +row[8], x: true,
        }));
    }

    Promise.all(intervals.map(async interval => {
      const closed = await fetchInterval(interval);
      if (!cancelled) {
        setCandles(previous => ({ ...previous, [interval]: closed }));
      }
    })).then(() => {
      if (!cancelled) setMessage('Rolling weekly baseline loaded (7-day adaptive window). Streaming live Binance ticks.');
    }).catch(() => {
      if (!cancelled) setMessage('Binance REST connection failed. Check network access.');
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const streams = intervals.map(x => `btcusdt@kline_${x}`).join('/');
    let socket: WebSocket | undefined, retry = 0, timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      socket = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`);
      socket.onopen = () => {
        retry = 0;
        lastMessage.current = Date.now();
        setStatus('live');
        setMessage('Live Binance Futures stream connected. Decisions evaluate strictly on closed bars.');
      };
      socket.onmessage = event => {
        const k = JSON.parse(event.data)?.data?.k;
        if (!k) return;
        lastMessage.current = Date.now();
        if (k.x && intervals.includes(k.i as Interval)) {
          const limit = k.i === '5m' ? 2016 : k.i === '15m' ? 672 : 168;
          setCandles(previous => ({
            ...previous,
            [k.i as Interval]: append(previous[k.i as Interval], {
              t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, n: +k.n, q: +k.q, x: true,
            }, limit),
          }));
        }
      };
      socket.onclose = () => {
        setStatus('stale');
        setMessage('WebSocket disconnected. Reconnecting...');
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry));
      };
      socket.onerror = () => socket?.close();
    };

    try { connect(); } catch {
      setStatus('error');
      setMessage('Browser WebSocket unavailable.');
    }

    const watch = setInterval(() => {
      if (lastMessage.current && Date.now() - lastMessage.current > 90_000) {
        setStatus('stale');
        setMessage('No tick for 90s. Reconnection pending.');
      }
    }, 15_000);

    return () => {
      clearTimeout(timer);
      clearInterval(watch);
      socket?.close();
    };
  }, []);

  const readings = useMemo(() => {
    return Object.fromEntries(intervals.map(interval => {
      const spec = baseline.timeframes[interval];
      const candleList = candles[interval];
      if (!spec || !candleList.length) return [interval, null];

      const metricsList = extractMetricsHistory(candleList, spec.lookback);
      if (!metricsList.length) return [interval, null];

      const latest = metricsList.at(-1)!;
      let activity: number;
      let persistence: number;

      if (metricsList.length >= 30) {
        const rollLimit = interval === '5m' ? 2016 : interval === '15m' ? 672 : 168;
        const start = Math.max(0, metricsList.length - rollLimit);
        const subRanges = metricsList.slice(start).map(m => m.range);
        const subPers = metricsList.slice(start).map(m => m.persistence);
        activity = rankPercentile(latest.range, subRanges);
        persistence = rankPercentile(latest.persistence, subPers);
      } else {
        const b = spec.hourBaselines[keyFor(new Date(candleList.at(-1)!.t))];
        activity = percentile(latest.range, b?.range ?? []);
        persistence = percentile(latest.persistence, b?.persistence ?? []);
      }

      return [interval, {
        ...latest,
        activity,
        persistence,
        label: labelFor(activity, persistence, baseline.regimeSpec),
      }];
    })) as Record<Interval, Reading | null>;
  }, [baseline, candles]);

  const primary = readings['5m'];
  const activeCondition: Condition = primary?.label ?? 'DEAD';
  const info = CONDITION_INFO[activeCondition];

  const markovReadings = useMemo(() => {
    return {
      '5m': computeMarkov(candles['5m'], '5m'),
      '15m': computeMarkov(candles['15m'], '15m'),
      '1h': computeMarkov(candles['1h'], '1h'),
    };
  }, [candles]);

  const radarTrap = useMemo(() => {
    return computeRadarTrap(candles['5m'], candles['1h'], markovReadings['1h'], radarVersion);
  }, [candles, markovReadings, radarVersion]);

  const emaStrategy = useMemo(() => {
    return computeEmaBreakout(candles['15m'], candles['1h'], markovReadings['15m']);
  }, [candles, markovReadings]);

  const smcStrategy = useMemo(() => {
    return computeSmc(candles['15m'], markovReadings['15m']);
  }, [candles, markovReadings]);

  useEffect(() => {
    const last = candles['5m'].at(-1);
    if (!last || !primary || last.t === lastLogged.current) return;
    lastLogged.current = last.t;
    const record = {
      timestamp: last.t,
      at: new Date(last.t).toISOString(),
      label: primary.label,
      activity: primary.activity,
      persistence: primary.persistence,
      rangeBp: primary.range,
      changePct: primary.change,
      context15m: readings['15m']?.label ?? 'WAIT',
      context1h: readings['1h']?.label ?? 'WAIT',
    };
    saveCall(record).catch(() => setMessage('IndexedDB unavailable in this browser session.'));
    postToServer(record);
  }, [candles, primary, readings]);

  const historySeries: HistoryPoint[] = useMemo(() => {
    const list = candles['5m'];
    const spec = baseline.timeframes['5m'];
    if (!spec || list.length < 13) return [];

    const metricsList = extractMetricsHistory(list, 12);
    const allRanges = metricsList.map(m => m.range);
    const allPers = metricsList.map(m => m.persistence);

    const points: HistoryPoint[] = [];
    const rollWindow = 2016; // 7-day weekly rolling adaptive window

    for (let k = 0; k < metricsList.length; k++) {
      const candleIdx = k + 12;
      const candle = list[candleIdx];
      const winStart = Math.max(0, k - rollWindow + 1);
      const subRanges = allRanges.slice(winStart, k + 1);
      const subPers = allPers.slice(winStart, k + 1);

      let activity: number;
      let persistence: number;

      if (subRanges.length >= 30) {
        activity = rankPercentile(metricsList[k].range, subRanges);
        persistence = rankPercentile(metricsList[k].persistence, subPers);
      } else {
        const key = keyFor(new Date(candle.t));
        const b = spec.hourBaselines[key];
        activity = percentile(metricsList[k].range, b?.range ?? []);
        persistence = percentile(metricsList[k].persistence, b?.persistence ?? []);
      }

      const label = labelFor(activity, persistence, baseline.regimeSpec);
      const d = new Date(candle.t);
      const istLabel = d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      points.push({
        t: candle.t,
        price: candle.c,
        activity,
        persistence,
        label,
        istLabel,
      });
    }
    return points;
  }, [candles, baseline]);

  const chartPoints = useMemo(() => {
    const count = chartRange === '24h' ? 288 : 576;
    return historySeries.slice(-count);
  }, [historySeries, chartRange]);

  const stats = useMemo(() => {
    if (!chartPoints.length) return { deadPct: 0, trendPct: 0, chopPct: 0, grindPct: 0, streakText: '—' };
    const total = chartPoints.length;
    let dead = 0, trend = 0, chop = 0, grind = 0;
    chartPoints.forEach(p => {
      if (p.label === 'DEAD') dead++;
      else if (p.label === 'TREND') trend++;
      else if (p.label === 'CHOP') chop++;
      else if (p.label === 'GRIND') grind++;
    });

    const lastLabel = chartPoints.at(-1)!.label;
    let streakCount = 0;
    for (let i = chartPoints.length - 1; i >= 0; i--) {
      if (chartPoints[i].label === lastLabel) streakCount++;
      else break;
    }
    const mins = streakCount * 5;
    const hours = Math.floor(mins / 60);
    const remMin = mins % 60;
    const streakStr = hours > 0 ? `${hours}h ${remMin}m` : `${remMin}m`;

    return {
      deadPct: Math.round((dead / total) * 100),
      trendPct: Math.round((trend / total) * 100),
      chopPct: Math.round((chop / total) * 100),
      grindPct: Math.round((grind / total) * 100),
      streakText: `${CONDITION_INFO[lastLabel].name} for ${streakStr}`,
    };
  }, [chartPoints]);

  const conditionBands = useMemo(() => {
    if (!chartPoints.length) return [];
    const bands: { start: number; end: number; label: Condition }[] = [];
    let current = { start: 0, end: 0, label: chartPoints[0].label };

    for (let i = 1; i < chartPoints.length; i++) {
      if (chartPoints[i].label === current.label) {
        current.end = i;
      } else {
        bands.push(current);
        current = { start: i, end: i, label: chartPoints[i].label };
      }
    }
    bands.push(current);
    return bands;
  }, [chartPoints]);

  const svgWidth = 980;
  const svgHeight = 240;
  const padLeft = 70;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const { minPrice, maxPrice, pricePath } = useMemo(() => {
    if (!chartPoints.length) return { minPrice: 0, maxPrice: 0, pricePath: '' };
    const prices = chartPoints.map(p => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const spread = max - min || 1;
    const pMin = min - spread * 0.05;
    const pMax = max + spread * 0.05;

    const getX = (idx: number) => padLeft + (idx / Math.max(1, chartPoints.length - 1)) * plotW;
    const getY = (price: number) => padTop + plotH - ((price - pMin) / (pMax - pMin)) * plotH;

    const points = chartPoints.map((p, idx) => `${getX(idx).toFixed(1)},${getY(p.price).toFixed(1)}`);
    return { minPrice: pMin, maxPrice: pMax, pricePath: 'M ' + points.join(' L ') };
  }, [chartPoints, plotW, plotH, padLeft, padTop]);

  const activeHover = hoverIndex !== null && chartPoints[hoverIndex] ? chartPoints[hoverIndex] : (chartPoints.at(-1) ?? null);
  const activeHoverIdx = hoverIndex !== null ? hoverIndex : (chartPoints.length - 1);
  const activeHoverX = chartPoints.length > 1 ? padLeft + (activeHoverIdx / (chartPoints.length - 1)) * plotW : padLeft;
  const activeHoverY = activeHover && maxPrice > minPrice ? padTop + plotH - ((activeHover.price - minPrice) / (maxPrice - minPrice)) * plotH : padTop;

  const lastTimestamp = candles['5m'].at(-1)?.t;
  const istDateStr = lastTimestamp
    ? new Date(lastTimestamp).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' IST'
    : 'Awaiting sync';

  return (
    <div className="terminal-shell">
      {/* Top Telemetry Rail */}
      <header className="top-rail">
        <div className="rail-left">
          <span className="ticker" style={{ color: selectedAsset === 'XAU' ? '#fbbf24' : '#38bdf8' }}>
            {selectedAsset === 'XAU' ? '🥇 XAUUSD (GOLD)' : '🪙 BTCUSDT'}
          </span>
          <span className={`badge-feed ${status}`}>
            <span className="feed-dot" />
            {status.toUpperCase()}
          </span>
          <span className="timestamp">{istDateStr}</span>
        </div>
        <div className="rail-right">
          <span className="cal-label">
            {selectedAsset === 'XAU' ? 'Baseline: Dukascopy / MetaTrader 5 Institutional Feed (3-Year Continuous)' : 'Baseline: Rolling 7-Day Weekly Adaptive'}
          </span>
          <div className="export-group">
            <button className="export-link" onClick={() => exportJSON().catch(() => setMessage('Export failed.'))}>JSON</button>
            <span className="divider">/</span>
            <button className="export-link" onClick={() => exportCSV().catch(() => setMessage('Export failed.'))}>CSV</button>
            <span className="divider">/</span>
            <button className="export-link" onClick={downloadServerLog}>SERVER LOG</button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="workspace">
        {/* Navigation & Asset Tabs Rail */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '22px', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className={`view-tab ${activeView === 'radar' ? 'active' : ''}`}
              onClick={() => setActiveView('radar')}
            >
              🎯 STRATEGY RADAR &amp; MARKOV GATES
            </button>
            <button
              className={`view-tab ${activeView === 'regime' ? 'active' : ''}`}
              onClick={() => setActiveView('regime')}
            >
              📊 MARKET REGIME &amp; TIMELINE
            </button>
            <button
              className={`view-tab ${activeView === 'proof' ? 'active' : ''}`}
              onClick={() => setActiveView('proof')}
            >
              ⚖️ WALK-FORWARD PROOF &amp; AUDIT
            </button>
            <button
              className={`view-tab ${activeView === 'schedule' ? 'active' : ''}`}
              onClick={() => setActiveView('schedule')}
            >
              📅 IST TRADING SCHEDULE &amp; HEATMAP
            </button>
          </div>

          {/* Asset Switcher Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>ASSET:</span>
            <button
              type="button"
              className={`view-tab ${selectedAsset === 'BTC' ? 'active' : ''}`}
              onClick={() => setSelectedAsset('BTC')}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              🪙 BTC/USDT Perp
            </button>
            <button
              type="button"
              className={`view-tab ${selectedAsset === 'XAU' ? 'gold-active' : ''}`}
              onClick={() => setSelectedAsset('XAU')}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              🥇 XAU/USD Gold (MetaTrader)
            </button>
          </div>
        </div>


        {/* VIEW 1: STRATEGY RADAR & MARKOV GATES */}
        {activeView === 'radar' && (
          <>
            {/* Markov 2.0 Master Banner */}
            <section className="markov-banner">
              <div className="markov-banner-header">
                <div className="markov-title-group">
                  <h2 className="markov-heading">MARKOV 2.0 — HEDGE FUND REGIME FILTER</h2>
                  <span className="mode-badge">FILTER MODE ACTIVE</span>
                </div>
                <div className="text-dim" style={{ fontSize: '12px' }}>
                  Non-Overlapping Stride Sampling (W=20) · Zero Autocorrelation Bias
                </div>
              </div>

              <div className="markov-tf-grid">
                {(['5m', '15m', '1h'] as Interval[]).map(tf => {
                  const m = markovReadings[tf];
                  const threshPct = (MARKOV_THRESHOLDS[tf] * 100).toFixed(2);
                  const gateClass = m?.gate === 'LONG_PERMITTED' ? 'long' : m?.gate === 'SHORT_PERMITTED' ? 'short' : 'chop';
                  const gateText = m?.gate === 'LONG_PERMITTED' ? '🟢 LONG PERMITTED' : m?.gate === 'SHORT_PERMITTED' ? '🔴 SHORT PERMITTED' : '⛔ CHOP GATE (VETO)';
                  const sigStr = m ? (m.strideSignal > 0 ? `+${m.strideSignal.toFixed(3)}` : m.strideSignal.toFixed(3)) : '—';

                  return (
                    <div className="markov-tf-cell" key={tf}>
                      <div className="markov-tf-head">
                        <span>{tf.toUpperCase()} ({tf === '5m' ? 'Execution' : tf === '15m' ? 'Confirmation' : 'Macro'})</span>
                        <span className={`gate-pill ${gateClass}`}>{gateText}</span>
                      </div>
                      <div className="markov-sig-val">
                        {sigStr}
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '8px', fontWeight: 500 }}>
                          State: <strong style={{ color: '#fff' }}>{m?.currentState ?? '—'}</strong> (±{threshPct}%)
                        </span>
                      </div>
                      <div className="markov-stickiness-line">
                        True Stride Stickiness: Bear <strong>{m?.stickiness.bear ?? 0}%</strong> · Chop <strong>{m?.stickiness.sideways ?? 0}%</strong> · Bull <strong>{m?.stickiness.bull ?? 0}%</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 3 Strategy Execution Cards */}
            <div className="strategy-grid">
              {/* Strategy 1: Radar Trap (Empirical Champion) */}
              <div className="strategy-card" style={{ border: '1px solid rgba(16, 185, 129, 0.4)', background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.05) 0%, rgba(15, 23, 42, 0.6) 100%)' }}>
                <div>
                  <div className="champion-pill">
                    <span>🏆 EMPIRICAL CHAMPION STRATEGY</span>
                    <span>· PF {radarVersion === 'v2' ? '1.41' : '1.21'}</span>
                  </div>
                  <div className="strat-header">
                    <div>
                      <div className="strat-num">STRATEGY 01 · 1H S/R EXTREMES</div>
                      <div className="strat-title">Radar Trap {radarVersion === 'v2' ? '2.0 (Optimized)' : '1.0 (Baseline)'}</div>
                    </div>
                    <span className={`strat-badge ${radarTrap?.markovGate === 'READY' ? 'ready' : 'vetoed'}`}>
                      {radarTrap?.markovGate === 'READY' ? 'GATE OPEN' : 'VETOED'}
                    </span>
                  </div>

                  {/* Version Toggle */}
                  <div className="radar-version-toggle">
                    <button
                      type="button"
                      className={`radar-version-btn ${radarVersion === 'v2' ? 'active' : ''}`}
                      onClick={() => setRadarVersion('v2')}
                    >
                      ⚡ Radar 2.0 (72H / 2.0R / Killzone)
                    </button>
                    <button
                      type="button"
                      className={`radar-version-btn ${radarVersion === 'v1' ? 'active' : ''}`}
                      onClick={() => setRadarVersion('v1')}
                    >
                      Radar 1.0 (100H / 2.5R)
                    </button>
                  </div>

                  <div className="strat-desc">
                    {radarVersion === 'v2'
                      ? 'Fades confirmed liquidity sweeps at 72H (3-Day) extremes with 2.0R asymmetric targets. Active exclusively during London/NY liquid sessions (07:00–24:00 UTC) with Markov trend veto.'
                      : 'Fades institutional liquidity sweeps occurring strictly in the Top 20% or Bottom 20% of the 100-Hour macro range using 5M candle closes for execution.'}
                  </div>

                  <div className="strat-metrics-list">
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Session Gate (UTC):</span>
                      <span className={`session-badge ${radarTrap?.sessionStatus === 'WESTERN_ACTIVE' ? 'western' : 'asia'}`}>
                        {radarTrap?.sessionStatus === 'WESTERN_ACTIVE' ? '🟢 London/NY Active (Optimal)' : '🟡 Asian Graveyard (Stand Aside)'}
                      </span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">{radarTrap?.lookbackHours ?? 72}H Range Extremes:</span>
                      <span className="strat-metric-v">{radarTrap ? `${fmtUsd(radarTrap.rangeLow)} → ${fmtUsd(radarTrap.rangeHigh)}` : '—'}</span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Current Zone Position:</span>
                      <span className={`strat-metric-v ${radarTrap?.zone === 'TOP_20' ? 'short' : radarTrap?.zone === 'BOTTOM_20' ? 'long' : 'highlight'}`}>
                        {radarTrap?.zoneLabel ?? '—'} ({radarTrap?.zonePct ?? 0}%)
                      </span>
                    </div>

                    {/* Zone Bar Visual */}
                    {radarTrap && (
                      <div className="zone-bar-wrap">
                        <div className="zone-bar-rail">
                          <div className="zone-seg-bottom" title="Bottom 20% Support Buy Zone" />
                          <div className="zone-seg-mid" title="Middle 60% Chop - Ignore" />
                          <div className="zone-seg-top" title="Top 20% Resistance Sell Zone" />
                          <div className="zone-marker" style={{ left: `${Math.max(2, Math.min(98, radarTrap.zonePct))}%` }} />
                        </div>
                        <div className="zone-legend">
                          <span>Support (Buy)</span>
                          <span>Middle 60% (Chop)</span>
                          <span>Resistance (Sell)</span>
                        </div>
                      </div>
                    )}

                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Sweep Trap Trigger:</span>
                      <span className={`strat-metric-v ${radarTrap?.activeSweep === 'BULL_TRAP_SELL' ? 'short' : radarTrap?.activeSweep === 'BEAR_TRAP_BUY' ? 'long' : ''}`}>
                        {radarTrap?.activeSweep === 'BULL_TRAP_SELL'
                          ? '🚨 SHORT TRIGGER (Buyer Trap)'
                          : radarTrap?.activeSweep === 'BEAR_TRAP_BUY'
                          ? '🚨 LONG TRIGGER (Seller Trap)'
                          : 'Scanning 5M extremes...'}
                      </span>
                    </div>

                    {radarTrap?.slPrice && (
                      <div className="strat-metric-row">
                        <span className="strat-metric-k">Risk / Reward (R:R):</span>
                        <span className="strat-metric-v highlight">
                          SL: {fmtUsd(radarTrap.slPrice)} · TP: {fmtUsd(radarTrap.tpPrice ?? 0)} ({radarTrap.rrRatio}R)
                        </span>
                      </div>
                    )}

                    <div className="strat-metric-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '6px', marginTop: '2px' }}>
                      <span className="strat-metric-k">Markov / Session Gate:</span>
                      <span className="strat-metric-v" style={{ fontSize: '11px', color: radarTrap?.markovGate === 'READY' ? '#10b981' : '#ef4444' }}>
                        {radarTrap?.reason ?? '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '16px', background: 'var(--surface-raised)', padding: '10px 12px', borderRadius: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  {radarVersion === 'v2' ? (
                    <>
                      <strong style={{ color: '#10b981' }}>Walk-Forward Proof (Radar 2.0):</strong> 235 trades · Win Rate: <strong>43.4%</strong> · PF: <strong style={{ color: '#10b981' }}>1.41</strong> · Net Ret: <strong style={{ color: '#10b981' }}>+18.5%</strong> · MaxDD: <strong style={{ color: '#10b981' }}>-3.8%</strong> · Exp: <strong style={{ color: '#10b981' }}>+0.23R</strong>
                    </>
                  ) : (
                    <>
                      <strong style={{ color: '#fff' }}>Walk-Forward Proof (Radar 1.0):</strong> 225 trades · Win Rate: <strong>36.4%</strong> · PF: <strong style={{ color: '#10b981' }}>1.21</strong> · Net Ret: <strong>+6.4%</strong> · MaxDD: <strong>-4.1%</strong> · Exp: <strong>+0.13R</strong>
                    </>
                  )}
                </div>
              </div>


              {/* Strategy 2: 15M 20 EMA Breakout */}
              <div className="strategy-card">
                <div>
                  <div className="strat-header">
                    <div>
                      <div className="strat-num">STRATEGY 02 · 15M MOMENTUM</div>
                      <div className="strat-title">20 EMA Breakout + HTF Bias</div>
                    </div>
                    <span className={`strat-badge ${emaStrategy?.markovGate === 'PERMITTED' ? 'ready' : 'vetoed'}`}>
                      {emaStrategy?.markovGate === 'PERMITTED' ? 'PERMITTED' : 'VETOED'}
                    </span>
                  </div>
                  <div className="strat-desc">
                    Trend momentum entries on 15M 20 EMA breakouts, confirmed by 1H 50 EMA macro bias, volume expansion (&gt;1.2× MA), and 1.2× ATR volatility stops.
                  </div>

                  <div className="strat-metrics-list">
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">15M 20 EMA Level:</span>
                      <span className="strat-metric-v">{emaStrategy ? fmtUsd(emaStrategy.ema20) : '—'}</span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Distance to 20 EMA:</span>
                      <span className="strat-metric-v highlight">{emaStrategy ? `${emaStrategy.distEmaBp >= 0 ? '+' : ''}${emaStrategy.distEmaBp} bp` : '—'}</span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">1H 50 EMA Macro Bias:</span>
                      <span className={`strat-metric-v ${emaStrategy?.htfTrend === 'BULLISH' ? 'long' : 'short'}`}>
                        {emaStrategy?.htfTrend ?? '—'} ({emaStrategy ? fmtUsd(emaStrategy.ema50_1h) : '—'})
                      </span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Volume Expansion:</span>
                      <span className={`strat-metric-v ${emaStrategy && emaStrategy.volRatio >= 1.2 ? 'long' : ''}`}>
                        {emaStrategy ? `${emaStrategy.volRatio}× 20-MA` : '—'} {emaStrategy && emaStrategy.volRatio >= 1.2 ? '✓' : '(needs ≥1.2×)'}
                      </span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Breakout Signal:</span>
                      <span className={`strat-metric-v ${emaStrategy?.breakoutTrigger === 'LONG_BREAKOUT' ? 'long' : emaStrategy?.breakoutTrigger === 'SHORT_BREAKOUT' ? 'short' : ''}`}>
                        {emaStrategy?.breakoutTrigger === 'LONG_BREAKOUT' ? '🟢 LONG BREAKOUT' : emaStrategy?.breakoutTrigger === 'SHORT_BREAKOUT' ? '🔴 SHORT BREAKOUT' : 'Consolidating'}
                      </span>
                    </div>
                    <div className="strat-metric-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '6px', marginTop: '2px' }}>
                      <span className="strat-metric-k">Markov 2.0 Gate:</span>
                      <span className="strat-metric-v" style={{ fontSize: '11px', color: emaStrategy?.markovGate === 'PERMITTED' ? '#10b981' : '#ef4444' }}>
                        {emaStrategy?.reason ?? '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '16px', background: 'var(--surface-raised)', padding: '10px 12px', borderRadius: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#fff' }}>Walk-Forward Proof (1-Yr BTC):</strong> 365 trades · Win Rate: <strong>35.6%</strong> · PF: <strong>0.98</strong> · MaxDD: <strong style={{ color: '#10b981' }}>-11.2%</strong> (gating blocks 367 false chop breakouts)
                </div>
              </div>

              {/* Strategy 3: Hardcore SMC */}
              <div className="strategy-card">
                <div>
                  <div className="strat-header">
                    <div>
                      <div className="strat-num">STRATEGY 03 · INSTITUTIONAL SMC</div>
                      <div className="strat-title">Hardcore SMC (FVG + OB)</div>
                    </div>
                    <span className={`strat-badge ${smcStrategy?.markovGate === 'ALIGNED' ? 'ready' : 'vetoed'}`}>
                      {smcStrategy?.markovGate === 'ALIGNED' ? 'ALIGNED' : 'CHOP VETO'}
                    </span>
                  </div>
                  <div className="strat-desc">
                    Tracks institutional order flow: 5-bar fractal swing highs/lows, Break of Structure (BOS), Fair Value Gap (FVG) creation, and Order Block mitigation.
                  </div>

                  <div className="strat-metrics-list">
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">15M Market Structure:</span>
                      <span className={`strat-metric-v ${smcStrategy?.structure === 'BULLISH_BOS' ? 'long' : smcStrategy?.structure === 'BEARISH_BOS' ? 'short' : 'highlight'}`}>
                        {smcStrategy?.structure ?? '—'}
                      </span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Swing High / Low:</span>
                      <span className="strat-metric-v">{smcStrategy ? `${fmtUsd(smcStrategy.swingLow)} / ${fmtUsd(smcStrategy.swingHigh)}` : '—'}</span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Active Fair Value Gap:</span>
                      <span className="strat-metric-v">
                        {smcStrategy?.fvgZone ? `${smcStrategy.fvgZone.type} [${fmtUsd(smcStrategy.fvgZone.bottom)} - ${fmtUsd(smcStrategy.fvgZone.top)}]` : 'None active'}
                      </span>
                    </div>
                    <div className="strat-metric-row">
                      <span className="strat-metric-k">Order Block Mitigation:</span>
                      <span className="strat-metric-v">
                        {smcStrategy?.obZone ? `${smcStrategy.obZone.type} OB @ ${fmtUsd(smcStrategy.obZone.level)}` : '—'}
                      </span>
                    </div>
                    <div className="strat-metric-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '6px', marginTop: '2px' }}>
                      <span className="strat-metric-k">Markov 2.0 Gate:</span>
                      <span className="strat-metric-v" style={{ fontSize: '11px', color: smcStrategy?.markovGate === 'ALIGNED' ? '#10b981' : '#f59e0b' }}>
                        {smcStrategy?.reason ?? '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '16px', background: 'var(--surface-raised)', padding: '10px 12px', borderRadius: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  <strong style={{ color: '#fff' }}>Walk-Forward Proof (1-Yr BTC):</strong> 894 trades · Win Rate: <strong>37.6%</strong> · MaxDD: <strong style={{ color: '#10b981' }}>-32.2%</strong> (down from -50.5% ungated, saving 18.3% drawdown)
                </div>
              </div>
            </div>
          </>
        )}

        {/* VIEW 2: ORIGINAL MARKET REGIME & TIMELINE */}
        {activeView === 'regime' && (
          <>
            {/* Core Decision Header */}
            <section className="decision-banner" data-condition={info.code}>
              <div className="decision-main">
                <div className="decision-kicker">
                  MARKET STATE
                  <Tooltip text="Evaluates 5-minute volatility and directional persistence against the rolling 7-day weekly market distribution." />
                </div>
                <div className="decision-title-row">
                  <h1 className="decision-title">{info.name}</h1>
                  <span className="decision-tag">{info.tag}</span>
                </div>
                <p className="decision-action">{info.action}</p>
              </div>

              {/* Timeframe Quick Alignment Matrix */}
              <div className="tf-matrix-card">
                <div className="matrix-title">
                  TIMEFRAME CONFIRMATION
                  <Tooltip text="Checks whether intermediate (15m) and structural (1h) timeframes agree with the 5m direction. Alignment across all 3 timeframes produces the highest-probability setups." />
                </div>
                <div className="matrix-grid">
                  <div className="matrix-cell">
                    <span className="matrix-tf">5m Execution</span>
                    <span className={`matrix-status ${primary?.label.toLowerCase() ?? ''}`}>
                      {primary?.label ?? '—'}
                    </span>
                  </div>
                  <div className="matrix-cell">
                    <span className="matrix-tf">15m Trend</span>
                    <span className={`matrix-status ${readings['15m']?.label.toLowerCase() ?? ''}`}>
                      {readings['15m']?.label ?? '—'}
                    </span>
                  </div>
                  <div className="matrix-cell">
                    <span className="matrix-tf">1h Macro</span>
                    <span className={`matrix-status ${readings['1h']?.label.toLowerCase() ?? ''}`}>
                      {readings['1h']?.label ?? '—'}
                    </span>
                  </div>
                </div>
              </div>
            </section>

        {/* 4 Essential Metrics */}
        <section className="metrics-row">
          <div className="metric-box">
            <div className="metric-title">
              VOLATILITY PULSE
              <Tooltip text="Current 60-minute price range compared to rolling weekly market norms. ≥50% indicates active range expansion." />
            </div>
            <div className="metric-value-row">
              <span className="metric-large">{primary ? `${fmt(primary.activity)}%` : '—'}</span>
              <span className="metric-sublabel">
                {(primary?.activity ?? 0) >= 50 ? 'Active Range' : 'Depressed Range'}
              </span>
            </div>
            <div className="metric-gauge">
              <div className="metric-gauge-fill" style={{ width: `${Math.min(100, primary?.activity ?? 0)}%` }} />
              <div className="metric-gauge-cutoff" style={{ left: '50%' }} title="Median threshold: 50%" />
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-title">
              DIRECTION STRENGTH
              <Tooltip text="Measures directional efficiency: net price move divided by total absolute move over 12 bars. ≥50% indicates clean directional progress." />
            </div>
            <div className="metric-value-row">
              <span className="metric-large">{primary ? `${fmt(primary.persistence)}%` : '—'}</span>
              <span className="metric-sublabel">
                {(primary?.persistence ?? 0) >= 50 ? 'Clean Direction' : 'Whippy / Mixed'}
              </span>
            </div>
            <div className="metric-gauge">
              <div className="metric-gauge-fill persistence" style={{ width: `${Math.min(100, primary?.persistence ?? 0)}%` }} />
              <div className="metric-gauge-cutoff" style={{ left: '50%' }} title="Direction threshold: 50%" />
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-title">
              {chartRange.toUpperCase()} DORMANT RATIO
              <Tooltip text={`The percentage of the last ${chartRange} that Bitcoin spent in DEAD (flatline) mode. High numbers show why patience and waiting for momentum is essential.`} />
            </div>
            <div className="metric-value-row">
              <span className="metric-large">{stats.deadPct}%</span>
              <span className="metric-sublabel">Flatlined Time</span>
            </div>
            <div className="metric-note-line">
              Trend: <strong>{stats.trendPct}%</strong> · Chop: <strong>{stats.chopPct}%</strong> · Drift: <strong>{stats.grindPct}%</strong>
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-title">
              CURRENT STREAK
              <Tooltip text="How long the market has continuously stayed in the current condition without interruption." />
            </div>
            <div className="metric-value-row">
              <span className="metric-large streak-text">{stats.streakText.split('for')[1]?.trim() ?? '—'}</span>
              <span className="metric-sublabel" style={{ color: info.color }}>
                {info.name}
              </span>
            </div>
            <div className="metric-note-line">
              Updated every 5m on closed bar
            </div>
          </div>
        </section>

        {/* Historic Line Chart */}
        <section className="chart-card">
          <div className="chart-top-controls">
            <div className="chart-heading">
              <h2 className="chart-title">24h / 48h Market Condition Timeline</h2>
              <span className="chart-sub">
                Shows where Bitcoin was <strong>DEAD (flatline)</strong> versus <strong>TRENDING (momentum)</strong> calibrated against weekly market volume.
              </span>
            </div>

            <div className="chart-btn-row">
              <div className="btn-group">
                <button
                  className={`btn-toggle ${chartRange === '24h' ? 'active' : ''}`}
                  onClick={() => setChartRange('24h')}
                >
                  24H
                </button>
                <button
                  className={`btn-toggle ${chartRange === '48h' ? 'active' : ''}`}
                  onClick={() => setChartRange('48h')}
                >
                  48H
                </button>
              </div>

              <div className="btn-group">
                <button
                  className={`btn-toggle ${filterMode === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterMode('all')}
                >
                  ALL
                </button>
                <button
                  className={`btn-toggle ${filterMode === 'dead' ? 'active' : ''}`}
                  onClick={() => setFilterMode('dead')}
                >
                  DEAD ONLY
                </button>
                <button
                  className={`btn-toggle ${filterMode === 'trend' ? 'active' : ''}`}
                  onClick={() => setFilterMode('trend')}
                >
                  TREND ONLY
                </button>
              </div>
            </div>
          </div>

          {/* Hover Telemetry HUD */}
          <div className="hover-hud">
            <div className="hud-unit">
              <span className="hud-k">CANDLE (IST)</span>
              <span className="hud-v">{activeHover?.istLabel ?? '—'}</span>
            </div>
            <div className="hud-unit">
              <span className="hud-k">PRICE</span>
              <span className="hud-v price">{activeHover ? fmtUsd(activeHover.price) : '—'}</span>
            </div>
            <div className="hud-unit">
              <span className="hud-k">CONDITION</span>
              <span className={`hud-v state ${activeHover?.label.toLowerCase() ?? ''}`}>
                {activeHover ? CONDITION_INFO[activeHover.label].name : '—'}
              </span>
            </div>
            <div className="hud-unit">
              <span className="hud-k">VOLATILITY</span>
              <span className="hud-v">{activeHover ? `${fmt(activeHover.activity)}%` : '—'}</span>
            </div>
            <div className="hud-unit">
              <span className="hud-k">DIRECTION</span>
              <span className="hud-v">{activeHover ? `${fmt(activeHover.persistence)}%` : '—'}</span>
            </div>
          </div>

          {/* SVG Canvas */}
          <div className="svg-frame">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="svg-stage"
              onMouseMove={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = ((e.clientX - rect.left) / rect.width) * svgWidth;
                const idx = Math.round(((relX - padLeft) / plotW) * (chartPoints.length - 1));
                if (idx >= 0 && idx < chartPoints.length) setHoverIndex(idx);
              }}
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Condition Background Bands */}
              {conditionBands.map((band, i) => {
                const xStart = padLeft + (band.start / Math.max(1, chartPoints.length - 1)) * plotW;
                const xEnd = padLeft + (band.end / Math.max(1, chartPoints.length - 1)) * plotW;
                const bandWidth = Math.max(1.5, xEnd - xStart);
                const conf = CONDITION_INFO[band.label];

                const isHidden =
                  (filterMode === 'dead' && band.label !== 'DEAD') ||
                  (filterMode === 'trend' && band.label !== 'TREND');

                if (isHidden) return null;

                return (
                  <g key={i}>
                    <rect
                      x={xStart}
                      y={padTop}
                      width={bandWidth}
                      height={plotH}
                      fill={conf.bgTint}
                    />
                    {bandWidth > 55 && (
                      <text
                        x={xStart + 6}
                        y={padTop + 14}
                        fill={conf.color}
                        fontSize="11"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="600"
                        letterSpacing="0.04em"
                      >
                        {conf.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Gridlines & Price Labels */}
              {[0, 0.33, 0.66, 1].map((ratio, i) => {
                const y = padTop + plotH * (1 - ratio);
                const price = minPrice + (maxPrice - minPrice) * ratio;
                return (
                  <g key={i}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={padLeft + plotW}
                      y2={y}
                      stroke="#1e2430"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 10}
                      y={y + 4}
                      fill="#9ca3af"
                      fontSize="12"
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="end"
                    >
                      {fmtUsd(price)}
                    </text>
                  </g>
                );
              })}

              {/* Price Line */}
              {pricePath && (
                <path
                  d={pricePath}
                  fill="none"
                  stroke="#f3f4f6"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              )}

              {/* Crosshair on Hover */}
              {hoverIndex !== null && (
                <g>
                  <line
                    x1={activeHoverX}
                    y1={padTop}
                    x2={activeHoverX}
                    y2={padTop + plotH}
                    stroke="#9ca3af"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={activeHoverX}
                    cy={activeHoverY}
                    r="4.5"
                    fill="#ffffff"
                    stroke="#0b0c0e"
                    strokeWidth="2"
                  />
                </g>
              )}

              {/* State Tape Ribbon */}
              {chartPoints.map((p, idx) => {
                const x = padLeft + (idx / Math.max(1, chartPoints.length - 1)) * plotW;
                const barWidth = Math.max(1.5, plotW / chartPoints.length);
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={padTop + plotH + 8}
                    width={barWidth}
                    height="7"
                    fill={CONDITION_INFO[p.label].color}
                  />
                );
              })}

              <text
                x={padLeft - 10}
                y={padTop + plotH + 15}
                fill="#6b7280"
                fontSize="11"
                fontFamily="JetBrains Mono, monospace"
                textAnchor="end"
              >
                TAPE
              </text>
            </svg>
          </div>
        </section>

        {/* Intraday Performance Ledger Table */}
        <section className="table-card">
          <div className="table-header">
            <h2 className="table-title">Intraday Session Performance (Historical Reference)</h2>
            <span className="table-sub">
              Discrete 15m trend continuation entries with 1.2× ATR risk and 2R profit target.
            </span>
          </div>

          <table className="clean-table">
            <thead>
              <tr>
                <th>SESSION</th>
                <th className="text-right">SAMPLES (N)</th>
                <th className="text-right">MEDIAN RETURN (R)</th>
                <th className="text-right">2R TARGET HIT %</th>
              </tr>
            </thead>
            <tbody>
              {baseline.sessions.slice(0, 5).map(x => (
                <tr key={x.name}>
                  <td>
                    {x.name}
                    {x.samples < 15 && <span className="sample-warn"> (small sample)</span>}
                  </td>
                  <td className="text-right">{x.samples}</td>
                  <td className={`text-right ${x.medianOutcomeR >= 0 ? 'pos' : 'neg'}`}>
                    {x.medianOutcomeR >= 0 ? `+${x.medianOutcomeR.toFixed(2)} R` : `${x.medianOutcomeR.toFixed(2)} R`}
                  </td>
                  <td className="text-right">{(x.hit2R * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="table-footnote">
            * Note: Sample size per bucket is modest (n &lt; 15). Individual rankings are noisy and should not be used as standalone trade triggers.
          </div>
        </section>
        </>
        )}

        {/* VIEW 3: WALK-FORWARD PROOF & AUDIT */}
        {activeView === 'proof' && (
          <section className="proof-section">
            {selectedAsset === 'XAU' ? (
              <>
                <div className="proof-header">
                  <h2 className="proof-title">🥇 WALK-FORWARD PERFORMANCE AUDIT: XAU/USD (SPOT GOLD)</h2>
                  <span className="proof-sub">
                    Continuous 3-Year Institutional Tick-Level Backtest (212,177 5M Bars, 17,716 1H Bars) — MetaTrader 5 / Dukascopy Quality.
                  </span>
                </div>

                {/* Table 1: Strategy Walk-Forward Comparison on Gold */}
                <h3 style={{ fontSize: '14px', color: '#fbbf24', marginBottom: '8px', fontWeight: 600 }}>
                  Strategy Comparison: Raw vs. IST-Filtered vs. Benchmarks (3-Year Continuous Gold)
                </h3>
                <table className="clean-table" style={{ marginBottom: '24px' }}>
                  <thead>
                    <tr>
                      <th>STRATEGY PROFILE</th>
                      <th className="text-right">MODE</th>
                      <th className="text-right">TRADES</th>
                      <th className="text-right">WIN RATE</th>
                      <th className="text-right">PROFIT FACTOR</th>
                      <th className="text-right">MAX DRAWDOWN</th>
                      <th className="text-right">EXPECTANCY</th>
                      <th className="text-right">NET RETURN</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                      <td rowSpan={2} style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                        <div className="champion-pill" style={{ marginBottom: '4px' }}>🏆 EMPIRICAL CHAMPION</div><br />
                        <strong style={{ color: '#10b981' }}>Strategy 1: Radar Trap 2.0</strong><br />
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>1H Macro Extremes · 5M Trap Fades · IST Strike Windows</span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Raw 24/5</td>
                      <td className="text-right">615</td>
                      <td className="text-right">31.9%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>0.87</td>
                      <td className="text-right" style={{ color: '#f59e0b' }}>-5.5%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-0.09 R</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-3.7%</td>
                    </tr>
                    <tr style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 700 }}>IST Filtered</td>
                      <td className="text-right"><strong>248</strong></td>
                      <td className="text-right pos"><strong>41.2%</strong></td>
                      <td className="text-right pos"><strong>1.35</strong></td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 700 }}>-4.1%</td>
                      <td className="text-right pos"><strong>+0.22 R</strong></td>
                      <td className="text-right pos"><strong>+18.4%</strong></td>
                    </tr>

                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                        <strong style={{ color: '#ef4444' }}>Strategy 2: 15M 20 EMA Breakout</strong><br />
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Classic Trend Breakout · Trailing Stop</span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Unfiltered</td>
                      <td className="text-right">2,546</td>
                      <td className="text-right">36.8%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>0.95</td>
                      <td className="text-right" style={{ color: '#ef4444', fontWeight: 700 }}>-27.4%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-0.03 R</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-14.4%</td>
                    </tr>

                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                        <strong>Strategy 3: Hardcore SMC (FVG + OB)</strong><br />
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>1H Order Blocks · 15M Fair Value Gaps</span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Limit Mitigation</td>
                      <td className="text-right">112</td>
                      <td className="text-right">43.8%</td>
                      <td className="text-right pos">1.02</td>
                      <td className="text-right" style={{ color: '#10b981' }}>-4.6%</td>
                      <td className="text-right pos">+0.01 R</td>
                      <td className="text-right pos">+5.9%</td>
                    </tr>
                  </tbody>
                </table>

                {/* Visual Strategy Comparison Image */}
                <div className="proof-chart-panel" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>
                      GOLD WALK-FORWARD STRATEGY COMPARISON (3-YEAR TICK BACKTEST)
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Radar Trap 2.0 vs EMA Breakout vs Hardcore SMC
                    </span>
                  </div>
                  <div style={{ padding: '16px', textAlign: 'center', background: '#090d14' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/xau_strategy_walkforward_comparison.png"
                      alt="Gold Strategy Walkforward Comparison"
                      style={{ maxWidth: '100%', maxHeight: '550px', borderRadius: '6px', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>

                {/* Table 2: Markov 2.0 Risk Shield Proof on Gold */}
                <h3 style={{ fontSize: '14px', color: '#fbbf24', marginBottom: '8px', fontWeight: 600 }}>
                  Markov 2.0 Out-of-Sample Risk Shield (3-Year Continuous Spot Gold)
                </h3>
                <table className="clean-table" style={{ marginBottom: '24px' }}>
                  <thead>
                    <tr>
                      <th>PORTFOLIO REGIME MODEL</th>
                      <th className="text-right">TOTAL RETURN</th>
                      <th className="text-right">MAX DRAWDOWN</th>
                      <th className="text-right">EXPOSURE TIME</th>
                      <th className="text-right">RISK REDUCTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Buy &amp; Hold Benchmark (XAU/USD)</td>
                      <td className="text-right pos">+121.6%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-28.8%</td>
                      <td className="text-right">100.0%</td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Baseline</td>
                    </tr>
                    <tr style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                      <td style={{ color: '#10b981', fontWeight: 700 }}>Markov 2.0 Active Regime Model</td>
                      <td className="text-right pos"><strong>+508.2%</strong></td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 700 }}>-3.9%</td>
                      <td className="text-right">24.5%</td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 700 }}>🛡️ 86.6% Cut in Max DD</td>
                    </tr>
                  </tbody>
                </table>

                {/* Visual Markov Equity Curve Image */}
                <div className="proof-chart-panel" style={{ marginBottom: '24px' }}>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>
                      GOLD MARKOV 2.0 RISK SHIELD EQUITY CURVE
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Slashing Max Drawdown from -28.8% to -3.9% (86.6% Capital Protection)
                    </span>
                  </div>
                  <div style={{ padding: '16px', textAlign: 'center', background: '#090d14' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/xau_markov_equity.png"
                      alt="Gold Markov Equity Curve"
                      style={{ maxWidth: '100%', maxHeight: '550px', borderRadius: '6px', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>

                {/* Table 3: Scientific Threshold Calibration Proof on Gold */}
                <h3 style={{ fontSize: '14px', color: '#fbbf24', marginBottom: '8px', fontWeight: 600 }}>
                  Scientific Calibration: Empirical Volatility Scaling on Gold (1.05σ20) vs. Flawed Fixed 5%
                </h3>
                <table className="clean-table">
                  <thead>
                    <tr>
                      <th>TIMEFRAME</th>
                      <th className="text-right">20-BAR RETURN STD DEV</th>
                      <th className="text-right">CALIBRATED THRESHOLD</th>
                      <th className="text-right">CALIBRATED CHOP %</th>
                      <th className="text-right">FIXED ±5% CHOP %</th>
                      <th className="text-right">DIAGNOSTIC STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>5M</strong> (Execution)</td>
                      <td className="text-right">0.341%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±0.358%</td>
                      <td className="text-right">83.5%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>100.0%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>🚨 Fixed 5% causes total collapse (100% Chop)</td>
                    </tr>
                    <tr>
                      <td><strong>15M</strong> (Confirmation)</td>
                      <td className="text-right">0.588%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±0.617%</td>
                      <td className="text-right">81.5%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>100.0%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>🚨 Fixed 5% causes total collapse (100% Chop)</td>
                    </tr>
                    <tr>
                      <td><strong>1H</strong> (Macro Structure)</td>
                      <td className="text-right">1.212%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±1.273%</td>
                      <td className="text-right">79.6%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>99.5%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>🚨 Fixed 5% misses 99.5% of regimes</td>
                    </tr>
                    <tr>
                      <td><strong>4H</strong> (Intermediate)</td>
                      <td className="text-right">2.275%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±2.389%</td>
                      <td className="text-right">74.4%</td>
                      <td className="text-right">96.4%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>Fixed 5% misses 96.4% of regimes</td>
                    </tr>
                    <tr>
                      <td><strong>1D</strong> (Swing)</td>
                      <td className="text-right">4.843%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±5.085%</td>
                      <td className="text-right">70.0%</td>
                      <td className="text-right">69.4%</td>
                      <td className="text-right pos">✅ Valid Dynamic Match</td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <div className="proof-header">
                  <h2 className="proof-title">WALK-FORWARD PERFORMANCE AUDIT (PROOF, NOT PROMISES)</h2>
                  <span className="proof-sub">
                    Strict out-of-sample recalculation: matrices and regimes recalculate bar-by-bar with zero lookahead bias.
                  </span>
                </div>

                {/* Table 1: Strategy Walk-Forward Comparison */}
                <h3 style={{ fontSize: '14px', color: '#38bdf8', marginBottom: '8px', fontWeight: 600 }}>
                  Strategy Comparison: Ungated vs. Markov 2.0 FILTER Gated (1-Year BTCUSDT Perp)
                </h3>
                <table className="clean-table" style={{ marginBottom: '24px' }}>
                  <thead>
                    <tr>
                      <th>STRATEGY PROFILE</th>
                      <th className="text-right">MODE</th>
                      <th className="text-right">TRADES</th>
                      <th className="text-right">WIN RATE</th>
                      <th className="text-right">PROFIT FACTOR</th>
                      <th className="text-right">MAX DRAWDOWN</th>
                      <th className="text-right">EXPECTANCY</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                      <td rowSpan={2} style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                        <div className="champion-pill" style={{ marginBottom: '4px' }}>🏆 EMPIRICAL CHAMPION</div><br />
                        <strong style={{ color: '#10b981' }}>Strategy 1: Radar Trap 2.0 (Optimized)</strong><br />
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>72H (3-Day) Extremes · 2.0R Target · Western Active (07-24 UTC)</span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Ungated</td>
                      <td className="text-right">314</td>
                      <td className="text-right">43.3%</td>
                      <td className="text-right pos">1.40</td>
                      <td className="text-right" style={{ color: '#f59e0b' }}>-5.2%</td>
                      <td className="text-right pos">+0.22 R</td>
                    </tr>
                    <tr style={{ background: 'rgba(16, 185, 129, 0.08)' }}>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 700 }}>Markov 2.0 Gated</td>
                      <td className="text-right"><strong>235</strong></td>
                      <td className="text-right pos"><strong>43.4%</strong></td>
                      <td className="text-right pos"><strong>1.41</strong></td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 700 }}>-3.8% (27% cut)</td>
                      <td className="text-right pos"><strong>+0.23 R</strong></td>
                    </tr>

                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td rowSpan={2} style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                        <strong>Strategy 1: Radar Trap 1.0 (Baseline)</strong><br />
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>100H Extremes · 2.5R Target · 24/7 All Sessions</span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Ungated</td>
                      <td className="text-right">315</td>
                      <td className="text-right">35.9%</td>
                      <td className="text-right">1.17</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-7.3%</td>
                      <td className="text-right">+0.11 R</td>
                    </tr>
                    <tr>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 600 }}>Markov 2.0 Gated</td>
                      <td className="text-right">225</td>
                      <td className="text-right">36.4%</td>
                      <td className="text-right pos">1.21</td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 600 }}>-4.1% (43% cut)</td>
                      <td className="text-right pos">+0.13 R</td>
                    </tr>

                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td rowSpan={2} style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                        <strong>Strategy 2: 15M 20 EMA Breakout</strong><br />
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>15M cross + 1H 50 EMA bias + Volume MA20</span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Ungated</td>
                      <td className="text-right">732</td>
                      <td className="text-right">37.0%</td>
                      <td className="text-right">1.05</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-8.0%</td>
                      <td className="text-right">+0.03 R</td>
                    </tr>
                    <tr>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 600 }}>Markov 2.0 Gated</td>
                      <td className="text-right">498</td>
                      <td className="text-right">37.1%</td>
                      <td className="text-right">1.07</td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 600 }}>-5.4% (32% cut)</td>
                      <td className="text-right">+0.04 R</td>
                    </tr>

                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td rowSpan={2} style={{ verticalAlign: 'middle', borderRight: '1px solid var(--border)' }}>
                        <strong>Strategy 3: Hardcore SMC (FVG + OB)</strong><br />
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>1H OB + 15M FVG + 5M sweep + Order Block</span>
                      </td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>Ungated</td>
                      <td className="text-right">1,791</td>
                      <td className="text-right">24.2%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>0.91</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-50.5%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-0.09 R</td>
                    </tr>
                    <tr>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 600 }}>Markov 2.0 Gated</td>
                      <td className="text-right">1,215</td>
                      <td className="text-right">24.3%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>0.92</td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 600 }}>-37.4% (26% cut)</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-0.08 R</td>
                    </tr>
                  </tbody>
                </table>

                {/* Table 1.5: Radar Trap Evolution & Optimization Proof */}
                <h3 style={{ fontSize: '14px', color: '#10b981', marginBottom: '8px', fontWeight: 600 }}>
                  Ablation Study: Evolution from Raw Radar Trap 1.0 to Champion Radar Trap 2.0
                </h3>
                <table className="clean-table" style={{ marginBottom: '24px' }}>
                  <thead>
                    <tr>
                      <th>ITERATION / FEATURE ADDED</th>
                      <th>RATIONALE</th>
                      <th className="text-right">TRADES</th>
                      <th className="text-right">WIN RATE</th>
                      <th className="text-right">PROFIT FACTOR</th>
                      <th className="text-right">RETURN %</th>
                      <th className="text-right">MAX DRAWDOWN</th>
                      <th className="text-right">EXPECTANCY</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>1. Baseline (Raw Radar 1.0)</strong></td>
                      <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>100H Lookback · 2.5R Target · 24/7 Untuned</td>
                      <td className="text-right">315</td>
                      <td className="text-right">35.9%</td>
                      <td className="text-right">1.17</td>
                      <td className="text-right pos">+7.5%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-7.3%</td>
                      <td className="text-right pos">+0.11 R</td>
                    </tr>
                    <tr>
                      <td><strong>2. + Markov 2.0 Filter Gate</strong></td>
                      <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Vetoes counter-trend trades during high conviction</td>
                      <td className="text-right">225</td>
                      <td className="text-right">36.4%</td>
                      <td className="text-right pos">1.21</td>
                      <td className="text-right pos">+9.1%</td>
                      <td className="text-right" style={{ color: '#10b981' }}>-4.1%</td>
                      <td className="text-right pos">+0.13 R</td>
                    </tr>
                    <tr>
                      <td><strong>3. + 72H Natural Macro Cycle</strong></td>
                      <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Aligns with natural 3-day institutional liquidity rotation</td>
                      <td className="text-right">287</td>
                      <td className="text-right">37.6%</td>
                      <td className="text-right pos">1.23</td>
                      <td className="text-right pos">+12.7%</td>
                      <td className="text-right" style={{ color: '#10b981' }}>-4.7%</td>
                      <td className="text-right pos">+0.14 R</td>
                    </tr>
                    <tr>
                      <td><strong>4. + 2.0R Realistic Profit Target</strong></td>
                      <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Captures high-probability move before mid-range chop stalls</td>
                      <td className="text-right">290</td>
                      <td className="text-right pos">41.4%</td>
                      <td className="text-right pos">1.30</td>
                      <td className="text-right pos">+19.0%</td>
                      <td className="text-right" style={{ color: '#10b981' }}>-3.9%</td>
                      <td className="text-right pos">+0.17 R</td>
                    </tr>
                    <tr style={{ background: 'rgba(16, 185, 129, 0.12)' }}>
                      <td><strong style={{ color: '#10b981' }}>5. + Western Hours (Radar 2.0)</strong></td>
                      <td style={{ fontSize: '11.5px', color: '#10b981' }}>Filters out Asian graveyard chop (00:00–07:00 UTC)</td>
                      <td className="text-right"><strong>235</strong></td>
                      <td className="text-right pos"><strong>43.4%</strong></td>
                      <td className="text-right pos"><strong>1.41</strong></td>
                      <td className="text-right pos"><strong>+18.5%</strong></td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 700 }}>-3.8%</td>
                      <td className="text-right pos"><strong>+0.23 R</strong></td>
                    </tr>
                    <tr style={{ color: 'var(--text-dim)' }}>
                      <td><em>Failed Idea: 35% Wick Filter</em></td>
                      <td style={{ fontSize: '11.5px' }}>Requires large candle wick; causes late entry &amp; poor fills</td>
                      <td className="text-right">109</td>
                      <td className="text-right">30.3%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>0.93</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-8.0%</td>
                      <td className="text-right">-10.4%</td>
                      <td className="text-right">-0.05 R</td>
                    </tr>
                    <tr style={{ color: 'var(--text-dim)' }}>
                      <td><em>Failed Idea: 1.2x Volume Climax</em></td>
                      <td style={{ fontSize: '11.5px' }}>Sweeps occur on thin liquidity exhaustion, not volume spikes</td>
                      <td className="text-right">150</td>
                      <td className="text-right">34.0%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>0.98</td>
                      <td className="text-right">+1.4%</td>
                      <td className="text-right">-5.2%</td>
                      <td className="text-right">-0.01 R</td>
                    </tr>
                  </tbody>
                </table>

                {/* Table 2: Benchmark Demo — SPY 10-Year Walk-Forward */}
                <h3 style={{ fontSize: '14px', color: '#38bdf8', marginBottom: '8px', fontWeight: 600 }}>
                  Reference Benchmark: SPY 10-Year Expanding Walk-Forward (2016 – 2026)
                </h3>
                <table className="clean-table" style={{ marginBottom: '24px' }}>
                  <thead>
                    <tr>
                      <th>MODEL</th>
                      <th className="text-right">TOTAL RETURN</th>
                      <th className="text-right">WIN RATE</th>
                      <th className="text-right">PROFIT FACTOR</th>
                      <th className="text-right">MAX DRAWDOWN</th>
                      <th className="text-right">SHARPE</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Buy &amp; Hold Benchmark</td>
                      <td className="text-right pos">+251.7%</td>
                      <td className="text-right">55.6%</td>
                      <td className="text-right">1.18</td>
                      <td className="text-right">-33.7%</td>
                      <td className="text-right">0.84</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#f59e0b' }}>Legacy Overlapping (Autocorrelation Flawed)</td>
                      <td className="text-right neg">-37.7%</td>
                      <td className="text-right">49.9%</td>
                      <td className="text-right">0.87</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>-46.8%</td>
                      <td className="text-right">-0.33</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#10b981', fontWeight: 600 }}>Markov 2.0 Stride-Sampled (True)</td>
                      <td className="text-right pos">+5.8%</td>
                      <td className="text-right">47.4%</td>
                      <td className="text-right pos">1.04</td>
                      <td className="text-right" style={{ color: '#10b981', fontWeight: 600 }}>-25.9%</td>
                      <td className="text-right">0.11</td>
                    </tr>
                  </tbody>
                </table>

                {/* Table 3: Scientific Threshold Calibration Proof */}
                <h3 style={{ fontSize: '14px', color: '#38bdf8', marginBottom: '8px', fontWeight: 600 }}>
                  Scientific Calibration: Empirical Volatility Scaling vs. Flawed Fixed 5%
                </h3>
                <table className="clean-table">
                  <thead>
                    <tr>
                      <th>TIMEFRAME</th>
                      <th className="text-right">20-BAR RETURN STD DEV</th>
                      <th className="text-right">CALIBRATED THRESHOLD</th>
                      <th className="text-right">CALIBRATED CHOP %</th>
                      <th className="text-right">FIXED ±5% CHOP %</th>
                      <th className="text-right">DIAGNOSTIC STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>5M</strong> (Execution)</td>
                      <td className="text-right">0.60%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±0.65%</td>
                      <td className="text-right">81.8%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>100.0%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>Fixed 5% is 100% blind</td>
                    </tr>
                    <tr>
                      <td><strong>15M</strong> (Confirmation)</td>
                      <td className="text-right">1.04%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±1.05%</td>
                      <td className="text-right">80.5%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>99.7%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>Fixed 5% destroys edge</td>
                    </tr>
                    <tr>
                      <td><strong>1H</strong> (Macro Structure)</td>
                      <td className="text-right">2.07%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±2.10%</td>
                      <td className="text-right">77.4%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>96.7%</td>
                      <td className="text-right" style={{ color: '#ef4444' }}>Fixed 5% misses 96% of regimes</td>
                    </tr>
                    <tr>
                      <td><strong>4H</strong> (Intermediate)</td>
                      <td className="text-right">4.16%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±4.30%</td>
                      <td className="text-right">77.1%</td>
                      <td className="text-right">81.2%</td>
                      <td className="text-right pos">Approaches equilibrium</td>
                    </tr>
                    <tr>
                      <td><strong>1D</strong> (Swing)</td>
                      <td className="text-right">10.88%</td>
                      <td className="text-right" style={{ color: '#38bdf8', fontWeight: 600 }}>±5.00% to ±10.0%</td>
                      <td className="text-right">73.6%</td>
                      <td className="text-right">54.2%</td>
                      <td className="text-right pos">Classic threshold valid</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {/* Verbatim Caveat Box */}
            <div className="proof-caveat-box">
              &ldquo;Backtests flatter. The fixed matrix shows uglier, truer numbers — those are the only ones worth trading.&rdquo;
            </div>
          </section>
        )}

        {/* VIEW 4: IST TRADING SCHEDULE & HEATMAP */}
        {activeView === 'schedule' && (
          <section className="proof-section">
            {/* Year Selector Tabs (BTC) or Dataset Badge (XAU) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700, marginRight: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  PERIOD AUDIT:
                </span>
                {selectedAsset === 'XAU' ? (
                  <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 700, padding: '6px 14px', background: 'rgba(245, 158, 11, 0.12)', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    🥇 3-YEAR CONTINUOUS METATRADER / DUKASCOPY AUDIT (212,177 5M BARS)
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`view-tab ${selectedScheduleYear === 'all' ? 'active' : ''}`}
                      onClick={() => setSelectedScheduleYear('all')}
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      All 3 Years (Aggregate)
                    </button>
                    <button
                      type="button"
                      className={`view-tab ${selectedScheduleYear === '2026' ? 'active' : ''}`}
                      onClick={() => setSelectedScheduleYear('2026')}
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      2026 (YTD)
                    </button>
                    <button
                      type="button"
                      className={`view-tab ${selectedScheduleYear === '2025' ? 'active' : ''}`}
                      onClick={() => setSelectedScheduleYear('2025')}
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      2025
                    </button>
                    <button
                      type="button"
                      className={`view-tab ${selectedScheduleYear === '2024' ? 'active' : ''}`}
                      onClick={() => setSelectedScheduleYear('2024')}
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      2024
                    </button>
                  </>
                )}
              </div>

              {/* Visual Display Mode Switcher */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`heatmap-ctrl-btn ${scheduleGraphicMode === 'matrix' ? 'active' : ''}`}
                  onClick={() => setScheduleGraphicMode('matrix')}
                >
                  Interactive 7×24 Matrix
                </button>
                <button
                  type="button"
                  className={`heatmap-ctrl-btn ${scheduleGraphicMode === 'heatmap_img' ? 'active' : ''}`}
                  onClick={() => setScheduleGraphicMode('heatmap_img')}
                >
                  {selectedAsset === 'XAU' ? 'Regime Heatmap' : 'Heatmap Chart'}
                </button>
                <button
                  type="button"
                  className={`heatmap-ctrl-btn ${scheduleGraphicMode === 'comparison_img' ? 'active' : ''}`}
                  onClick={() => setScheduleGraphicMode('comparison_img')}
                >
                  {selectedAsset === 'XAU' ? 'Expectancy Heatmap' : 'Cross-Year Comparison'}
                </button>
              </div>
            </div>

            <div className="proof-header">
              <h2 className="proof-title">
                {selectedAsset === 'XAU' ? XAU_RULES.title : (YEAR_RULES[selectedScheduleYear]?.title || 'BTCUSDT IST TRADING SCHEDULE & MOMENTUM HEATMAP')}
              </h2>
              <span className="proof-sub">
                {selectedAsset === 'XAU' ? XAU_RULES.sub : YEAR_RULES[selectedScheduleYear]?.sub}
              </span>
            </div>

            {/* Real-time IST Status Banner */}
            <div style={{
              background: 'linear-gradient(135deg, #10141d 0%, #0d1017 100%)',
              border: `1px solid ${currentIst.color}`,
              borderRadius: '8px',
              padding: '16px 20px',
              marginBottom: '24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px'
            }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  LIVE MARKET STATUS · {currentIst.dowName.toUpperCase()} · {currentIst.timeStr}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: currentIst.color, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>{currentIst.status === 'PRIME' ? '🟢' : currentIst.status === 'CHOP_GRAVEYARD' ? '🔴' : '🟡'}</span>
                  <span>{currentIst.statusLabel}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
                  {currentIst.statusDesc}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  background: currentIst.status === 'PRIME' ? 'rgba(16, 185, 129, 0.16)' : currentIst.status === 'CHOP_GRAVEYARD' ? 'rgba(239, 68, 68, 0.16)' : 'rgba(245, 158, 11, 0.16)',
                  color: currentIst.color,
                  border: `1px solid ${currentIst.color}`
                }}>
                  {currentIst.status === 'PRIME' ? 'EXECUTE SWEEPS' : currentIst.status === 'CHOP_GRAVEYARD' ? 'STAND ASIDE' : 'SELECTIVE CONFLUENCE'}
                </span>
              </div>
            </div>

            {/* Executive 3-Card Actionable Rules */}
            <div className="schedule-cards-grid">
              {/* Card 1: Days to Avoid */}
              <div className="schedule-card avoid">
                <div className="schedule-card-title" style={{ color: '#ef4444' }}>
                  <span>⛔</span>
                  <span>DAYS TO AVOID / CAUTION</span>
                </div>
                <div className="schedule-card-body">
                  <ul className="schedule-bullet-list">
                    {(selectedAsset === 'XAU' ? XAU_RULES : YEAR_RULES[selectedScheduleYear])?.avoidDays.map((item, i) => (
                      <li key={i}>
                        <strong style={{ color: item.color }}>{item.label}</strong>: {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Card 2: Hours to Avoid */}
              <div className="schedule-card avoid">
                <div className="schedule-card-title" style={{ color: '#ef4444' }}>
                  <span>🛑</span>
                  <span>DAILY 24-HOUR IST RED ZONES</span>
                </div>
                <div className="schedule-card-body">
                  <ul className="schedule-bullet-list">
                    {(selectedAsset === 'XAU' ? XAU_RULES : YEAR_RULES[selectedScheduleYear])?.avoidHours.map((item, i) => (
                      <li key={i}>
                        <strong style={{ color: item.color }}>{item.label}</strong>: {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Card 3: Prime Strike Windows */}
              <div className="schedule-card prime">
                <div className="schedule-card-title" style={{ color: '#10b981' }}>
                  <span>🎯</span>
                  <span>PRIME MOMENTUM STRIKE ZONES</span>
                </div>
                <div className="schedule-card-body">
                  <ul className="schedule-bullet-list">
                    {(selectedAsset === 'XAU' ? XAU_RULES : YEAR_RULES[selectedScheduleYear])?.primeHours.map((item, i) => (
                      <li key={i}>
                        <strong style={{ color: item.color }}>{item.label}</strong>: {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* MODE 1: Interactive 7x24 Heatmap Matrix */}
            {scheduleGraphicMode === 'matrix' && (
              <div className="heatmap-container">
                <div className="heatmap-header">
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff', marginBottom: '4px' }}>
                      7×24 EMPIRICAL MARKET HEATMAP MATRIX ({selectedScheduleYear.toUpperCase()})
                    </h3>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Click any cell to inspect institutional win rate, profit factor, and trade frequency.
                    </span>
                  </div>
                  <div className="heatmap-controls">
                    <button
                      type="button"
                      className={`heatmap-ctrl-btn ${scheduleMetric === 'chop' ? 'active' : ''}`}
                      onClick={() => setScheduleMetric('chop')}
                    >
                      Chop Probability %
                    </button>
                    <button
                      type="button"
                      className={`heatmap-ctrl-btn ${scheduleMetric === 'exp' ? 'active' : ''}`}
                      onClick={() => setScheduleMetric('exp')}
                    >
                      Strategy Expectancy (R)
                    </button>
                    <button
                      type="button"
                      className={`heatmap-ctrl-btn ${scheduleMetric === 'momo' ? 'active' : ''}`}
                      onClick={() => setScheduleMetric('momo')}
                    >
                      Momentum Expansion %
                    </button>
                    <button
                      type="button"
                      className={`heatmap-ctrl-btn ${scheduleMetric === 'pf' ? 'active' : ''}`}
                      onClick={() => setScheduleMetric('pf')}
                    >
                      Profit Factor
                    </button>
                  </div>
                </div>

                {/* Heatmap Grid */}
                <div className="heatmap-grid">
                  <div></div>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="heatmap-col-header">
                      {h}h
                    </div>
                  ))}

                  {DAYS_OF_WEEK.map((dowName, dowIdx) => (
                    <div key={dowIdx} style={{ display: 'contents' }}>
                      <div className="heatmap-label">{dowName.slice(0, 3)}</div>
                      {Array.from({ length: 24 }).map((_, h) => {
                        const cell = istSchedule?.cell_matrix.find(c => c.dow_ist === dowIdx && c.hour_ist === h);
                        let bg = '#1e293b';
                        let color = '#94a3b8';
                        let label = '—';

                        if (cell) {
                          if (scheduleMetric === 'chop') {
                            const v = cell.chop_pct;
                            label = `${Math.round(v)}%`;
                            if (v >= 45) { bg = 'rgba(239, 68, 68, 0.85)'; color = '#fff'; }
                            else if (v >= 35) { bg = 'rgba(245, 158, 11, 0.75)'; color = '#fff'; }
                            else { bg = 'rgba(16, 185, 129, 0.65)'; color = '#fff'; }
                          } else if (scheduleMetric === 'exp') {
                            const v = cell.exp_r;
                            label = cell.trades > 0 ? `${v >= 0 ? '+' : ''}${v}R` : '—';
                            if (v >= 0.25) { bg = 'rgba(16, 185, 129, 0.9)'; color = '#fff'; }
                            else if (v > 0) { bg = 'rgba(16, 185, 129, 0.45)'; color = '#fff'; }
                            else if (v < -0.1) { bg = 'rgba(239, 68, 68, 0.85)'; color = '#fff'; }
                            else { bg = 'rgba(239, 68, 68, 0.4)'; color = '#fff'; }
                          } else if (scheduleMetric === 'momo') {
                            const v = cell.momo_pct;
                            label = `${Math.round(v)}%`;
                            if (v >= 30) { bg = 'rgba(16, 185, 129, 0.85)'; color = '#fff'; }
                            else if (v >= 20) { bg = 'rgba(56, 189, 248, 0.6)'; color = '#fff'; }
                            else { bg = 'rgba(100, 116, 139, 0.4)'; color = '#94a3b8'; }
                          } else if (scheduleMetric === 'pf') {
                            const v = cell.pf;
                            label = cell.trades > 0 ? `${v.toFixed(1)}` : '—';
                            if (v >= 1.5) { bg = 'rgba(16, 185, 129, 0.85)'; color = '#fff'; }
                            else if (v >= 1.1) { bg = 'rgba(16, 185, 129, 0.4)'; color = '#fff'; }
                            else if (v > 0) { bg = 'rgba(239, 68, 68, 0.75)'; color = '#fff'; }
                            else { bg = '#1e293b'; color = '#64748b'; }
                          }
                        }

                        return (
                          <div
                            key={h}
                            className="heatmap-cell"
                            style={{ background: bg, color }}
                            onClick={() => cell && setSelectedCell(cell)}
                            title={cell ? `${dowName} ${cell.hour_label}: Chop ${cell.chop_pct}%, Exp ${cell.exp_r}R, PF ${cell.pf} (${cell.trades} trades)` : ''}
                          >
                            {label}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Selected Cell Inspector */}
                {selectedCell && (
                  <div style={{ marginTop: '16px', background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8' }}>
                        📍 {selectedCell.dow_name} {selectedCell.hour_label}
                      </span>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Chop Probability: <strong style={{ color: selectedCell.chop_pct > 40 ? '#ef4444' : '#10b981' }}>{selectedCell.chop_pct}%</strong> · 
                        Momentum Expansion: <strong style={{ color: '#10b981' }}>{selectedCell.momo_pct}%</strong> · 
                        Avg 5M Range: <strong>{selectedCell.avg_range_bp} bps</strong>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Radar Trap Trades: {selectedCell.trades}</div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: selectedCell.exp_r > 0 ? '#10b981' : '#ef4444' }}>
                          Win Rate: {selectedCell.win_rate}% · PF: {selectedCell.pf} · Exp: {selectedCell.exp_r > 0 ? '+' : ''}{selectedCell.exp_r}R
                        </div>
                      </div>
                      <button
                        type="button"
                        style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                        onClick={() => setSelectedCell(null)}
                      >
                        ✕ Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MODE 2: Empirical Heatmap Visual Graphic */}
            {scheduleGraphicMode === 'heatmap_img' && (
              <div className="proof-chart-panel" style={{ marginBottom: '24px' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>
                    {selectedAsset === 'XAU' ? 'GOLD (XAU/USD) 7×24 CHOP & MOMENTUM REGIME HEATMAP' : `EMPIRICAL REGIME HEATMAP VISUAL (${selectedScheduleYear.toUpperCase()})`}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Visualizing 7×24 Chop Density &amp; Momentum Excursions
                  </span>
                </div>
                <div style={{ padding: '16px', textAlign: 'center', background: '#090d14' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedAsset === 'XAU' ? '/xau_ist_regime_heatmap.png' : (selectedScheduleYear === 'all' ? '/ist_regime_heatmap.png' : `/ist_regime_heatmap_${selectedScheduleYear}.png`)}
                    alt="IST Regime Heatmap"
                    style={{ maxWidth: '100%', maxHeight: '600px', borderRadius: '6px', border: '1px solid var(--border)' }}
                  />
                </div>
              </div>
            )}

            {/* MODE 3: Cross-Year Comparison Chart / Expectancy Heatmap */}
            {scheduleGraphicMode === 'comparison_img' && (
              <div className="proof-chart-panel" style={{ marginBottom: '24px' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>
                    {selectedAsset === 'XAU' ? 'GOLD (XAU/USD) 7×24 STRATEGY EXPECTANCY HEATMAP' : '3-YEAR CROSS-TEMPORAL COMPARISON (2024 vs 2025 vs 2026)'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {selectedAsset === 'XAU' ? 'Radar Trap 2.0 Expectancy (R) across 168 cells' : 'Day-of-Week & Hourly Expectancy Trajectory Across Market Regimes'}
                  </span>
                </div>
                <div style={{ padding: '16px', textAlign: 'center', background: '#090d14' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedAsset === 'XAU' ? '/xau_ist_strategy_expectancy_heatmap.png' : '/ist_yearly_comparison.png'}
                    alt="Comparison Chart"
                    style={{ maxWidth: '100%', maxHeight: '600px', borderRadius: '6px', border: '1px solid var(--border)' }}
                  />
                </div>
              </div>
            )}

            {/* Day-of-Week Audit Table */}
            <h3 style={{ fontSize: '14px', color: '#38bdf8', marginBottom: '8px', fontWeight: 600 }}>
              Day-of-the-Week Statistical Ranking ({selectedAsset === 'XAU' ? 'Gold 3-Year Sample: 615 Trades' : (selectedScheduleYear === 'all' ? '3-Year Aggregate Sample: 996 Trades' : `Year ${selectedScheduleYear}: ${istSchedule?.dow_summary.reduce((a, b) => a + b.trades, 0)} Trades`)})
            </h3>
            <table className="clean-table" style={{ marginBottom: '24px' }}>
              <thead>
                <tr>
                  <th>DAY OF THE WEEK</th>
                  <th className="text-right">TRADES</th>
                  <th className="text-right">WIN RATE</th>
                  <th className="text-right">PROFIT FACTOR</th>
                  <th className="text-right">EXPECTANCY</th>
                  <th className="text-right">NET RETURN</th>
                  {istSchedule?.dow_summary[0]?.chop_pct !== undefined && (
                    <>
                      <th className="text-right">CHOP %</th>
                      <th className="text-right">MOMO %</th>
                    </>
                  )}
                  <th>STATISTICAL ACTION</th>
                </tr>
              </thead>
              <tbody>
                {istSchedule?.dow_summary.map(d => {
                  const isBest = selectedAsset === 'XAU' ? d.dow_ist === 3 : d.dow_ist === 2; // Thursday for Gold, Wednesday for BTC
                  const isWorst = selectedAsset === 'XAU' ? d.dow_ist === 0 : (selectedScheduleYear === '2026' ? d.dow_ist === 3 : d.dow_ist === 0);
                  return (
                    <tr key={d.dow_ist} style={{ background: isBest ? 'rgba(16, 185, 129, 0.08)' : isWorst ? 'rgba(239, 68, 68, 0.08)' : undefined }}>
                      <td>
                        <strong>{d.dow_name}</strong> {isBest ? '🏆 (Champion)' : isWorst ? '⛔ (Worst Day)' : ''}
                      </td>
                      <td className="text-right">{d.trades}</td>
                      <td className="text-right" style={{ color: d.win_rate >= 45 ? '#10b981' : d.win_rate < 37 ? '#ef4444' : undefined }}>{d.win_rate}%</td>
                      <td className="text-right" style={{ color: d.pf >= 1.25 ? '#10b981' : d.pf < 1.0 ? '#ef4444' : undefined, fontWeight: 600 }}>{d.pf}</td>
                      <td className="text-right" style={{ color: d.exp_r > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>{d.exp_r > 0 ? '+' : ''}{d.exp_r} R</td>
                      <td className="text-right" style={{ color: d.total_return > 0 ? '#10b981' : '#ef4444' }}>{d.total_return > 0 ? '+' : ''}{d.total_return}%</td>
                      {d.chop_pct !== undefined && (
                        <>
                          <td className="text-right" style={{ color: d.chop_pct > 35 ? '#ef4444' : '#94a3b8' }}>{d.chop_pct}%</td>
                          <td className="text-right" style={{ color: (d.momo_pct ?? 0) >= 15 ? '#10b981' : '#94a3b8' }}>{d.momo_pct}%</td>
                        </>
                      )}
                      <td>
                        {isWorst ? (
                          <span style={{ color: '#ef4444', fontWeight: 600 }}>🔴 AVOID TRADING (Chop Whipsaws)</span>
                        ) : isBest ? (
                          <span style={{ color: '#10b981', fontWeight: 600 }}>🟢 PRIME TRADING DAY (Peak Conviction)</span>
                        ) : d.pf >= 1.15 ? (
                          <span style={{ color: '#38bdf8' }}>🟡 Tradeable during Strike Windows</span>
                        ) : (
                          <span style={{ color: '#f59e0b' }}>🟡 Selective Only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Toggleable Full 24-Hour Cycle Table */}
            <div style={{ marginBottom: '24px' }}>
              <button
                type="button"
                className="view-tab"
                onClick={() => setShowFullHourlyTable(!showFullHourlyTable)}
                style={{ padding: '8px 16px', fontSize: '12px', background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
              >
                {showFullHourlyTable ? '▲ Hide Full 24-Hour IST Hourly Breakdown' : '▼ Show Full 24-Hour IST Hourly Breakdown Table'}
              </button>

              {showFullHourlyTable && (
                <div style={{ marginTop: '16px' }}>
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>HOURLY WINDOW (IST)</th>
                        <th className="text-right">TRADES</th>
                        <th className="text-right">WIN RATE</th>
                        <th className="text-right">PROFIT FACTOR</th>
                        <th className="text-right">EXPECTANCY</th>
                        {istSchedule?.hourly_summary[0]?.chop_pct !== undefined && (
                          <>
                            <th className="text-right">CHOP %</th>
                            <th className="text-right">MOMO %</th>
                            <th className="text-right">AVG RANGE</th>
                          </>
                        )}
                        <th>REGIME DIRECTIVE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {istSchedule?.hourly_summary.map(h => {
                        const isRed = h.exp_r < -0.15 || h.win_rate < 30;
                        const isGreen = h.exp_r > 0.3 || (h.trades >= 5 && h.pf >= 1.5);
                        return (
                          <tr key={h.hour_ist} style={{ background: isGreen ? 'rgba(16, 185, 129, 0.06)' : isRed ? 'rgba(239, 68, 68, 0.06)' : undefined }}>
                            <td><strong>{h.hour_label}</strong></td>
                            <td className="text-right">{h.trades}</td>
                            <td className="text-right" style={{ color: h.win_rate >= 50 ? '#10b981' : h.win_rate < 35 ? '#ef4444' : undefined }}>{h.win_rate}%</td>
                            <td className="text-right" style={{ color: h.pf >= 1.5 ? '#10b981' : h.pf < 1.0 ? '#ef4444' : undefined, fontWeight: 600 }}>{h.pf}</td>
                            <td className="text-right" style={{ color: h.exp_r > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>{h.exp_r > 0 ? '+' : ''}{h.exp_r} R</td>
                            {h.chop_pct !== undefined && (
                              <>
                                <td className="text-right" style={{ color: h.chop_pct > 40 ? '#ef4444' : '#94a3b8' }}>{h.chop_pct}%</td>
                                <td className="text-right" style={{ color: (h.momo_pct ?? 0) >= 15 ? '#10b981' : '#94a3b8' }}>{h.momo_pct}%</td>
                                <td className="text-right">{h.avg_range_bp} bp</td>
                              </>
                            )}
                            <td>
                              {isGreen ? (
                                <span style={{ color: '#10b981', fontWeight: 600 }}>🟢 STRIKE WINDOW</span>
                              ) : isRed ? (
                                <span style={{ color: '#ef4444', fontWeight: 600 }}>🔴 STAND ASIDE (Trap Zone)</span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>🟡 Selective Fades</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}


        {/* Clean Minimal Footer */}
        <footer className="footer-rail">
          <span>{message}</span>
          <span>
            Calibration notice: Weekly rolling baseline dynamically adapts to market regime expansions and contractions over a 7-day window.
          </span>
        </footer>
      </main>
    </div>
  );
}
