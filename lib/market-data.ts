import { Candle, Interval, WebSocketStatus } from '../types/market';

const BINANCE_REST_BASE = 'https://fapi.binance.com/fapi/v1/klines';
const BINANCE_WS_URL = 'wss://fstream.binance.com/stream?streams=btcusdt@kline_5m/btcusdt@kline_15m/btcusdt@kline_1h';

export interface KlinePayload {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  interval: Interval;
}

/**
 * Seed historical candles for an interval via Binance Futures REST API.
 */
export async function fetchHistoricalCandles(
  interval: Interval,
  limit = 200
): Promise<Candle[]> {
  const url = `${BINANCE_REST_BASE}?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch BTCUSDT ${interval} candles: ${response.statusText}`);
  }

  const raw = await response.json();
  const now = Date.now();

  const intervalMsMap: Record<Interval, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
  };
  const durationMs = intervalMsMap[interval];

  return raw.map((k: (string | number)[]) => {
    const openTime = Number(k[0]);
    const closeTime = Number(k[6]);
    const isClosed = closeTime < now || openTime + durationMs <= now;

    return {
      openTime,
      o: parseFloat(String(k[1])),
      h: parseFloat(String(k[2])),
      l: parseFloat(String(k[3])),
      c: parseFloat(String(k[4])),
      v: parseFloat(String(k[5])),
      closed: isClosed,
    };
  });
}

/**
 * Merge new candle into candle series, maintaining order and uniqueness.
 */
export function mergeCandle(candles: Candle[], incoming: Candle): Candle[] {
  const idx = candles.findIndex((c) => c.openTime === incoming.openTime);
  if (idx >= 0) {
    const next = [...candles];
    next[idx] = incoming;
    return next;
  }
  const next = [...candles, incoming];
  return next.sort((a, b) => a.openTime - b.openTime);
}

export type CandleUpdateHandler = (update: {
  interval: Interval;
  candle: Candle;
}) => void;

export type StatusUpdateHandler = (status: WebSocketStatus) => void;

export class MarketDataSocket {
  private ws: WebSocket | null = null;
  private isDestroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private lastMessageTime = 0;

  constructor(
    private onCandleUpdate: CandleUpdateHandler,
    private onStatusUpdate: StatusUpdateHandler
  ) {}

  public connect(): void {
    if (this.isDestroyed || typeof window === 'undefined') return;

    this.cleanupSocket();
    this.onStatusUpdate('connecting');

    try {
      this.ws = new WebSocket(BINANCE_WS_URL);

      this.ws.onopen = () => {
        this.lastMessageTime = Date.now();
        this.onStatusUpdate('live');
        this.startStaleCheck();
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        try {
          const message = JSON.parse(event.data);
          if (!message?.data?.k) return;

          const k = message.data.k;
          const interval = k.i as Interval;
          if (interval !== '5m' && interval !== '15m' && interval !== '1h') return;

          const candle: Candle = {
            openTime: Number(k.t),
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
            v: parseFloat(k.v),
            closed: Boolean(k.x),
          };

          this.onCandleUpdate({ interval, candle });
        } catch {
          // Ignore malformed message
        }
      };

      this.ws.onerror = () => {
        this.onStatusUpdate('error');
      };

      this.ws.onclose = () => {
        if (!this.isDestroyed) {
          this.onStatusUpdate('stale');
          this.scheduleReconnect();
        }
      };
    } catch {
      this.onStatusUpdate('error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDestroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private startStaleCheck(): void {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = setInterval(() => {
      if (this.isDestroyed) return;
      if (this.lastMessageTime > 0 && Date.now() - this.lastMessageTime > 30000) {
        this.onStatusUpdate('stale');
      }
    }, 10000);
  }

  private cleanupSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
  }
}
