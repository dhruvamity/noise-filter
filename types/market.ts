export type Interval = '5m' | '15m' | '1h';

export type RegimeState = 'Trend' | 'Chop' | 'Grind' | 'Dead';

export type WebSocketStatus = 'connecting' | 'live' | 'stale' | 'error';

export interface Candle {
  openTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  closed: boolean;
}

export interface TimeframeMetric {
  interval: Interval;
  regime: RegimeState;
  activityPercentile: number;
  persistencePercentile: number;
  rangeBp: number;
  persistence: number;
  direction: number;
}

export interface MarketEnvironment {
  currentRegime: RegimeState;
  activityPercentile: number;
  persistencePercentile: number;
  timeframes: Record<Interval, TimeframeMetric>;
  alignmentScore: number;
  alignmentTotal: number;
  higherTimeframeAligned: boolean;
  lastClosedCandleTime: number;
  latestPrice: number;
}

export interface TimelinePoint {
  timestamp: number;
  price: number;
  regime: RegimeState;
  activityPercentile: number;
  persistencePercentile: number;
  rangeBp: number;
}
