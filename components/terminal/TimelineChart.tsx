'use client';

import React, { useState, useMemo, useRef } from 'react';
import { TimelinePoint } from '../../types/market';
import { formatPrice, formatIstTime } from '../../lib/formatters';
import { getRegimeColors } from '../../lib/regime';

interface TimelineChartProps {
  points: TimelinePoint[];
}

export const TimelineChart: React.FC<TimelineChartProps> = ({ points }) => {
  const [horizon, setHorizon] = useState<'24H' | '48H'>('24H');
  const [hoveredPoint, setHoveredPoint] = useState<TimelinePoint | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number; tooltipLeft: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter points according to horizon (5m candles: 24h = 288, 48h = 576)
  const displayPoints = useMemo(() => {
    const count = horizon === '24H' ? 288 : 576;
    return points.slice(-count);
  }, [points, horizon]);

  const { minPrice, maxPrice, pathD, width, height } = useMemo(() => {
    const w = 900;
    const h = 260;
    if (displayPoints.length < 2) {
      return { minPrice: 0, maxPrice: 0, pathD: '', width: w, height: h };
    }

    let min = Infinity;
    let max = -Infinity;
    for (const p of displayPoints) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }

    const pricePadding = (max - min) * 0.08 || 10;
    const paddedMin = min - pricePadding;
    const paddedMax = max + pricePadding;
    const priceRange = paddedMax - paddedMin || 1;

    const chartHeight = h - 45; // Leave bottom 45px for regime band & axis

    const pts = displayPoints.map((p, i) => {
      const x = (i / (displayPoints.length - 1)) * w;
      const y = chartHeight - ((p.price - paddedMin) / priceRange) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const d = `M ${pts.join(' L ')}`;
    return {
      minPrice: min,
      maxPrice: max,
      pathD: d,
      width: w,
      height: h,
    };
  }, [displayPoints]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || displayPoints.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const fraction = Math.max(0, Math.min(1, clientX / rect.width));
    const idx = Math.min(
      displayPoints.length - 1,
      Math.floor(fraction * displayPoints.length)
    );

    const tooltipLeft = Math.min(
      rect.width - 260,
      Math.max(10, clientX - 120)
    );

    setHoveredPoint(displayPoints[idx]);
    setHoverPos({ x: clientX, y: clientY, tooltipLeft });
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
    setHoverPos(null);
  };

  // Time grid markers
  const timeMarkers = useMemo(() => {
    if (displayPoints.length < 10) return [];
    const step = Math.floor(displayPoints.length / 5);
    const markers = [];
    for (let i = 0; i < displayPoints.length; i += step) {
      markers.push({
        index: i,
        time: formatIstTime(displayPoints[i].timestamp),
        xPercent: (i / (displayPoints.length - 1)) * 100,
      });
    }
    return markers;
  }, [displayPoints]);

  return (
    <div className="card timeline-card">
      <div className="timeline-header">
        <div className="timeline-title-group">
          <span className="card-label">MARKET TIMELINE</span>
          <span className="timeline-subtitle">Price trajectory & regime state history</span>
        </div>

        <div className="horizon-toggle">
          <button
            type="button"
            className={`horizon-btn ${horizon === '24H' ? 'active' : ''}`}
            onClick={() => setHorizon('24H')}
          >
            24H
          </button>
          <button
            type="button"
            className={`horizon-btn ${horizon === '48H' ? 'active' : ''}`}
            onClick={() => setHorizon('48H')}
          >
            48H
          </button>
        </div>
      </div>

      <div
        className="timeline-canvas-wrap"
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="timeline-svg"
          preserveAspectRatio="none"
        >
          {/* Price curve */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--price-stroke)"
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {/* Regime bands at bottom */}
          {displayPoints.map((p, i) => {
            const barW = width / displayPoints.length;
            const x = i * barW;
            const colors = getRegimeColors(p.regime);
            return (
              <rect
                key={p.timestamp}
                x={x}
                y={height - 32}
                width={barW + 0.5}
                height={12}
                fill={colors.color}
                opacity={0.85}
              />
            );
          })}
        </svg>

        {/* Hover Crosshair & Minimal Tooltip */}
        {hoveredPoint && hoverPos && (
          <>
            <div
              className="crosshair-line"
              style={{ left: `${hoverPos.x}px` }}
            />
            <div
              className="minimal-tooltip font-mono"
              style={{
                left: `${hoverPos.tooltipLeft}px`,
                top: '12px',
              }}
            >
              <span className="tooltip-time">
                {formatIstTime(hoveredPoint.timestamp)} IST
              </span>
              <span className="tooltip-price">${formatPrice(hoveredPoint.price)}</span>
              <span
                className="tooltip-regime"
                style={{ color: getRegimeColors(hoveredPoint.regime).color }}
              >
                {hoveredPoint.regime}
              </span>
              <span className="tooltip-stat">Act {hoveredPoint.activityPercentile.toFixed(0)}</span>
              <span className="tooltip-stat">Pers {hoveredPoint.persistencePercentile.toFixed(0)}</span>
            </div>
          </>
        )}

        {/* Y-axis price labels */}
        <div className="price-axis font-mono">
          <span>${formatPrice(maxPrice)}</span>
          <span>${formatPrice(minPrice)}</span>
        </div>
      </div>

      {/* X-axis IST time markers */}
      <div className="time-axis font-mono">
        {timeMarkers.map((m) => (
          <span
            key={m.index}
            className="time-marker"
            style={{ left: `${m.xPercent}%` }}
          >
            {m.time}
          </span>
        ))}
      </div>

      <div className="regime-legend">
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: 'var(--color-trend)' }} />
          <span>Trend</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: 'var(--color-chop)' }} />
          <span>Chop</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: 'var(--color-grind)' }} />
          <span>Grind</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: 'var(--color-dead)' }} />
          <span>Dead</span>
        </div>
      </div>
    </div>
  );
};
