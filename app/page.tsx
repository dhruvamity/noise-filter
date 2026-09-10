'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Interval = '5m' | '15m' | '1h';
type Candle = { t:number; o:number; h:number; l:number; c:number; v:number; n:number; q:number; x:boolean };
type Quantiles = { range:number[]; persistence:number[]; samples:number };
type Timeframe = { lookback:number; label:string; hourBaselines:Record<string, Quantiles> };
type StudyRow = { name:string; samples:number; mfeR:number; maeR:number; ratio:number; hit2R:number; medianOutcomeR:number };
type Baseline = {
  generatedAt:string;
  dataStart:string;
  dataEnd:string;
  symbol:string;
  regimeSpec:{activityHigh:number; persistenceHigh:number; labels:Record<string,string>};
  timeframes:Record<Interval,Timeframe>;
  sessions:StudyRow[];
  weekdays:StudyRow[];
};
type ConditionType = 'TREND' | 'CHOP' | 'GRIND' | 'DEAD';
type Reading = { activity:number; persistence:number; label:ConditionType; range:number; change:number };

type HistoryPoint = {
  t: number;
  price: number;
  activity: number;
  persistence: number;
  label: ConditionType;
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
const fmtCurrency = (n: number) => Number.isFinite(n) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';

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

function labelFor(activity: number, persistence: number, spec: Baseline['regimeSpec']): ConditionType {
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

// Plain-English retail configuration for conditions
const RETAIL_CONFIG: Record<ConditionType, {
  name: string;
  badge: string;
  badgeClass: string;
  summary: string;
  actionTitle: string;
  actionDesc: string;
  color: string;
  bgHex: string;
  tip: string;
}> = {
  TREND: {
    name: 'TRENDING',
    badge: '🟢 GREEN LIGHT — HIGH MOMENTUM',
    badgeClass: 'badge-trend',
    summary: 'Clean directional momentum with high volume.',
    actionTitle: 'Scan For Setups (Prime Trading Window)',
    actionDesc: 'Both volatility and direction are high. Clean trend continuations and pullback setups have the highest statistical edge right now.',
    color: '#00e5a3',
    bgHex: 'rgba(0, 229, 163, 0.12)',
    tip: 'Trade with the direction. Keep stop-losses disciplined.',
  },
  CHOP: {
    name: 'CHOPPY',
    badge: '🟡 CAUTION — TRAP ZONE',
    badgeClass: 'badge-chop',
    summary: 'High volatility but zero direction.',
    actionTitle: 'Avoid Breakout Chasing (High Stop-Out Risk)',
    actionDesc: 'Price is violently whipping back and forth without follow-through. Breakouts are prone to immediate fakeouts.',
    color: '#f59e0b',
    bgHex: 'rgba(245, 158, 11, 0.10)',
    tip: 'False breakouts are common. Wait for direction to emerge.',
  },
  GRIND: {
    name: 'SLOW DRIFT',
    badge: '🔵 SELECTIVE — SLOW DRIFT',
    badgeClass: 'badge-grind',
    summary: 'Directional crawl with low volatility/range.',
    actionTitle: 'Take Smaller Targets (Creep Move)',
    actionDesc: 'Direction persists, but range and volume are subdued. Don’t expect explosive runners; take small profit targets.',
    color: '#38bdf8',
    bgHex: 'rgba(56, 189, 248, 0.08)',
    tip: 'Move is slow. Squeeze smaller profit targets.',
  },
  DEAD: {
    name: 'DEAD (SLEEP)',
    badge: '⚪ STAND ASIDE — MARKET IS DEAD',
    badgeClass: 'badge-dead',
    summary: 'Flatlined price action and low volume.',
    actionTitle: 'Sit On Your Hands (Preserve Capital)',
    actionDesc: 'Low volatility, zero momentum. Trading in this zone loses money to exchange fees, spreads, and false hope. Wait for volume to return.',
    color: '#94a3b8',
    bgHex: 'rgba(148, 163, 184, 0.08)',
    tip: 'Zero edge. Sit out and protect your mental and financial capital.',
  },
};

export default function Home() {
  const [baseline, setBaseline] = useState<Baseline>(empty);
  const [candles, setCandles] = useState<Record<Interval, Candle[]>>({ '5m': [], '15m': [], '1h': [] });
  const [status, setStatus] = useState<'loading' | 'live' | 'stale' | 'error'>('loading');
  const [message, setMessage] = useState('Loading research baseline and closed candle history…');
  const [chartRange, setChartRange] = useState<'24h' | '48h'>('24h');
  const [filterMode, setFilterMode] = useState<'all' | 'dead-only' | 'trend-only'>('all');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const lastMessage = useRef(0);
  const lastLogged = useRef(0);

  // Fetch baseline
  useEffect(() => {
    fetch('/baseline.json')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setBaseline)
      .catch(() => setMessage('Baseline JSON is missing — run the research pipeline before deploying.'));
  }, []);

  // Fetch closed history (600 candles for 5m to support full 48h chart)
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
      if (!cancelled) setMessage('Closed historical candles loaded; waiting for live Binance stream.');
    }).catch(() => {
      if (!cancelled) setMessage('Could not seed Binance history. Check network access; no forming candle is used for scoring.');
    });
    return () => { cancelled = true; };
  }, []);

  // WebSocket connection for real-time closed candle updates
  useEffect(() => {
    const streams = intervals.map(x => `btcusdt@kline_${x}`).join('/');
    let socket: WebSocket | undefined, retry = 0, timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      socket = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`);
      socket.onopen = () => {
        retry = 0;
        lastMessage.current = Date.now();
        setStatus('live');
        setMessage('Live Binance Futures stream connected; decisions update on closed candles.');
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
        setMessage('Stream disconnected — reconnecting. Last closed-candle reading is retained.');
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
        setMessage('No Binance message for 90 seconds — waiting for reconnect.');
      }
    }, 15_000);

    return () => {
      clearTimeout(timer);
      clearInterval(watch);
      socket?.close();
    };
  }, []);

  // Compute live readings for 5m, 15m, 1h
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
  const currentCondition: ConditionType = primary?.label ?? 'DEAD';
  const currentRetail = RETAIL_CONFIG[currentCondition];

  // Log closed calls
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
    saveCall(record).catch(() => setMessage('Live analysis works, but IndexedDB logging is unavailable in this browser.'));
    postToServer(record);
  }, [candles, primary, readings]);

  // Compute full historical 5m series for chart
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

      const istDate = new Date(window.at(-1)!.t);
      const istLabel = istDate.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
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

  // Slice historical points according to 24h (288 bars) or 48h (576 bars)
  const chartPoints = useMemo(() => {
    const count = chartRange === '24h' ? 288 : 576;
    return historySeries.slice(-count);
  }, [historySeries, chartRange]);

  // Compute breakdown stats for selected timeframe
  const chartStats = useMemo(() => {
    if (!chartPoints.length) return { deadPct: 0, trendPct: 0, chopPct: 0, grindPct: 0, streakText: '—', totalHours: 0 };
    const total = chartPoints.length;
    let dead = 0, trend = 0, chop = 0, grind = 0;
    chartPoints.forEach(p => {
      if (p.label === 'DEAD') dead++;
      else if (p.label === 'TREND') trend++;
      else if (p.label === 'CHOP') chop++;
      else if (p.label === 'GRIND') grind++;
    });

    // Compute current streak
    const lastLabel = chartPoints.at(-1)!.label;
    let streakCount = 0;
    for (let i = chartPoints.length - 1; i >= 0; i--) {
      if (chartPoints[i].label === lastLabel) streakCount++;
      else break;
    }
    const streakMinutes = streakCount * 5;
    const streakHours = Math.floor(streakMinutes / 60);
    const streakRemMin = streakMinutes % 60;
    const streakStr = streakHours > 0 ? `${streakHours}h ${streakRemMin}m` : `${streakRemMin}m`;

    return {
      deadPct: Math.round((dead / total) * 100),
      trendPct: Math.round((trend / total) * 100),
      chopPct: Math.round((chop / total) * 100),
      grindPct: Math.round((grind / total) * 100),
      streakText: `${RETAIL_CONFIG[lastLabel].name} for last ${streakStr}`,
      totalHours: Math.round(total * 5 / 60),
    };
  }, [chartPoints]);

  // Group contiguous condition spans for chart background shading
  const conditionBands = useMemo(() => {
    if (!chartPoints.length) return [];
    const bands: { start: number; end: number; label: ConditionType }[] = [];
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

  // SVG Chart Dimensions & Scales
  const svgWidth = 940;
  const svgHeight = 280;
  const padLeft = 68;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const { minPrice, maxPrice, pricePath, areaPath } = useMemo(() => {
    if (!chartPoints.length) return { minPrice: 0, maxPrice: 0, pricePath: '', areaPath: '' };
    const prices = chartPoints.map(p => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const spread = max - min || 1;
    const pMin = min - spread * 0.04;
    const pMax = max + spread * 0.04;

    const getX = (idx: number) => padLeft + (idx / Math.max(1, chartPoints.length - 1)) * plotW;
    const getY = (price: number) => padTop + plotH - ((price - pMin) / (pMax - pMin)) * plotH;

    const points = chartPoints.map((p, idx) => `${getX(idx).toFixed(1)},${getY(p.price).toFixed(1)}`);
    const pathD = 'M ' + points.join(' L ');
    const areaD = `${pathD} L ${getX(chartPoints.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L ${getX(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

    return { minPrice: pMin, maxPrice: pMax, pricePath: pathD, areaPath: areaD };
  }, [chartPoints, plotW, plotH, padLeft, padTop]);

  // Multi-timeframe confirmation checks
  const confirm15 = ['TREND', 'GRIND'].includes(readings['15m']?.label ?? '');
  const confirm1h = ['TREND', 'GRIND'].includes(readings['1h']?.label ?? '');

  const multiTimeframeAdvice = useMemo(() => {
    if (currentCondition === 'TREND') {
      if (confirm15 && confirm1h) return 'Triple Alignment: 5m, 15m, and 1h all show active momentum. Prime high-probability trading window.';
      if (confirm15) return 'Short-term momentum is active (5m + 15m). Wait for 1h confirmation before sizing up aggressively.';
      return 'Short-term 5m move lacks 15m support. Prone to quick exhaustion; proceed cautiously.';
    }
    if (currentCondition === 'CHOP') return 'Price is whipsawing back and forth. Breakouts are traps; avoid trend-following entries.';
    if (currentCondition === 'GRIND') return 'Slow directional crawl on low volume. Expect small, slow moves; tighten profit targets.';
    return 'Market has flatlined with no volume or direction. Protect your capital — sit on your hands and wait.';
  }, [currentCondition, confirm15, confirm1h]);

  const statusText = status === 'live' ? 'LIVE FEED' : status === 'stale' ? 'STALE' : 'OFFLINE';
  const when = primary ? new Date(candles['5m'].at(-1)!.t).toLocaleString('en-IN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata', hour12: true,
  }) : 'waiting for closed history';

  // Hover point selection
  const activeHover = hoverIndex !== null && chartPoints[hoverIndex] ? chartPoints[hoverIndex] : (chartPoints.at(-1) ?? null);
  const activeHoverIdx = hoverIndex !== null ? hoverIndex : (chartPoints.length - 1);
  const activeHoverX = chartPoints.length > 1 ? padLeft + (activeHoverIdx / (chartPoints.length - 1)) * plotW : padLeft;
  const activeHoverY = activeHover && maxPrice > minPrice ? padTop + plotH - ((activeHover.price - minPrice) / (maxPrice - minPrice)) * plotH : padTop;

  return (
    <main className="shell">
      {/* Top Header */}
      <header className="topbar">
        <div>
          <div className="eyebrow">BTC / USDT Perpetual · Real-Time Trading Weather</div>
          <h1>Should You Trade Bitcoin Right Now?</h1>
          <p className="sub">
            A research-backed market filter that tells retail traders whether market conditions are clean, choppy, or dead.
            It describes current trading conditions — it does not predict future prices.
          </p>
        </div>
        <div className="topbar-right">
          <div className="live-pill">
            <span className={`dot ${status !== 'live' ? 'off' : ''}`} />
            {statusText}
          </div>
        </div>
      </header>

      {/* Hero Decision Section */}
      <section className="hero">
        <div className="card regime-card">
          <div className="kicker">Current Market Weather · IST</div>
          <div className={`status-badge ${currentRetail.badgeClass}`}>
            {currentRetail.badge}
          </div>

          <div className="verdict-title">{currentRetail.actionTitle}</div>
          <p className="verdict-desc">{currentRetail.actionDesc}</p>

          <div className="multi-tf-box">
            <div className="multi-tf-head">Multi-Timeframe Alignment Check:</div>
            <div className="multi-tf-row">
              <span className="tf-tag">
                5m Immediate: <strong>{primary?.label ?? '—'}</strong>
              </span>
              <span className="tf-tag">
                15m Trend: <strong className={readings['15m']?.label.toLowerCase()}>{readings['15m']?.label ?? '—'}</strong>
              </span>
              <span className="tf-tag">
                1h Macro: <strong className={readings['1h']?.label.toLowerCase()}>{readings['1h']?.label ?? '—'}</strong>
              </span>
            </div>
            <div className="multi-tf-summary">{multiTimeframeAdvice}</div>
          </div>

          <div className="stamp">{when} IST · Based on closed 5m candle</div>
        </div>

        {/* 4 Pulse Cards */}
        <div className="metrics">
          <div className="card metric">
            <div className="metric-label">Volatility Pulse</div>
            <div className="metric-value">{primary ? `${fmt(primary.activity)}th %` : '—'}</div>
            <div className="metric-bar-track">
              <div className="metric-bar-fill" style={{ width: `${Math.min(100, primary?.activity ?? 0)}%` }} />
            </div>
            <div className="metric-note">
              {(primary?.activity ?? 0) >= 55 ? '🔥 Above average volatility for this hour' : '💤 Below average range for this hour'}
            </div>
          </div>

          <div className="card metric">
            <div className="metric-label">Direction Strength</div>
            <div className="metric-value">{primary ? `${fmt(primary.persistence)}th %` : '—'}</div>
            <div className="metric-bar-track">
              <div className="metric-bar-fill persistence-fill" style={{ width: `${Math.min(100, primary?.persistence ?? 0)}%` }} />
            </div>
            <div className="metric-note">
              {(primary?.persistence ?? 0) >= 65 ? '🎯 Price moving in one clean direction' : '🔀 Price churning back and forth'}
            </div>
          </div>

          <div className="card metric">
            <div className="metric-label">Last 24 Hours Dead Ratio</div>
            <div className="metric-value highlight-dead">{chartStats.deadPct}%</div>
            <div className="metric-note">
              Market was asleep for <strong>{Math.round((chartStats.deadPct / 100) * 24)} hours</strong> today.
            </div>
          </div>

          <div className="card metric">
            <div className="metric-label">Current State Streak</div>
            <div className="metric-value streak-value">{chartStats.streakText.split('for last')[1] ?? '—'}</div>
            <div className="metric-note">
              Current condition: <strong style={{ color: currentRetail.color }}>{currentRetail.name}</strong>
            </div>
          </div>
        </div>
      </section>

      {/* 24-48hr Historical Line Chart */}
      <section className="card chart-section">
        <div className="chart-header">
          <div>
            <h2 className="section-title">Historic Condition Chart (Dead vs Active Zones)</h2>
            <div className="section-note">
              Visualizes the exact moments Bitcoin went DEAD (sleep mode) versus when it showed clean MOMENTUM.
            </div>
          </div>
          <div className="chart-controls">
            <div className="toggle-group">
              <button
                className={`toggle-btn ${chartRange === '24h' ? 'active' : ''}`}
                onClick={() => setChartRange('24h')}
              >
                Last 24 Hours
              </button>
              <button
                className={`toggle-btn ${chartRange === '48h' ? 'active' : ''}`}
                onClick={() => setChartRange('48h')}
              >
                Last 48 Hours
              </button>
            </div>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${filterMode === 'all' ? 'active' : ''}`}
                onClick={() => setFilterMode('all')}
              >
                All Conditions
              </button>
              <button
                className={`toggle-btn ${filterMode === 'dead-only' ? 'active' : ''}`}
                onClick={() => setFilterMode('dead-only')}
              >
                Highlight Dead
              </button>
              <button
                className={`toggle-btn ${filterMode === 'trend-only' ? 'active' : ''}`}
                onClick={() => setFilterMode('trend-only')}
              >
                Highlight Trending
              </button>
            </div>
          </div>
        </div>

        {/* Breakdown Stats Strip */}
        <div className="chart-stats-strip">
          <div className="stat-pill dead-pill">
            <span className="dot-mini dead-dot" /> <strong>{chartStats.deadPct}% Dead</strong> (Flatline / Sleep)
          </div>
          <div className="stat-pill trend-pill">
            <span className="dot-mini trend-dot" /> <strong>{chartStats.trendPct}% Trending</strong> (Momentum)
          </div>
          <div className="stat-pill chop-pill">
            <span className="dot-mini chop-dot" /> <strong>{chartStats.chopPct}% Choppy</strong> (Trap)
          </div>
          <div className="stat-pill grind-pill">
            <span className="dot-mini grind-dot" /> <strong>{chartStats.grindPct}% Slow Drift</strong> (Crawl)
          </div>
          <div className="chart-legend-hint">Hover anywhere on chart to inspect exact candle conditions</div>
        </div>

        {/* Hover Inspector Card */}
        {activeHover && (
          <div className="hover-inspector">
            <div className="hover-item">
              <span className="hover-label">TIME (IST)</span>
              <span className="hover-val">{activeHover.istLabel}</span>
            </div>
            <div className="hover-item">
              <span className="hover-label">BTC PRICE</span>
              <span className="hover-val price-val">{fmtCurrency(activeHover.price)}</span>
            </div>
            <div className="hover-item">
              <span className="hover-label">MARKET STATE</span>
              <span className={`hover-val state-val ${activeHover.label.toLowerCase()}`}>
                {RETAIL_CONFIG[activeHover.label].name}
              </span>
            </div>
            <div className="hover-item">
              <span className="hover-label">VOLATILITY PULSE</span>
              <span className="hover-val">{fmt(activeHover.activity)}th %</span>
            </div>
            <div className="hover-item">
              <span className="hover-label">DIRECTION STRENGTH</span>
              <span className="hover-val">{fmt(activeHover.persistence)}th %</span>
            </div>
            <div className="hover-item note-item">
              <span className="hover-label">TAKEAWAY</span>
              <span className="hover-note">{RETAIL_CONFIG[activeHover.label].tip}</span>
            </div>
          </div>
        )}

        {/* SVG Canvas */}
        <div className="svg-container">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="chart-svg"
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = (e.clientX - rect.left) / rect.width * svgWidth;
              const idx = Math.round(((relX - padLeft) / plotW) * (chartPoints.length - 1));
              if (idx >= 0 && idx < chartPoints.length) setHoverIndex(idx);
            }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#77e5cf" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#77e5cf" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Background Condition Shading Bands */}
            {conditionBands.map((band, i) => {
              const xStart = padLeft + (band.start / Math.max(1, chartPoints.length - 1)) * plotW;
              const xEnd = padLeft + (band.end / Math.max(1, chartPoints.length - 1)) * plotW;
              const bandWidth = Math.max(2, xEnd - xStart);
              const conf = RETAIL_CONFIG[band.label];

              // Filter highlighting logic
              const isDimmed =
                (filterMode === 'dead-only' && band.label !== 'DEAD') ||
                (filterMode === 'trend-only' && band.label !== 'TREND');

              return (
                <g key={i}>
                  <rect
                    x={xStart}
                    y={padTop}
                    width={bandWidth}
                    height={plotH}
                    fill={isDimmed ? 'transparent' : conf.bgHex}
                  />
                  {/* Subtle label if span is wide enough */}
                  {bandWidth > 60 && !isDimmed && (
                    <text
                      x={xStart + 8}
                      y={padTop + 16}
                      fill={conf.color}
                      fontSize="10"
                      fontFamily="DM Mono, monospace"
                      opacity="0.75"
                    >
                      {conf.name}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Horizontal Gridlines & Price Labels */}
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
                    stroke="rgba(255,255,255,0.06)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={padLeft - 10}
                    y={y + 4}
                    fill="var(--muted)"
                    fontSize="11"
                    fontFamily="DM Mono, monospace"
                    textAnchor="end"
                  >
                    {fmtCurrency(price)}
                  </text>
                </g>
              );
            })}

            {/* Area Fill */}
            {areaPath && <path d={areaPath} fill="url(#areaGradient)" />}

            {/* Main Price Line */}
            {pricePath && (
              <path
                d={pricePath}
                fill="none"
                stroke="var(--text)"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
            )}

            {/* Vertical Cursor Crosshair */}
            {hoverIndex !== null && (
              <g>
                <line
                  x1={activeHoverX}
                  y1={padTop}
                  x2={activeHoverX}
                  y2={padTop + plotH}
                  stroke="var(--cyan)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={activeHoverX}
                  cy={activeHoverY}
                  r="5"
                  fill="var(--cyan)"
                  stroke="#080a0f"
                  strokeWidth="2"
                />
              </g>
            )}

            {/* Bottom Timeline Ribbon Tape */}
            {chartPoints.map((p, idx) => {
              const x = padLeft + (idx / Math.max(1, chartPoints.length - 1)) * plotW;
              const barWidth = Math.max(1.8, plotW / chartPoints.length);
              return (
                <rect
                  key={idx}
                  x={x}
                  y={padTop + plotH + 12}
                  width={barWidth}
                  height="8"
                  fill={RETAIL_CONFIG[p.label].color}
                  opacity="0.9"
                />
              );
            })}

            {/* Ribbon Label */}
            <text
              x={padLeft - 10}
              y={padTop + plotH + 20}
              fill="var(--muted)"
              fontSize="10"
              fontFamily="DM Mono, monospace"
              textAnchor="end"
            >
              STATE TAPE
            </text>
          </svg>
        </div>
      </section>

      {/* Educational Guide: 30-Second Trader Cheat Sheet */}
      <section className="cheat-sheet-section">
        <h2 className="section-title">The 4 Market Conditions: How to Trade Each One</h2>
        <div className="section-note" style={{ marginBottom: 16 }}>
          Most retail traders lose money because they trade during DEAD or CHOPPY periods. Here is how to use this tool:
        </div>

        <div className="cheat-grid">
          <div className="cheat-card cheat-trend">
            <div className="cheat-header">
              <span className="dot-mini trend-dot" />
              <h3>🟢 Trending (Prime Window)</h3>
            </div>
            <p className="cheat-desc">
              <strong>High Volatility + High Direction.</strong> Price is making sustained, powerful moves in one direction.
            </p>
            <div className="cheat-rule">
              <strong>Your Action:</strong> GREEN LIGHT. Look for trend pullback entries in the direction of momentum.
            </div>
          </div>

          <div className="cheat-card cheat-chop">
            <div className="cheat-header">
              <span className="dot-mini chop-dot" />
              <h3>🟡 Choppy (The Trap Zone)</h3>
            </div>
            <p className="cheat-desc">
              <strong>High Volatility + Low Direction.</strong> Big spikes up and down, but zero net progress.
            </p>
            <div className="cheat-rule">
              <strong>Your Action:</strong> STAND ASIDE. Breakouts fail instantly and hit stop-losses on both sides.
            </div>
          </div>

          <div className="cheat-card cheat-grind">
            <div className="cheat-header">
              <span className="dot-mini grind-dot" />
              <h3>🔵 Slow Drift (Creep Move)</h3>
            </div>
            <p className="cheat-desc">
              <strong>Low Volatility + Steady Direction.</strong> Price crawls slowly in one direction with low range.
            </p>
            <div className="cheat-rule">
              <strong>Your Action:</strong> CAUTIOUS. Aim for quick, smaller profit targets. Don&apos;t expect runners.
            </div>
          </div>

          <div className="cheat-card cheat-dead">
            <div className="cheat-header">
              <span className="dot-mini dead-dot" />
              <h3>⚪ Dead (The Graveyard)</h3>
            </div>
            <p className="cheat-desc">
              <strong>Low Volatility + Zero Direction.</strong> Complete flatline. No volume, no buyers, no sellers.
            </p>
            <div className="cheat-rule">
              <strong>Your Action:</strong> CLOSE CHARTS. Trading here just donates fees to the exchange. Wait for volatility.
            </div>
          </div>
        </div>
      </section>

      {/* Intraday Sessions & Weekday Statistics */}
      <section className="grid">
        <div className="card section">
          <div className="section-head">
            <h2 className="section-title">Best Trading Sessions (Historical)</h2>
            <span className="section-note">15m Trend Continuations · OOS</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th className="num">Trades (n)</th>
                <th className="num">Median Return</th>
                <th className="num">2R Target Hit</th>
              </tr>
            </thead>
            <tbody>
              {baseline.sessions.slice(0, 5).map(x => (
                <tr key={x.name}>
                  <td>
                    {x.name}
                    {x.samples < 15 && <span className="small-sample"> (small sample)</span>}
                  </td>
                  <td className="num">{x.samples}</td>
                  <td className={`num ${x.medianOutcomeR >= 0 ? 'positive' : 'negative'}`}>
                    {x.medianOutcomeR >= 0 ? `+${x.medianOutcomeR.toFixed(2)} R` : `${x.medianOutcomeR.toFixed(2)} R`}
                  </td>
                  <td className="num">{(x.hit2R * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-caveat">
            * Sample size per bucket is small ($n &lt; 15$), making individual rankings noisy. Treat as historical reference rather than a rigid rule.
          </div>
        </div>

        <div className="card section">
          <div className="section-head">
            <h2 className="section-title">Weekday Breakdown (Historical)</h2>
            <span className="section-note">Non-overlapping events</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Trades (n)</th>
                <th className="num">Median Return</th>
                <th className="num">2R Target Hit</th>
              </tr>
            </thead>
            <tbody>
              {baseline.weekdays.slice(0, 5).map(x => (
                <tr key={x.name}>
                  <td>
                    {x.name}
                    {x.samples < 15 && <span className="small-sample"> (small sample)</span>}
                  </td>
                  <td className="num">{x.samples}</td>
                  <td className={`num ${x.medianOutcomeR >= 0 ? 'positive' : 'negative'}`}>
                    {x.medianOutcomeR >= 0 ? `+${x.medianOutcomeR.toFixed(2)} R` : `${x.medianOutcomeR.toFixed(2)} R`}
                  </td>
                  <td className="num">{(x.hit2R * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-caveat">
            * Friday &amp; Thursday showed highest historical continuation probability in the 6-month test period.
          </div>
        </div>
      </section>

      {/* Footer & Data Tools */}
      <footer className="footer">
        <div>
          <span>{message}</span>
        </div>
        <div className="footer-links">
          <span>Export calls: </span>
          <button className="export" onClick={() => exportJSON().catch(() => setMessage('Could not export IndexedDB.'))}>JSON</button>
          <span> · </span>
          <button className="export" onClick={() => exportCSV().catch(() => setMessage('No log entries to export.'))}>CSV</button>
          <span> · </span>
          <button className="export" onClick={downloadServerLog}>Server Log</button>
          <span> · </span>
          <span>{baseline.dataStart ? `Baseline: ${baseline.dataStart.slice(0, 10)} → ${baseline.dataEnd.slice(0, 10)}` : 'No baseline loaded'}</span>
        </div>
      </footer>
    </main>
  );
}
