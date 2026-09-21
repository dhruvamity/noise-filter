'use client';

import React, { useMemo } from 'react';
import { ScheduleArtifact, MatrixSlot } from '../../types/research';
import { getIstWeekdayAndHour } from '../../lib/formatters';

interface TradeWindowSummaryProps {
  schedule: ScheduleArtifact | null;
  currentTimestamp?: number;
}

export const TradeWindowSummary: React.FC<TradeWindowSummaryProps> = ({
  schedule,
  currentTimestamp,
}) => {
  const currentSlotInfo = useMemo(() => {
    if (!schedule || !schedule.matrix_168 || schedule.matrix_168.length === 0) {
      return null;
    }

    const ts = currentTimestamp && currentTimestamp > 0 ? currentTimestamp : 0;
    if (!ts) return null;
    const { weekday, hour, dayName } = getIstWeekdayAndHour(ts);

    const slot = schedule.matrix_168.find(
      (s: MatrixSlot) => s.dow_ist === weekday && s.hour_ist === hour
    );

    const nextHour = (hour + 1) % 24;
    const windowLabel = `${hour.toString().padStart(2, '0')}:00–${nextHour
      .toString()
      .padStart(2, '0')}:00 IST (${dayName})`;

    if (!slot) {
      return {
        windowLabel,
        condition: 'Uncalibrated',
        samples: 0,
        expectancyR: 0,
        profitFactor: 0,
        winRate: 0,
        chopPct: 0,
        momoPct: 0,
      };
    }

    let condition = 'Neutral rotation';
    if (slot.momo_pct >= 18 || slot.exp_r >= 0.2) {
      condition = 'High momentum follow-through';
    } else if (slot.chop_pct >= 45 || slot.exp_r < 0) {
      condition = 'Chop dominant / poor expansion';
    }

    return {
      windowLabel,
      condition,
      samples: slot.trades,
      expectancyR: slot.exp_r,
      profitFactor: slot.pf,
      winRate: slot.win_rate,
      chopPct: slot.chop_pct,
      momoPct: slot.momo_pct,
    };
  }, [schedule, currentTimestamp]);

  if (!currentSlotInfo) {
    return (
      <div className="card trade-window-card loading-state">
        <span className="card-label">IST MARKET WINDOW</span>
        <div className="loading-text">Loading historical baseline windows...</div>
      </div>
    );
  }

  const isPositive = currentSlotInfo.expectancyR > 0;

  return (
    <div className="card trade-window-card">
      <div className="card-header-simple">
        <span className="card-label">IST HISTORICAL MARKET WINDOW</span>
        <span className="window-time-badge font-mono">{currentSlotInfo.windowLabel}</span>
      </div>

      <div className="window-summary-grid">
        <div className="window-col">
          <span className="window-col-label">Historical Tendency</span>
          <span className="window-condition-val">{currentSlotInfo.condition}</span>
          <span className="window-col-sub">
            Chop {currentSlotInfo.chopPct.toFixed(1)}% · Momo {currentSlotInfo.momoPct.toFixed(1)}%
          </span>
        </div>

        <div className="window-col font-mono">
          <span className="window-col-label">Expectation</span>
          <span
            className="window-exp-val"
            style={{
              color: isPositive ? 'var(--color-trend)' : 'var(--color-neutral)',
            }}
          >
            {isPositive ? '+' : ''}
            {currentSlotInfo.expectancyR.toFixed(2)}R
          </span>
          <span className="window-col-sub">
            PF {currentSlotInfo.profitFactor.toFixed(2)} · WR {currentSlotInfo.winRate.toFixed(1)}%
          </span>
        </div>

        <div className="window-col font-mono">
          <span className="window-col-label">Sample Size</span>
          <span className="window-sample-val">N = {currentSlotInfo.samples}</span>
          <span className="window-col-sub">Historical discrete observations</span>
        </div>
      </div>
    </div>
  );
};
