'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Candle,
  Interval,
  MarketEnvironment,
  TimelinePoint,
  WebSocketStatus,
  TimeframeMetric,
} from '../types/market';
import { BaselineArtifact, ScheduleArtifact } from '../types/research';
import {
  fetchHistoricalCandles,
  mergeCandle,
  MarketDataSocket,
} from '../lib/market-data';
import {
  calculateFeatures,
  scoreFeatures,
  classifyRegime,
} from '../lib/regime';
import {
  saveRegimeLog,
  getAllRegimeLogs,
  exportToJson,
  exportToCsv,
} from '../lib/storage';
import { TopBar } from '../components/terminal/TopBar';
import { RegimeCard } from '../components/terminal/RegimeCard';
import { TimeframeMatrix } from '../components/terminal/TimeframeMatrix';
import { MetricGauges } from '../components/terminal/MetricGauges';
import { TimelineChart } from '../components/terminal/TimelineChart';
import { TradeWindowSummary } from '../components/terminal/TradeWindowSummary';
import { ResearchView } from '../components/terminal/ResearchView';

export default function TerminalPage() {
  const [activeTab, setActiveTab] = useState<'live' | 'research'>('live');
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>('connecting');
  const [dataAgeSeconds, setDataAgeSeconds] = useState(0);

  const [baseline, setBaseline] = useState<BaselineArtifact | null>(null);
  const [schedule, setSchedule] = useState<ScheduleArtifact | null>(null);

  const [candles5m, setCandles5m] = useState<Candle[]>([]);
  const [candles15m, setCandles15m] = useState<Candle[]>([]);
  const [candles1h, setCandles1h] = useState<Candle[]>([]);
  const [livePrice, setLivePrice] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);

  const lastUpdateRef = useRef<number>(0);
  const socketRef = useRef<MarketDataSocket | null>(null);

  // Load static baseline and schedule artifacts
  useEffect(() => {
    let active = true;

    async function loadArtifacts() {
      try {
        const [resBase, resSched] = await Promise.all([
          fetch('/baseline.json'),
          fetch('/ist_schedule.json'),
        ]);

        if (!active) return;
        if (resBase.ok) {
          const baseData = (await resBase.json()) as BaselineArtifact;
          setBaseline(baseData);
        }
        if (resSched.ok) {
          const schedData = (await resSched.json()) as ScheduleArtifact;
          setSchedule(schedData);
        }
      } catch {
        // Artifacts load fallback
      }
    }

    loadArtifacts();
    return () => {
      active = false;
    };
  }, []);

  // Clock and data freshness age counter
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setCurrentTime(now);
      if (lastUpdateRef.current > 0) {
        setDataAgeSeconds(Math.max(0, (now - lastUpdateRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Seed historical candles via REST API
  useEffect(() => {
    let active = true;

    async function seedData() {
      try {
        const [c5, c15, c1] = await Promise.all([
          fetchHistoricalCandles('5m', 300),
          fetchHistoricalCandles('15m', 150),
          fetchHistoricalCandles('1h', 100),
        ]);

        if (!active) return;

        setCandles5m(c5);
        setCandles15m(c15);
        setCandles1h(c1);

        const latest = c5[c5.length - 1];
        if (latest) {
          setLivePrice(latest.c);
          lastUpdateRef.current = Date.now();
        }
      } catch {
        if (active) setWsStatus('error');
      }
    }

    seedData();
    return () => {
      active = false;
    };
  }, []);

  // Handle incoming live candle updates from WebSocket
  const handleCandleUpdate = useCallback(
    ({ interval, candle }: { interval: Interval; candle: Candle }) => {
      lastUpdateRef.current = Date.now();
      setLivePrice(candle.c);

      if (interval === '5m') {
        setCandles5m((prev) => mergeCandle(prev, candle));
      } else if (interval === '15m') {
        setCandles15m((prev) => mergeCandle(prev, candle));
      } else if (interval === '1h') {
        setCandles1h((prev) => mergeCandle(prev, candle));
      }
    },
    []
  );

  // Initialize Binance WebSocket
  useEffect(() => {
    const socket = new MarketDataSocket(
      handleCandleUpdate,
      (status) => setWsStatus(status)
    );
    socketRef.current = socket;
    socket.connect();

    return () => {
      socket.destroy();
      socketRef.current = null;
    };
  }, [handleCandleUpdate]);

  // Compute live market regime and context
  const marketEnvironment = useMemo<MarketEnvironment | null>(() => {
    if (
      !baseline ||
      candles5m.length < 15 ||
      candles15m.length < 10 ||
      candles1h.length < 8
    ) {
      return null;
    }

    const closed5m = candles5m.filter((c) => c.closed);
    const closed15m = candles15m.filter((c) => c.closed);
    const closed1h = candles1h.filter((c) => c.closed);

    if (closed5m.length < 12 || closed15m.length < 8 || closed1h.length < 6) {
      return null;
    }

    const spec = baseline.regimeSpec;

    // 5m primary
    const f5m = calculateFeatures(closed5m, baseline.timeframes['5m'].lookback);
    const s5m = f5m
      ? scoreFeatures(f5m, closed5m[closed5m.length - 1].openTime, baseline.timeframes['5m'])
      : { activityPercentile: 50, persistencePercentile: 50 };
    const r5m = classifyRegime(s5m.activityPercentile, s5m.persistencePercentile, spec);

    // 15m confirmation
    const f15m = calculateFeatures(closed15m, baseline.timeframes['15m'].lookback);
    const s15m = f15m
      ? scoreFeatures(f15m, closed15m[closed15m.length - 1].openTime, baseline.timeframes['15m'])
      : { activityPercentile: 50, persistencePercentile: 50 };
    const r15m = classifyRegime(s15m.activityPercentile, s15m.persistencePercentile, spec);

    // 1h macro context
    const f1h = calculateFeatures(closed1h, baseline.timeframes['1h'].lookback);
    const s1h = f1h
      ? scoreFeatures(f1h, closed1h[closed1h.length - 1].openTime, baseline.timeframes['1h'])
      : { activityPercentile: 50, persistencePercentile: 50 };
    const r1h = classifyRegime(s1h.activityPercentile, s1h.persistencePercentile, spec);

    const timeframes: Record<Interval, TimeframeMetric> = {
      '5m': {
        interval: '5m',
        regime: r5m,
        activityPercentile: s5m.activityPercentile,
        persistencePercentile: s5m.persistencePercentile,
        rangeBp: f5m?.rangeBp ?? 0,
        persistence: f5m?.persistence ?? 0,
        direction: f5m?.direction ?? 0,
      },
      '15m': {
        interval: '15m',
        regime: r15m,
        activityPercentile: s15m.activityPercentile,
        persistencePercentile: s15m.persistencePercentile,
        rangeBp: f15m?.rangeBp ?? 0,
        persistence: f15m?.persistence ?? 0,
        direction: f15m?.direction ?? 0,
      },
      '1h': {
        interval: '1h',
        regime: r1h,
        activityPercentile: s1h.activityPercentile,
        persistencePercentile: s1h.persistencePercentile,
        rangeBp: f1h?.rangeBp ?? 0,
        persistence: f1h?.persistence ?? 0,
        direction: f1h?.direction ?? 0,
      },
    };

    let matchCount = 1;
    if (r15m === r5m) matchCount++;
    if (r1h === r5m) matchCount++;

    const higherTimeframeAligned = r5m === r15m && r5m === r1h;
    const lastBar = closed5m[closed5m.length - 1];

    return {
      currentRegime: r5m,
      activityPercentile: s5m.activityPercentile,
      persistencePercentile: s5m.persistencePercentile,
      timeframes,
      alignmentScore: matchCount,
      alignmentTotal: 3,
      higherTimeframeAligned,
      lastClosedCandleTime: lastBar.openTime,
      latestPrice: livePrice || lastBar.c,
    };
  }, [baseline, candles5m, candles15m, candles1h, livePrice]);

  // Derive historical timeline points for the chart
  const timelinePoints = useMemo<TimelinePoint[]>(() => {
    if (!baseline || candles5m.length === 0) return [];
    const closed = candles5m.filter((c) => c.closed);
    const lookback = baseline.timeframes['5m'].lookback;
    const spec = baseline.regimeSpec;

    const points: TimelinePoint[] = [];
    for (let i = lookback; i < closed.length; i++) {
      const slice = closed.slice(0, i + 1);
      const f = calculateFeatures(slice, lookback);
      if (!f) continue;
      const bar = closed[i];
      const s = scoreFeatures(f, bar.openTime, baseline.timeframes['5m']);
      const regime = classifyRegime(s.activityPercentile, s.persistencePercentile, spec);

      points.push({
        timestamp: bar.openTime,
        price: bar.c,
        regime,
        activityPercentile: s.activityPercentile,
        persistencePercentile: s.persistencePercentile,
        rangeBp: f.rangeBp,
      });
    }

    return points;
  }, [baseline, candles5m]);

  // Background IndexedDB persistence of closed bars
  useEffect(() => {
    if (!marketEnvironment) return;
    const latest = candles5m.filter((c) => c.closed).at(-1);
    if (!latest) return;

    saveRegimeLog({
      timestamp: latest.openTime,
      istTime: new Date(latest.openTime).toISOString(),
      price: latest.c,
      regime: marketEnvironment.currentRegime,
      activityPercentile: marketEnvironment.activityPercentile,
      persistencePercentile: marketEnvironment.persistencePercentile,
      rangeBp: marketEnvironment.timeframes['5m'].rangeBp,
      persistence: marketEnvironment.timeframes['5m'].persistence,
    });
  }, [marketEnvironment, candles5m]);

  const handleExportJson = async () => {
    const logs = await getAllRegimeLogs();
    const dataToExport = logs.length > 0 ? logs : timelinePoints;
    exportToJson(dataToExport, `btcusdt_regimes_${Date.now()}.json`);
  };

  const handleExportCsv = async () => {
    const logs = await getAllRegimeLogs();
    const entries = logs.length > 0 ? logs : timelinePoints.map((p) => ({
      timestamp: p.timestamp,
      istTime: new Date(p.timestamp).toISOString(),
      price: p.price,
      regime: p.regime,
      activityPercentile: p.activityPercentile,
      persistencePercentile: p.persistencePercentile,
      rangeBp: p.rangeBp,
      persistence: 0,
    }));
    exportToCsv(entries, `btcusdt_regimes_${Date.now()}.csv`);
  };

  return (
    <div className="terminal-root">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={wsStatus}
        lastClosedTime={marketEnvironment?.lastClosedCandleTime ?? 0}
        dataAgeSeconds={dataAgeSeconds}
        onExportJson={handleExportJson}
        onExportCsv={handleExportCsv}
      />

      <main className="terminal-main">
        {activeTab === 'live' ? (
          <div className="live-layout">
            {/* Primary Decision Card */}
            <RegimeCard environment={marketEnvironment} />

            {/* Timeframe Matrix */}
            <TimeframeMatrix environment={marketEnvironment} />

            {/* Core Driving Metrics (Activity & Persistence) */}
            <MetricGauges
              activityPercentile={marketEnvironment?.activityPercentile ?? 50}
              persistencePercentile={marketEnvironment?.persistencePercentile ?? 50}
            />

            {/* Main Visual: Historical Timeline (24H / 48H) */}
            <TimelineChart points={timelinePoints} />

            {/* IST Historical Windows */}
            <TradeWindowSummary schedule={schedule} currentTimestamp={currentTime} />
          </div>
        ) : (
          <ResearchView baseline={baseline} schedule={schedule} />
        )}
      </main>
    </div>
  );
}
