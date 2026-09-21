'use client';

import React from 'react';
import { MarketEnvironment } from '../../types/market';
import { getRegimeDescription, getRegimeColors } from '../../lib/regime';
import { formatPrice } from '../../lib/formatters';

interface RegimeCardProps {
  environment: MarketEnvironment | null;
}

export const RegimeCard: React.FC<RegimeCardProps> = ({ environment }) => {
  if (!environment) {
    return (
      <div className="card regime-card loading-state">
        <div className="card-label">CURRENT MARKET REGIME</div>
        <div className="regime-loading">Synchronizing market data...</div>
      </div>
    );
  }

  const {
    currentRegime,
    activityPercentile,
    persistencePercentile,
    latestPrice,
    timeframes,
    alignmentScore,
    alignmentTotal,
    higherTimeframeAligned,
  } = environment;

  const colors = getRegimeColors(currentRegime);
  const description = getRegimeDescription(currentRegime);

  return (
    <div
      className="card regime-card"
      style={{
        borderColor: colors.border,
        background: `radial-gradient(ellipse at top left, ${colors.bg}, var(--surface-bg) 60%)`,
      }}
    >
      <div className="regime-card-header">
        <div className="card-label">CURRENT MARKET REGIME</div>
        <div className="regime-price">
          <span className="price-label">LAST PRICE</span>
          <span className="price-value font-mono">${formatPrice(latestPrice)}</span>
        </div>
      </div>

      <div className="regime-main-row">
        <div className="regime-title-wrap">
          <h1 className="regime-title" style={{ color: colors.color }}>
            {currentRegime.toUpperCase()}
          </h1>
          <p className="regime-description">{description}</p>
        </div>

        <div className="regime-metrics-compact font-mono">
          <div className="metric-pill">
            <span className="metric-tag">Activity</span>
            <span className="metric-num">{activityPercentile.toFixed(0)}</span>
            <span className="metric-sub">
              {activityPercentile >= 50 ? 'Above median' : 'Below median'}
            </span>
          </div>

          <div className="metric-pill">
            <span className="metric-tag">Persistence</span>
            <span className="metric-num">{persistencePercentile.toFixed(0)}</span>
            <span className="metric-sub">
              {persistencePercentile >= 65
                ? 'Strong'
                : persistencePercentile >= 50
                ? 'Moderate'
                : 'Weak'}
            </span>
          </div>
        </div>
      </div>

      <div className="regime-footer-row">
        <div className="tf-pills">
          <div className="tf-pill">
            <span className="tf-label">5m</span>
            <span
              className="tf-value"
              style={{ color: getRegimeColors(timeframes['5m'].regime).color }}
            >
              {timeframes['5m'].regime}
            </span>
          </div>
          <div className="tf-pill">
            <span className="tf-label">15m</span>
            <span
              className="tf-value"
              style={{ color: getRegimeColors(timeframes['15m'].regime).color }}
            >
              {timeframes['15m'].regime}
            </span>
          </div>
          <div className="tf-pill">
            <span className="tf-label">1h</span>
            <span
              className="tf-value"
              style={{ color: getRegimeColors(timeframes['1h'].regime).color }}
            >
              {timeframes['1h'].regime}
            </span>
          </div>
        </div>

        <div className="alignment-indicator">
          <span className="alignment-badge font-mono">
            Alignment: {alignmentScore}/{alignmentTotal}
          </span>
          <span className="alignment-text">
            {higherTimeframeAligned
              ? 'Higher-timeframe context aligned'
              : 'Timeframes diverged'}
          </span>
        </div>
      </div>
    </div>
  );
};
