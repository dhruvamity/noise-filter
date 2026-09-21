'use client';

import React, { useState, useMemo } from 'react';
import { ScheduleArtifact, MatrixSlot } from '../../types/research';

interface ScheduleHeatmapProps {
  schedule: ScheduleArtifact | null;
}

type HeatmapMetric = 'expectancy' | 'chop' | 'momentum' | 'pf';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const ScheduleHeatmap: React.FC<ScheduleHeatmapProps> = ({ schedule }) => {
  const [metric, setMetric] = useState<HeatmapMetric>('expectancy');
  const [hoveredSlot, setHoveredSlot] = useState<MatrixSlot | null>(null);

  const slotMap = useMemo(() => {
    const map = new Map<string, MatrixSlot>();
    if (!schedule || !schedule.matrix_168) return map;
    for (const slot of schedule.matrix_168) {
      map.set(`${slot.dow_ist}-${slot.hour_ist}`, slot);
    }
    return map;
  }, [schedule]);

  if (!schedule) {
    return <div className="loading-text">Loading IST schedule matrix...</div>;
  }

  const getCellColor = (slot: MatrixSlot | undefined): string => {
    if (!slot || slot.trades === 0) return 'var(--cell-empty)';

    switch (metric) {
      case 'expectancy': {
        const val = slot.exp_r;
        if (val > 0.3) return 'rgba(16, 185, 129, 0.85)';
        if (val > 0.1) return 'rgba(16, 185, 129, 0.55)';
        if (val > 0.0) return 'rgba(16, 185, 129, 0.25)';
        if (val > -0.15) return 'rgba(239, 68, 68, 0.25)';
        return 'rgba(239, 68, 68, 0.65)';
      }
      case 'chop': {
        const val = slot.chop_pct;
        if (val > 50) return 'rgba(245, 158, 11, 0.85)';
        if (val > 40) return 'rgba(245, 158, 11, 0.55)';
        if (val > 30) return 'rgba(245, 158, 11, 0.3)';
        return 'rgba(56, 189, 248, 0.25)';
      }
      case 'momentum': {
        const val = slot.momo_pct;
        if (val > 20) return 'rgba(16, 185, 129, 0.85)';
        if (val > 15) return 'rgba(16, 185, 129, 0.55)';
        if (val > 10) return 'rgba(16, 185, 129, 0.3)';
        return 'rgba(107, 114, 128, 0.2)';
      }
      case 'pf': {
        const val = slot.pf;
        if (val > 1.8) return 'rgba(16, 185, 129, 0.85)';
        if (val > 1.3) return 'rgba(16, 185, 129, 0.55)';
        if (val >= 1.0) return 'rgba(16, 185, 129, 0.25)';
        return 'rgba(239, 68, 68, 0.4)';
      }
    }
  };

  const getCellLabel = (slot: MatrixSlot | undefined): string => {
    if (!slot || slot.trades === 0) return '·';
    switch (metric) {
      case 'expectancy':
        return `${slot.exp_r >= 0 ? '+' : ''}${slot.exp_r.toFixed(1)}`;
      case 'chop':
        return `${slot.chop_pct.toFixed(0)}%`;
      case 'momentum':
        return `${slot.momo_pct.toFixed(0)}%`;
      case 'pf':
        return slot.pf.toFixed(1);
    }
  };

  return (
    <div className="heatmap-component">
      <div className="heatmap-controls">
        <span className="card-label">7 × 24 IST SCHEDULE HEATMAP</span>
        <div className="metric-toggle font-mono">
          <button
            type="button"
            className={`metric-toggle-btn ${metric === 'expectancy' ? 'active' : ''}`}
            onClick={() => setMetric('expectancy')}
          >
            Expectancy (R)
          </button>
          <button
            type="button"
            className={`metric-toggle-btn ${metric === 'chop' ? 'active' : ''}`}
            onClick={() => setMetric('chop')}
          >
            Chop %
          </button>
          <button
            type="button"
            className={`metric-toggle-btn ${metric === 'momentum' ? 'active' : ''}`}
            onClick={() => setMetric('momentum')}
          >
            Momentum %
          </button>
          <button
            type="button"
            className={`metric-toggle-btn ${metric === 'pf' ? 'active' : ''}`}
            onClick={() => setMetric('pf')}
          >
            Profit Factor
          </button>
        </div>
      </div>

      <div className="heatmap-grid-scroll">
        <div className="heatmap-table font-mono">
          {/* Hour header */}
          <div className="heatmap-row header-row">
            <div className="day-cell-header">IST</div>
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="hour-col-header">
                {h.toString().padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* Weekday rows */}
          {DAYS.map((dayName, dow) => (
            <div key={dayName} className="heatmap-row">
              <div className="day-label-cell">{dayName}</div>
              {Array.from({ length: 24 }).map((_, h) => {
                const slot = slotMap.get(`${dow}-${h}`);
                const bg = getCellColor(slot);
                const label = getCellLabel(slot);

                return (
                  <div
                    key={h}
                    className="heatmap-cell"
                    style={{ backgroundColor: bg }}
                    onMouseEnter={() => slot && setHoveredSlot(slot)}
                    onMouseLeave={() => setHoveredSlot(null)}
                  >
                    <span className="cell-value">{label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Hover Inspection HUD */}
      <div className="heatmap-hud font-mono">
        {hoveredSlot ? (
          <div className="hud-content">
            <span className="hud-tag">
              {hoveredSlot.dow_name} {hoveredSlot.hour_ist.toString().padStart(2, '0')}:00 IST
            </span>
            <span>Samples: N = {hoveredSlot.trades}</span>
            <span>Expectancy: {hoveredSlot.exp_r >= 0 ? '+' : ''}{hoveredSlot.exp_r.toFixed(2)}R</span>
            <span>PF: {hoveredSlot.pf.toFixed(2)}</span>
            <span>Win Rate: {hoveredSlot.win_rate.toFixed(1)}%</span>
            <span>Chop: {hoveredSlot.chop_pct.toFixed(1)}%</span>
            <span>Momo: {hoveredSlot.momo_pct.toFixed(1)}%</span>
          </div>
        ) : (
          <span className="hud-placeholder">Hover over any cell to inspect slot statistics</span>
        )}
      </div>
    </div>
  );
};
