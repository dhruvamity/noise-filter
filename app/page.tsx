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

export default function Home() {
  const [baseline, setBaseline] = useState<Baseline>(empty);
  const [candles, setCandles] = useState<Record<Interval, Candle[]>>({ '5m': [], '15m': [], '1h': [] });
  const [status, setStatus] = useState<'loading' | 'live' | 'stale' | 'error'>('loading');
  const [message, setMessage] = useState('Loading research baseline and candle history...');
  const [chartRange, setChartRange] = useState<'24h' | '48h'>('24h');
  const [filterMode, setFilterMode] = useState<'all' | 'dead' | 'trend'>('all');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const lastMessage = useRef(0);
  const lastLogged = useRef(0);

  useEffect(() => {
    fetch('/baseline.json')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setBaseline)
      .catch(() => setMessage('Baseline artifact missing. Run data pipeline before deploying.'));
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
      if (!cancelled) setMessage('Closed historical candles loaded. Streaming live Binance ticks.');
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
  const info = CONDITION_INFO[activeCondition];

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
          <span className="ticker">BTCUSDT</span>
          <span className={`badge-feed ${status}`}>
            <span className="feed-dot" />
            {status.toUpperCase()}
          </span>
          <span className="timestamp">{istDateStr}</span>
        </div>
        <div className="rail-right">
          <span className="cal-label">
            Baseline: {baseline.dataStart ? `${baseline.dataStart.slice(0, 10)} → ${baseline.dataEnd.slice(0, 10)}` : 'Loading'}
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
        {/* Core Decision Header */}
        <section className="decision-banner" data-condition={info.code}>
          <div className="decision-main">
            <div className="decision-kicker">
              MARKET STATE
              <Tooltip text="Evaluates 5-minute volatility and directional persistence against local hour & weekday historical norms." />
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
              <Tooltip text="Current 60-minute price range compared to historical norms for this exact IST hour & weekday. ≥55% indicates active range expansion." />
            </div>
            <div className="metric-value-row">
              <span className="metric-large">{primary ? `${fmt(primary.activity)}%` : '—'}</span>
              <span className="metric-sublabel">
                {(primary?.activity ?? 0) >= 55 ? 'Active Range' : 'Depressed Range'}
              </span>
            </div>
            <div className="metric-gauge">
              <div className="metric-gauge-fill" style={{ width: `${Math.min(100, primary?.activity ?? 0)}%` }} />
              <div className="metric-gauge-cutoff" style={{ left: '55%' }} title="High threshold: 55%" />
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-title">
              DIRECTION STRENGTH
              <Tooltip text="Measures directional efficiency: net price move divided by total absolute move over 12 bars. ≥65% indicates strong directional trend without churning." />
            </div>
            <div className="metric-value-row">
              <span className="metric-large">{primary ? `${fmt(primary.persistence)}%` : '—'}</span>
              <span className="metric-sublabel">
                {(primary?.persistence ?? 0) >= 65 ? 'Clean Direction' : 'Whippy / Mixed'}
              </span>
            </div>
            <div className="metric-gauge">
              <div className="metric-gauge-fill persistence" style={{ width: `${Math.min(100, primary?.persistence ?? 0)}%` }} />
              <div className="metric-gauge-cutoff" style={{ left: '65%' }} title="High threshold: 65%" />
            </div>
          </div>

          <div className="metric-box">
            <div className="metric-title">
              24H DORMANT RATIO
              <Tooltip text="The percentage of the last 24 hours that Bitcoin spent in DEAD (flatline) mode. High numbers show why patience and waiting for momentum is essential." />
            </div>
            <div className="metric-value-row">
              <span className="metric-large">{stats.deadPct}%</span>
              <span className="metric-sublabel">Flatlined Time</span>
            </div>
            <div className="metric-note-line">
              Active Trend: <strong>{stats.trendPct}%</strong> · Choppy: <strong>{stats.chopPct}%</strong>
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
                Shows where Bitcoin was <strong>DEAD (flatline)</strong> versus <strong>TRENDING (momentum)</strong>.
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

        {/* Clean Minimal Footer */}
        <footer className="footer-rail">
          <span>{message}</span>
          <span>
            Calibration notice: Baselines fit on historical data ({baseline.dataStart?.slice(0, 10)} → {baseline.dataEnd?.slice(0, 10)}).
            In calmer markets, TREND will appear less frequently.
          </span>
        </footer>
      </main>
    </div>
  );
}
