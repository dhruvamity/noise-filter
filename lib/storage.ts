import { RegimeState } from '../types/market';
import { formatIstDateTime } from './formatters';

export interface RegimeLogEntry {
  timestamp: number;
  istTime: string;
  price: number;
  regime: RegimeState;
  activityPercentile: number;
  persistencePercentile: number;
  rangeBp: number;
  persistence: number;
}

const DB_NAME = 'btc_regime_terminal_db';
const STORE_NAME = 'regime_logs';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveRegimeLog(entry: RegimeLogEntry): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);
  } catch {
    // Non-critical background save failure
  }
}

export async function getAllRegimeLogs(): Promise<RegimeLogEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export function exportToJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, filename);
}

export function exportToCsv(
  entries: RegimeLogEntry[],
  filename = 'btc_regime_history.csv'
): void {
  if (entries.length === 0) return;

  const headers = [
    'Timestamp',
    'IST Time',
    'Price',
    'Regime',
    'Activity Percentile',
    'Persistence Percentile',
    'Range (bps)',
    'Persistence',
  ];

  const rows = entries.map((e) => [
    e.timestamp,
    `"${e.istTime || formatIstDateTime(e.timestamp)}"`,
    e.price,
    e.regime,
    e.activityPercentile.toFixed(1),
    e.persistencePercentile.toFixed(1),
    e.rangeBp.toFixed(1),
    e.persistence.toFixed(3),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
