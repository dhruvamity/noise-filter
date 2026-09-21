'use client';

import React, { useState, useRef, useEffect } from 'react';
import { WebSocketStatus } from '../../types/market';
import { formatDataAge, formatIstTime } from '../../lib/formatters';

interface TopBarProps {
  activeTab: 'live' | 'research';
  onTabChange: (tab: 'live' | 'research') => void;
  status: WebSocketStatus;
  lastClosedTime: number;
  dataAgeSeconds: number;
  onExportJson: () => void;
  onExportCsv: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onTabChange,
  status,
  lastClosedTime,
  dataAgeSeconds,
  onExportJson,
  onExportCsv,
}) => {
  const [exportOpen, setExportOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const statusColor =
    status === 'live'
      ? 'var(--color-trend)'
      : status === 'connecting'
      ? 'var(--color-chop)'
      : 'var(--color-error)';

  const statusLabel =
    status === 'live'
      ? 'LIVE'
      : status === 'connecting'
      ? 'CONNECTING'
      : status === 'stale'
      ? 'STALE'
      : 'ERROR';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="symbol-brand">
          <span className="symbol-name">BTCUSDT</span>
          <span className="symbol-tag">PERPETUAL</span>
        </div>

        <div className="feed-status" title="Binance Futures WebSocket Feed">
          <span className="status-dot" style={{ backgroundColor: statusColor }} />
          <span className="status-text" style={{ color: statusColor }}>
            {statusLabel}
          </span>
          <span className="status-separator">·</span>
          <span className="status-meta">
            Last bar {lastClosedTime > 0 ? `${formatIstTime(lastClosedTime)} IST` : '—'}
          </span>
          <span className="status-separator">·</span>
          <span className="status-meta">{formatDataAge(dataAgeSeconds)}</span>
        </div>
      </div>

      <div className="topbar-center">
        <nav className="tab-nav">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`}
            onClick={() => onTabChange('live')}
          >
            LIVE
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'research' ? 'active' : ''}`}
            onClick={() => onTabChange('research')}
          >
            RESEARCH
          </button>
        </nav>
      </div>

      <div className="topbar-right">
        <div className="export-wrapper" ref={dropdownRef}>
          <button
            type="button"
            className="export-btn"
            onClick={() => setExportOpen(!exportOpen)}
          >
            Export ▾
          </button>

          {exportOpen && (
            <div className="export-dropdown">
              <button
                type="button"
                className="export-item"
                onClick={() => {
                  setExportOpen(false);
                  onExportJson();
                }}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="export-item"
                onClick={() => {
                  setExportOpen(false);
                  onExportCsv();
                }}
              >
                Export CSV
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
