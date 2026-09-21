'use client';

import React, { useState } from 'react';
import { BaselineArtifact, ScheduleArtifact } from '../../types/research';
import { formatIstDateTime, formatIstDate } from '../../lib/formatters';
import { ScheduleHeatmap } from './ScheduleHeatmap';

interface ResearchViewProps {
  baseline: BaselineArtifact | null;
  schedule: ScheduleArtifact | null;
}

type SectionKey = 'methodology' | 'calibration' | 'windows' | 'validation';

export const ResearchView: React.FC<ResearchViewProps> = ({ baseline, schedule }) => {
  const [activeSection, setActiveSection] = useState<SectionKey>('windows');

  if (!baseline) {
    return (
      <div className="card loading-state">
        <span className="card-label">RESEARCH AUDIT</span>
        <div className="loading-text">Loading verified research artifacts...</div>
      </div>
    );
  }

  return (
    <div className="research-container">
      {/* Top Research Overview Banner */}
      <div className="card research-overview-card">
        <div className="research-overview-header">
          <div>
            <span className="card-label">RESEARCH DATASET SPECIFICATION</span>
            <h2 className="overview-title font-mono">
              {baseline.symbol} Perpetual · {formatIstDate(baseline.dataStart)} → {formatIstDate(baseline.dataEnd)}
            </h2>
          </div>
          <div className="overview-meta font-mono">
            <div>Version {baseline.regimeSpec.version}</div>
            <div className="meta-sub">Generated: {formatIstDateTime(baseline.generatedAt)}</div>
          </div>
        </div>

        <div className="overview-grid font-mono">
          <div className="overview-item">
            <span className="overview-item-label">Symbol</span>
            <span className="overview-item-val">{baseline.symbol} Futures</span>
          </div>
          <div className="overview-item">
            <span className="overview-item-label">Timeframes</span>
            <span className="overview-item-val">5m (Primary) · 15m · 1h</span>
          </div>
          <div className="overview-item">
            <span className="overview-item-label">In-Sample Fit Horizon</span>
            <span className="overview-item-val">→ {formatIstDate(baseline.fitEnd)}</span>
          </div>
          <div className="overview-item">
            <span className="overview-item-label">Hour Baseline Buckets</span>
            <span className="overview-item-val">168 (7 weekdays × 24h IST)</span>
          </div>
        </div>
      </div>

      {/* Sub-Navigation for Research Sections */}
      <div className="research-nav">
        <button
          type="button"
          className={`research-nav-btn ${activeSection === 'windows' ? 'active' : ''}`}
          onClick={() => setActiveSection('windows')}
        >
          Historical Windows
        </button>
        <button
          type="button"
          className={`research-nav-btn ${activeSection === 'methodology' ? 'active' : ''}`}
          onClick={() => setActiveSection('methodology')}
        >
          Regime Methodology
        </button>
        <button
          type="button"
          className={`research-nav-btn ${activeSection === 'calibration' ? 'active' : ''}`}
          onClick={() => setActiveSection('calibration')}
        >
          Calibration & Drift
        </button>
        <button
          type="button"
          className={`research-nav-btn ${activeSection === 'validation' ? 'active' : ''}`}
          onClick={() => setActiveSection('validation')}
        >
          Validation Audit
        </button>
      </div>

      {/* Section Content */}
      {activeSection === 'windows' && (
        <div className="card research-section-card">
          <ScheduleHeatmap schedule={schedule} />

          {schedule?.dow_summary && (
            <div className="dow-table-section">
              <span className="card-label">PER-WEEKDAY HISTORICAL EXPECTANCY (IST)</span>
              <table className="matrix-table font-mono">
                <thead>
                  <tr>
                    <th>WEEKDAY</th>
                    <th>SAMPLE SIZE (N)</th>
                    <th>WIN RATE</th>
                    <th>PROFIT FACTOR</th>
                    <th>EXPECTANCY (R)</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.dow_summary.map((d) => (
                    <tr key={d.dow_ist}>
                      <td className="fw-semibold">{d.dow_name}</td>
                      <td>{d.trades}</td>
                      <td>{d.win_rate.toFixed(1)}%</td>
                      <td>{d.pf.toFixed(2)}</td>
                      <td className={d.exp_r > 0 ? 'color-trend' : 'color-neutral'}>
                        {d.exp_r >= 0 ? '+' : ''}
                        {d.exp_r.toFixed(2)}R
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeSection === 'methodology' && (
        <div className="card research-section-card">
          <span className="card-label">ANALYTICAL FOUNDATION</span>
          <div className="methodology-grid">
            <div className="methodology-block">
              <h3>1. Activity Axis (Volatility)</h3>
              <p>
                Calculated as the rolling sum of True Range normalized by closing price in basis
                points (bps):
              </p>
              <code className="math-code font-mono">
                Activity (bps) = [ Σ TR(t - N + i) / Close(t) ] × 10,000
              </code>
              <p>
                Measures the sheer volatility and energy expanding through the market over rolling
                windows.
              </p>
            </div>

            <div className="methodology-block">
              <h3>2. Directional Persistence (Follow-Through)</h3>
              <p>
                Calculated as the ratio of absolute net displacement to total gross path
                displacement:
              </p>
              <code className="math-code font-mono">
                Persistence = |Close(t) - Close(t - N)| / Σ |Close(i) - Close(i - 1)|
              </code>
              <p>
                Distinguishes between clean vector-like displacement and oscillatory chop where
                gross movement cancels itself out.
              </p>
            </div>

            <div className="methodology-block">
              <h3>3. Timezone-Conditioned Normalization</h3>
              <p>
                Raw activity and persistence vary by time of day. Values are non-parametrically
                ranked against 168 distinct IST hourly baseline distributions (7 weekdays × 24
                hours). A reading of 75% indicates activity higher than 75% of historical bars for
                that specific weekday and hour.
              </p>
            </div>

            <div className="methodology-block">
              <h3>4. Four Discrete Regime States</h3>
              <ul className="regime-definitions">
                <li>
                  <strong className="color-trend">Trend:</strong> High activity
                  (≥50th percentile) and clean persistence (≥50th percentile), or high persistence
                  (≥65th) with moderate activity (≥30th).
                </li>
                <li>
                  <strong className="color-chop">Chop:</strong> High activity (≥50th
                  percentile) accompanied by low persistence (&lt;50th percentile).
                </li>
                <li>
                  <strong className="color-grind">Grind:</strong> High persistence
                  (≥50th percentile) with low activity (&lt;50th percentile).
                </li>
                <li>
                  <strong className="color-dead">Dead:</strong> Low activity and low
                  persistence below historical medians.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'calibration' && (
        <div className="card research-section-card">
          <span className="card-label">CALIBRATION & DRIFT MONITORING</span>
          <p className="section-intro">
            Baselines are fit strictly on the in-sample period. Out-of-sample data is monitored to
            detect structural drift without overfitting.
          </p>

          <div className="calibration-stats font-mono">
            <div className="cal-stat-card">
              <span className="cal-label">In-Sample Fit End</span>
              <span className="cal-val">{formatIstDateTime(baseline.fitEnd)}</span>
            </div>
            <div className="cal-stat-card">
              <span className="cal-label">Evaluation End</span>
              <span className="cal-val">{formatIstDateTime(baseline.dataEnd)}</span>
            </div>
            <div className="cal-stat-card">
              <span className="cal-label">Quantile Check</span>
              <span className="cal-val">q10 ≤ q25 ≤ q50 ≤ q75 ≤ q90 Monotone</span>
            </div>
          </div>

          {baseline.oosLabels && (
            <div className="oos-labels-summary">
              <span className="card-label">OUT-OF-SAMPLE REGIME DISTRIBUTION</span>
              <div className="oos-grid font-mono">
                <div className="oos-item">
                  <span className="oos-name color-trend">Trend</span>
                  <span className="oos-count">{baseline.oosLabels.trend?.toLocaleString()}</span>
                </div>
                <div className="oos-item">
                  <span className="oos-name color-chop">Chop</span>
                  <span className="oos-count">{baseline.oosLabels.chop?.toLocaleString()}</span>
                </div>
                <div className="oos-item">
                  <span className="oos-name color-grind">Grind</span>
                  <span className="oos-count">{baseline.oosLabels.grind?.toLocaleString()}</span>
                </div>
                <div className="oos-item">
                  <span className="oos-name color-dead">Dead</span>
                  <span className="oos-count">{baseline.oosLabels.dead?.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeSection === 'validation' && (
        <div className="card research-section-card">
          <span className="card-label">WALK-FORWARD OUT-OF-SAMPLE VALIDATION</span>
          <p className="section-intro">
            Discrete trade outcome evaluation across trading sessions and weekdays on out-of-sample
            holdouts.
          </p>

          {baseline.sessions && (
            <div className="validation-table-wrap">
              <span className="card-label">SESSION DISTRIBUTION</span>
              <table className="matrix-table font-mono">
                <thead>
                  <tr>
                    <th>SESSION</th>
                    <th>SAMPLE SIZE (N)</th>
                    <th>MFE (R)</th>
                    <th>MAE (R)</th>
                    <th>MFE/MAE RATIO</th>
                    <th>2R HIT RATE</th>
                  </tr>
                </thead>
                <tbody>
                  {baseline.sessions.map((s) => (
                    <tr key={s.name}>
                      <td className="fw-semibold">{s.name}</td>
                      <td>{s.samples}</td>
                      <td>{s.mfeR.toFixed(2)}R</td>
                      <td>{s.maeR.toFixed(2)}R</td>
                      <td className={s.ratio >= 1.0 ? 'color-trend' : 'color-neutral'}>
                        {s.ratio.toFixed(2)}
                      </td>
                      <td>{(s.hit2R * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="methodology-block mt-15">
            <h3>Empirical Limitations</h3>
            <p className="desc-text">
              All expectations reflect historical discrete observations from Binance Futures BTCUSDT
              perpetual contracts. Market regimes describe prevailing environmental conditions and
              structural state; they do not guarantee execution outcomes or individual trade
              profitability.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
