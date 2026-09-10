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
  if (value < points[0].x) return 5;
  if (value > points.at(-1)!.x) return 95;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (value === point.x) return point.p;
    if (i && value < point.x) {
      const left = points[i - 1];
      return left.p + ((value - left.x) / (point.x - left.x)) * (point.p - left.p);
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

function labelFor(activity: number, persistence: number, spec: Baseline['regimeSpec']): Condition {
  const highA = activity >= spec.activityHigh, highP = persistence >= spec.persistenceHigh;
  if (highA && highP) return 'TREND';
  if (highA) return 'CHOP';
  if (highP) return 'GRIND';
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
    /* server logging is best-effort */
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

const CONDITION_META: Record<Condition, {
  name: string;
  tag: string;
  stance: string;
  tactics: string;
  code: string;
  color: string;
  bgRgba: string;
}> = {
  TREND: {
    name: 'TRENDING',
    tag: 'ACTIVE MOMENTUM',
    stance: 'Favorable conditions. Both range expansion and directional persistence are elevated above historical baselines.',
    tactics: 'Execute momentum continuation and pullback setups with defined invalidation.',
    code: 'trend',
    color: '#10b981',
    bgRgba: 'rgba(16, 185, 129, 0.12)',
  },
  CHOP: {
    name: 'CHOPPY',
    tag: 'UNFAVORABLE · WHIPSAW',
    stance: 'Elevated range without directional persistence. Rapid bidirectional reversals predominate.',
    tactics: 'Breakout signals have low follow-through probability. Mean-reversion or cash stance advised.',
    code: 'chop',
    color: '#f59e0b',
    bgRgba: 'rgba(245, 158, 11, 0.10)',
  },
  GRIND: {
    name: 'SLOW DRIFT',
    tag: 'SUBDUED DIRECTION',
    stance: 'Directional persistence present, but range expansion is below baseline norms.',
    tactics: 'Low-velocity drift. Reduce target expectations and avoid chasing extended moves.',
    code: 'grind',
    color: '#38bdf8',
    bgRgba: 'rgba(56, 189, 248, 0.08)',
  },
  DEAD: {
    name: 'DEAD / FLAT',
    tag: 'ZERO EDGE · DORMANT',
    stance: 'Both range and persistence sit in the lower historical distribution. Expected value is negative after fees.',
    tactics: 'Do not initiate discretionary momentum positions. Wait for volatility expansion.',
    code: 'dead',
    color: '#9ca3af',
    bgRgba: 'rgba(156, 163, 175, 0.07)',
  },
};

export default function Home() {
  const [baseline, setBaseline] = useState<Baseline>(empty);
  const [candles, setCandles] = useState<Record<Interval, Candle[]>>({ '5m': [], '15m': [], '1h': [] });
  const [status, setStatus] = useState<'loading' | 'live' | 'stale' | 'error'>('loading');
  const [message, setMessage] = useState('Initializing research baseline and closed history...');
  const [chartRange, setChartRange] = useState<'24h' | '48h'>('24h');
  const [filterMode, setFilterMode] = useState<'all' | 'dead' | 'trend'>('all');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const lastMessage = useRef(0);
  const lastLogged = useRef(0);

  useEffect(() => {
    fetch('/baseline.json')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setBaseline)
      .catch(() => setMessage('Baseline JSON artifact missing. Run data pipeline before deploying.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(intervals.map(async interval => {
      const limit = interval === '5m' ? 600 : 120;
      const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
      if (!response.ok) throw new Error(`History request failed for ${interval}`);
      const now = Date.now();
      const rows = await response.json();
      const closed = rows
        .filter((row: number[]) => Number(row[6]) <= now)
        .map((row: number[]) => ({
          t: +row[0], o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5],
          q: +row[7], n: +row[8], x: true,
        }));
      if (!cancelled) {
        setCandles(previous => ({ ...previous, [interval]: closed }));
      }
    })).then(() => {
      if (!cancelled) setMessage('Closed historical candles loaded. Streaming Binance WebSocket updates.');
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
        setMessage('Binance Futures market stream connected. Scoring evaluates strictly on closed bars.');
      };
      socket.onmessage = event => {
        const k = JSON.parse(event.data)?.data?.k;
        if (!k) return;
        lastMessage.current = Date.now();
        if (k.x && intervals.includes(k.i as Interval)) {
          const limit = k.i === '5m' ? 600 : 120;
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
        setMessage('WebSocket stream dropped. Reconnecting...');
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry));
      };
      socket.onerror = () => socket?.close();
    };

    try { connect(); } catch {
      setStatus('error');
      setMessage('Browser WebSocket initialization failed.');
    }

    const watch = setInterval(() => {
      if (lastMessage.current && Date.now() - lastMessage.current > 90_000) {
        setStatus('stale');
        setMessage('No tick received for 90s. Reconnection pending.');
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
      const metrics = spec ? calculate(candles[interval], spec.lookback) : null;
      if (!spec || !metrics || !candles[interval].length) return [interval, null];
      const b = spec.hourBaselines[keyFor(new Date(candles[interval].at(-1)!.t))];
      const activity = percentile(metrics.range, b?.range ?? []);
      const persistence = percentile(metrics.persistence, b?.persistence ?? []);
      return [interval, { ...metrics, activity, persistence, label: labelFor(activity, persistence, baseline.regimeSpec) }];
    })) as Record<Interval, Reading | null>;
  }, [baseline, candles]);

  const primary = readings['5m'];
  const activeCondition: Condition = primary?.label ?? 'DEAD';
  const meta = CONDITION_META[activeCondition];

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
    saveCall(record).catch(() => setMessage('IndexedDB storage unavailable in this browser session.'));
    postToServer(record);
  }, [candles, primary, readings]);

  const historySeries: HistoryPoint[] = useMemo(() => {
    const list = candles['5m'];
    const spec = baseline.timeframes['5m'];
    if (!spec || list.length < 13) return [];

    const points: HistoryPoint[] = [];
    for (let i = 12; i < list.length; i++) {
      const window = list.slice(i - 12, i + 1);
      const bars = window.slice(1);
      const close = window.at(-1)!.c;
      const prior = window[0].c;

      const tr = bars.reduce((sum, bar, idx) => {
        const prev = window[idx].c;
        return sum + Math.max(bar.h - bar.l, Math.abs(bar.h - prev), Math.abs(bar.l - prev));
      }, 0);
      const absMove = bars.reduce((sum, bar, idx) => sum + Math.abs(bar.c - window[idx].c), 0);
      const rangeBp = (tr / Math.max(close, 1)) * 10_000;
      const persistenceVal = absMove ? Math.abs(close - prior) / absMove : 0;

      const key = keyFor(new Date(window.at(-1)!.t));
      const b = spec.hourBaselines[key];
      const activity = percentile(rangeBp, b?.range ?? []);
      const persistence = percentile(persistenceVal, b?.persistence ?? []);
      const label = labelFor(activity, persistence, baseline.regimeSpec);

      const d = new Date(window.at(-1)!.t);
      const istLabel = d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      points.push({
        t: window.at(-1)!.t,
        price: close,
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
    if (!chartPoints.length) return { deadPct: 0, trendPct: 0, chopPct: 0, grindPct: 0, streakText: '—', totalHours: 0 };
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
      streakText: `${CONDITION_META[lastLabel].name} · ${streakStr}`,
      totalHours: Math.round(total * 5 / 60),
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
  const padLeft = 65;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
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

  const confirm15 = ['TREND', 'GRIND'].includes(readings['15m']?.label ?? '');
  const confirm1h = ['TREND', 'GRIND'].includes(readings['1h']?.label ?? '');

  const alignmentStatus = useMemo(() => {
    if (confirm15 && confirm1h) return 'Full Multi-Timeframe Alignment (5m · 15m · 1h)';
    if (confirm15) return 'Partial Alignment (5m + 15m Confirmed; 1h Divergent)';
    return 'Divergent (5m lacks higher timeframe confirmation)';
  }, [confirm15, confirm1h]);

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
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' IST'
    : 'Awaiting sync';

  return (
    <div className="terminal-root">
      {/* Top Telemetry Rail */}
      <header className="telemetry-bar">
        <div className="telemetry-item symbol-item">
          <span className="telemetry-label">ASSET</span>
          <span className="telemetry-value highlight">BTCUSDT.P</span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-label">FEED</span>
          <span className={`status-flag ${status}`}>
            <span className="status-indicator" />
            {status.toUpperCase()}
          </span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-label">SERVER / IST CLOCK</span>
          <span className="telemetry-value font-mono">{istDateStr}</span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-label">BASELINE CALIBRATION</span>
          <span className="telemetry-value font-mono">
            {baseline.dataStart ? `${baseline.dataStart.slice(0, 10)} → ${baseline.dataEnd.slice(0, 10)}` : 'Loading'}
          </span>
        </div>
        <div className="telemetry-actions">
          <button className="text-btn" onClick={() => exportJSON().catch(() => setMessage('Export failed.'))}>JSON</button>
          <span className="sep">/</span>
          <button className="text-btn" onClick={() => exportCSV().catch(() => setMessage('Export failed.'))}>CSV</button>
          <span className="sep">/</span>
          <button className="text-btn" onClick={downloadServerLog}>SERVER LOG</button>
        </div>
      </header>

      {/* Main Structural Frame */}
      <main className="terminal-frame">
        {/* Masthead Header */}
        <div className="masthead">
          <div className="masthead-main">
            <h1 className="masthead-title">Market Condition Engine</h1>
            <p className="masthead-lead">
              Two-axis volatility range and directional persistence filter. Evaluates closed-candle price action against local historical distributions to determine whether current market conditions offer positive statistical expectancy.
            </p>
          </div>
          <div className="masthead-status">
            <div className="primary-state-box" data-state={meta.code}>
              <div className="state-micro-label">PRIMARY STATE (5M)</div>
              <div className="state-display-name">{meta.name}</div>
              <div className="state-tag">{meta.tag}</div>
            </div>
          </div>
        </div>

        {/* Primary Stance & Metrics Ledger */}
        <section className="workbench-grid">
          {/* Left Column: Situational Stance */}
          <div className="panel stance-panel">
            <div className="panel-header">
              <span className="panel-num">01</span>
              <h2 className="panel-title">Situational Assessment</h2>
            </div>
            <p className="stance-statement">{meta.stance}</p>
            <div className="tactical-directive">
              <span className="directive-tag">TACTICAL STANCE</span>
              <p className="directive-body">{meta.tactics}</p>
            </div>

            {/* Timeframe Alignment Matrix */}
            <div className="tf-matrix">
              <div className="tf-matrix-header">
                <span>TIMEFRAME CONFIRMATION MATRIX</span>
                <span className="alignment-flag">{alignmentStatus}</span>
              </div>
              <div className="tf-row">
                <div className="tf-cell">
                  <span className="tf-name">5m Immediate</span>
                  <span className={`tf-state ${primary?.label.toLowerCase() ?? ''}`}>
                    {primary?.label ?? '—'}
                  </span>
                </div>
                <div className="tf-cell">
                  <span className="tf-name">15m Intermediate</span>
                  <span className={`tf-state ${readings['15m']?.label.toLowerCase() ?? ''}`}>
                    {readings['15m']?.label ?? '—'}
                  </span>
                </div>
                <div className="tf-cell">
                  <span className="tf-name">1h Structural</span>
                  <span className={`tf-state ${readings['1h']?.label.toLowerCase() ?? ''}`}>
                    {readings['1h']?.label ?? '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Quantitative Telemetry */}
          <div className="panel telemetry-panel">
            <div className="panel-header">
              <span className="panel-num">02</span>
              <h2 className="panel-title">Axis Readings &amp; Distribution</h2>
            </div>

            <div className="telemetry-rows">
              {/* Volatility Pulse */}
              <div className="numeric-row">
                <div className="numeric-meta">
                  <span className="numeric-label">VOLATILITY RANGE PULSE</span>
                  <span className="numeric-figure">{primary ? `${fmt(primary.activity, 1)}th` : '—'}</span>
                </div>
                <div className="gauge-track">
                  <div className="gauge-fill" style={{ width: `${Math.min(100, primary?.activity ?? 0)}%` }} />
                  <div className="gauge-marker" style={{ left: '55%' }} title="Threshold: 55th" />
                </div>
                <div className="numeric-desc">
                  12-bar true range normalized to basis points vs historical IST hour × weekday distribution. High threshold: ≥55th.
                </div>
              </div>

              {/* Direction Persistence */}
              <div className="numeric-row">
                <div className="numeric-meta">
                  <span className="numeric-label">DIRECTIONAL PERSISTENCE</span>
                  <span className="numeric-figure">{primary ? `${fmt(primary.persistence, 1)}th` : '—'}</span>
                </div>
                <div className="gauge-track">
                  <div className="gauge-fill persistence" style={{ width: `${Math.min(100, primary?.persistence ?? 0)}%` }} />
                  <div className="gauge-marker" style={{ left: '65%' }} title="Threshold: 65th" />
                </div>
                <div className="numeric-desc">
                  Ratio of net close-to-close displacement to total absolute path. High threshold: ≥65th.
                </div>
              </div>

              {/* State Duration & 24h Summary */}
              <div className="breakdown-grid">
                <div className="breakdown-cell">
                  <span className="cell-label">CURRENT DURATION</span>
                  <span className="cell-val">{stats.streakText}</span>
                </div>
                <div className="breakdown-cell">
                  <span className="cell-label">24H DORMANT / DEAD RATIO</span>
                  <span className="cell-val highlight-dead">{stats.deadPct}% of elapsed time</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Historical Price & Condition Ledger Chart */}
        <section className="panel chart-panel">
          <div className="panel-header chart-header-row">
            <div>
              <span className="panel-num">03</span>
              <h2 className="panel-title">Historical Condition Timeline (BTCUSDT)</h2>
            </div>
            <div className="chart-actions">
              <div className="segmented-control">
                <button
                  className={`segment-btn ${chartRange === '24h' ? 'active' : ''}`}
                  onClick={() => setChartRange('24h')}
                >
                  24H
                </button>
                <button
                  className={`segment-btn ${chartRange === '48h' ? 'active' : ''}`}
                  onClick={() => setChartRange('48h')}
                >
                  48H
                </button>
              </div>
              <div className="segmented-control">
                <button
                  className={`segment-btn ${filterMode === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterMode('all')}
                >
                  ALL
                </button>
                <button
                  className={`segment-btn ${filterMode === 'dead' ? 'active' : ''}`}
                  onClick={() => setFilterMode('dead')}
                >
                  DEAD ONLY
                </button>
                <button
                  className={`segment-btn ${filterMode === 'trend' ? 'active' : ''}`}
                  onClick={() => setFilterMode('trend')}
                >
                  TREND ONLY
                </button>
              </div>
            </div>
          </div>

          {/* Hover Telemetry HUD Bar */}
          <div className="chart-hud-bar">
            <div className="hud-metric">
              <span className="hud-lbl">CANDLE TIME (IST)</span>
              <span className="hud-val">{activeHover?.istLabel ?? '—'}</span>
            </div>
            <div className="hud-metric">
              <span className="hud-lbl">CLOSE PRICE</span>
              <span className="hud-val price">{activeHover ? fmtUsd(activeHover.price) : '—'}</span>
            </div>
            <div className="hud-metric">
              <span className="hud-lbl">CLASSIFICATION</span>
              <span className={`hud-val condition ${activeHover?.label.toLowerCase() ?? ''}`}>
                {activeHover ? CONDITION_META[activeHover.label].name : '—'}
              </span>
            </div>
            <div className="hud-metric">
              <span className="hud-lbl">VOLATILITY RANGE</span>
              <span className="hud-val">{activeHover ? `${fmt(activeHover.activity, 1)}%` : '—'}</span>
            </div>
            <div className="hud-metric">
              <span className="hud-lbl">PERSISTENCE</span>
              <span className="hud-val">{activeHover ? `${fmt(activeHover.persistence, 1)}%` : '—'}</span>
            </div>
            <div className="hud-metric right-aligned">
              <span className="hud-lbl">TOTAL ACCUMULATION</span>
              <span className="hud-val muted-val">
                {stats.deadPct}% Dead · {stats.trendPct}% Trend · {stats.chopPct}% Chop · {stats.grindPct}% Drift
              </span>
            </div>
          </div>

          {/* SVG Canvas */}
          <div className="chart-stage">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="chart-canvas"
              onMouseMove={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = ((e.clientX - rect.left) / rect.width) * svgWidth;
                const idx = Math.round(((relX - padLeft) / plotW) * (chartPoints.length - 1));
                if (idx >= 0 && idx < chartPoints.length) setHoverIndex(idx);
              }}
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Background Condition Spans */}
              {conditionBands.map((band, i) => {
                const xStart = padLeft + (band.start / Math.max(1, chartPoints.length - 1)) * plotW;
                const xEnd = padLeft + (band.end / Math.max(1, chartPoints.length - 1)) * plotW;
                const bandWidth = Math.max(1.5, xEnd - xStart);
                const conf = CONDITION_META[band.label];

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
                      fill={conf.bgRgba}
                    />
                    {bandWidth > 55 && (
                      <text
                        x={xStart + 6}
                        y={padTop + 14}
                        fill={conf.color}
                        fontSize="9"
                        fontFamily="JetBrains Mono, monospace"
                        opacity="0.85"
                        letterSpacing="0.06em"
                      >
                        {conf.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Grid Lines & Price Labels */}
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
                      stroke="#1a1e26"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3.5}
                      fill="#6b7280"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="end"
                    >
                      {fmtUsd(price)}
                    </text>
                  </g>
                );
              })}

              {/* Solid High-Contrast Price Line */}
              {pricePath && (
                <path
                  d={pricePath}
                  fill="none"
                  stroke="#f3f4f6"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              )}

              {/* Interactive Crosshair */}
              {hoverIndex !== null && (
                <g>
                  <line
                    x1={activeHoverX}
                    y1={padTop}
                    x2={activeHoverX}
                    y2={padTop + plotH}
                    stroke="#9ca3af"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <circle
                    cx={activeHoverX}
                    cy={activeHoverY}
                    r="4"
                    fill="#f3f4f6"
                    stroke="#0b0c0e"
                    strokeWidth="1.5"
                  />
                </g>
              )}

              {/* Bottom State Ribbon Bar */}
              {chartPoints.map((p, idx) => {
                const x = padLeft + (idx / Math.max(1, chartPoints.length - 1)) * plotW;
                const barWidth = Math.max(1.5, plotW / chartPoints.length);
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={padTop + plotH + 8}
                    width={barWidth}
                    height="6"
                    fill={CONDITION_META[p.label].color}
                  />
                );
              })}

              <text
                x={padLeft - 8}
                y={padTop + plotH + 14}
                fill="#4b5563"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
                textAnchor="end"
              >
                TAPE
              </text>
            </svg>
          </div>
        </section>

        {/* Structural Matrix & Performance Ledgers */}
        <section className="workbench-grid">
          {/* Classification Matrix Reference Table */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-num">04</span>
              <h2 className="panel-title">Condition Classification Reference</h2>
            </div>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>REGIME</th>
                  <th>VOLATILITY (RANGE)</th>
                  <th>PERSISTENCE (DIRECTION)</th>
                  <th>TRADE STANCE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-bold status-cell-trend">TRENDING</td>
                  <td>High (≥ 55th)</td>
                  <td>High (≥ 65th)</td>
                  <td>Momentum execution (pullback &amp; continuation)</td>
                </tr>
                <tr>
                  <td className="font-bold status-cell-chop">CHOPPY</td>
                  <td>High (≥ 55th)</td>
                  <td>Low (&lt; 65th)</td>
                  <td>Stand aside (breakout failure risk)</td>
                </tr>
                <tr>
                  <td className="font-bold status-cell-grind">SLOW DRIFT</td>
                  <td>Low (&lt; 55th)</td>
                  <td>High (≥ 65th)</td>
                  <td>Selective (subdued target expectancy)</td>
                </tr>
                <tr>
                  <td className="font-bold status-cell-dead">DEAD / FLAT</td>
                  <td>Low (&lt; 55th)</td>
                  <td>Low (&lt; 65th)</td>
                  <td>Capital preservation (negative EV after fees)</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Intraday Sessions Ledger */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-num">05</span>
              <h2 className="panel-title">Intraday Session Expectancy (15m OOS)</h2>
            </div>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>SESSION</th>
                  <th className="num">N</th>
                  <th className="num">MEDIAN R</th>
                  <th className="num">2R TARGET HIT</th>
                </tr>
              </thead>
              <tbody>
                {baseline.sessions.slice(0, 5).map(x => (
                  <tr key={x.name}>
                    <td>
                      {x.name}
                      {x.samples < 15 && <span className="footnote-flag"> *</span>}
                    </td>
                    <td className="num">{x.samples}</td>
                    <td className={`num ${x.medianOutcomeR >= 0 ? 'cell-pos' : 'cell-neg'}`}>
                      {x.medianOutcomeR >= 0 ? `+${x.medianOutcomeR.toFixed(2)}R` : `${x.medianOutcomeR.toFixed(2)}R`}
                    </td>
                    <td className="num">{(x.hit2R * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="panel-footnote">
              * Note: Sample size per session bucket is modest (n &lt; 15). Individual session rankings exhibit variance and should not be used as standalone rules.
            </div>
          </div>
        </section>

        {/* Global Footer & Calibration Notice */}
        <footer className="terminal-footer">
          <div className="footer-status-text">
            <span>{message}</span>
          </div>
          <div className="footer-note">
            Calibration notice: Baselines fitted on historical window ({baseline.dataStart?.slice(0, 10)} → {baseline.dataEnd?.slice(0, 10)}). During quieter periods, TREND frequency naturally decreases as the engine measures market activity relative to historical norms.
          </div>
        </footer>
      </main>
    </div>
  );
}
