/**
 * Formatting and IST timezone utilities.
 * IST is Indian Standard Time (UTC+05:30, fixed offset without DST).
 */

const IST_TIMEZONE = 'Asia/Kolkata';

export function formatIstTime(timestamp: number | Date | string): string {
  const date = typeof timestamp === 'string' || typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatIstDateTime(timestamp: number | Date | string): string {
  const date = typeof timestamp === 'string' || typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatIstDate(timestamp: number | Date | string): string {
  const date = typeof timestamp === 'string' || typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function getIstWeekdayAndHour(timestamp: number | Date | string): {
  weekday: number; // 0 = Monday, 6 = Sunday (ISO/Python convention)
  hour: number;    // 0..23
  dayName: string;
} {
  const date = typeof timestamp === 'string' || typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  const istString = date.toLocaleString('en-US', { timeZone: IST_TIMEZONE });
  const istDate = new Date(istString);
  
  // JS getDay(): 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const jsDay = istDate.getDay();
  const weekday = (jsDay + 6) % 7; // Convert to: 0 = Monday, 6 = Sunday
  const hour = istDate.getHours();
  
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return {
    weekday,
    hour,
    dayName: dayNames[weekday],
  };
}

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(price);
}

export function formatPercent(val: number, decimals = 1): string {
  if (!Number.isFinite(val)) return '—';
  return `${val >= 0 ? '' : ''}${val.toFixed(decimals)}%`;
}

export function formatBps(val: number): string {
  if (!Number.isFinite(val)) return '—';
  return `${val.toFixed(1)} bps`;
}

export function formatDataAge(seconds: number): string {
  if (seconds < 60) {
    return `${Math.max(0, Math.floor(seconds))}s ago`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s ago`;
}
