'use client';

import React from 'react';

interface MetricGaugesProps {
  activityPercentile: number;
  persistencePercentile: number;
}

export const MetricGauges: React.FC<MetricGaugesProps> = ({
  activityPercentile,
  persistencePercentile,
}) => {
  const activityNote =
    activityPercentile >= 75
      ? 'Elevated activity (Top quartile)'
      : activityPercentile >= 50
      ? 'Above baseline median'
      : activityPercentile >= 25
      ? 'Below baseline median'
      : 'Depressed activity (Bottom quartile)';

  const persistenceNote =
    persistencePercentile >= 65
      ? 'Strong directional persistence'
      : persistencePercentile >= 50
      ? 'Moderate trend follow-through'
      : persistencePercentile >= 35
      ? 'Choppy rotation / mean-reverting'
      : 'Extreme noise / random walk';

  return (
    <div className="metrics-grid">
      <div className="card metric-card">
        <div className="metric-header">
          <span className="card-label">CORE AXIS: ACTIVITY</span>
          <span className="metric-percent font-mono">{activityPercentile.toFixed(0)}%</span>
        </div>
        <div className="gauge-track">
          <div
            className="gauge-fill"
            style={{
              width: `${Math.min(100, Math.max(0, activityPercentile))}%`,
              backgroundColor:
                activityPercentile >= 50
                  ? 'var(--color-trend)'
                  : 'var(--color-grind)',
            }}
          />
          <div className="gauge-median-marker" title="Median (50th percentile)" />
        </div>
        <div className="metric-footer">
          <span className="metric-interpretation">{activityNote}</span>
          <span className="metric-def font-mono">Rolling True Range</span>
        </div>
      </div>

      <div className="card metric-card">
        <div className="metric-header">
          <span className="card-label">CORE AXIS: PERSISTENCE</span>
          <span className="metric-percent font-mono">{persistencePercentile.toFixed(0)}%</span>
        </div>
        <div className="gauge-track">
          <div
            className="gauge-fill"
            style={{
              width: `${Math.min(100, Math.max(0, persistencePercentile))}%`,
              backgroundColor:
                persistencePercentile >= 50
                  ? 'var(--color-trend)'
                  : 'var(--color-chop)',
            }}
          />
          <div className="gauge-median-marker" title="Median (50th percentile)" />
        </div>
        <div className="metric-footer">
          <span className="metric-interpretation">{persistenceNote}</span>
          <span className="metric-def font-mono">Net Move / Total Move</span>
        </div>
      </div>
    </div>
  );
};
