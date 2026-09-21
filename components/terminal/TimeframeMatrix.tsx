'use client';

import React from 'react';
import { MarketEnvironment, Interval } from '../../types/market';
import { getRegimeColors } from '../../lib/regime';

interface TimeframeMatrixProps {
  environment: MarketEnvironment | null;
}

export const TimeframeMatrix: React.FC<TimeframeMatrixProps> = ({ environment }) => {
  if (!environment) return null;

  const intervals: { tf: Interval; role: string }[] = [
    { tf: '5m', role: 'Primary execution horizon (1h rolling)' },
    { tf: '15m', role: 'Structural confirmation (2h rolling)' },
    { tf: '1h', role: 'Macro regime context (6h rolling)' },
  ];

  return (
    <div className="card matrix-card">
      <div className="card-header-simple">
        <span className="card-label">TIMEFRAME CONTEXT</span>
        <span className="matrix-meta font-mono">
          Alignment: {environment.alignmentScore} / {environment.alignmentTotal}
        </span>
      </div>

      <div className="matrix-table-wrap">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>TIMEFRAME</th>
              <th>REGIME</th>
              <th>ACTIVITY</th>
              <th>PERSISTENCE</th>
              <th>RANGE</th>
            </tr>
          </thead>
          <tbody>
            {intervals.map(({ tf, role }) => {
              const data = environment.timeframes[tf];
              const colors = getRegimeColors(data.regime);
              return (
                <tr key={tf}>
                  <td className="tf-cell">
                    <span className="tf-name font-mono">{tf}</span>
                    <span className="tf-role">{role}</span>
                  </td>
                  <td>
                    <span
                      className="regime-tag"
                      style={{
                        color: colors.color,
                        backgroundColor: colors.bg,
                        borderColor: colors.border,
                      }}
                    >
                      {data.regime}
                    </span>
                  </td>
                  <td className="font-mono">
                    <div className="pct-bar-wrap">
                      <div
                        className="pct-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, data.activityPercentile))}%`,
                          backgroundColor:
                            data.activityPercentile >= 50
                              ? 'var(--color-trend)'
                              : 'var(--color-neutral)',
                        }}
                      />
                    </div>
                    <span>{data.activityPercentile.toFixed(0)}%</span>
                  </td>
                  <td className="font-mono">
                    <div className="pct-bar-wrap">
                      <div
                        className="pct-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, data.persistencePercentile))}%`,
                          backgroundColor:
                            data.persistencePercentile >= 50
                              ? 'var(--color-trend)'
                              : 'var(--color-neutral)',
                        }}
                      />
                    </div>
                    <span>{data.persistencePercentile.toFixed(0)}%</span>
                  </td>
                  <td className="font-mono">{data.rangeBp.toFixed(1)} bps</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
