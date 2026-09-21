import { Interval } from './market';

export interface RegimeSpec {
  version: number;
  activityHigh: number;
  persistenceHigh: number;
  trendPersistenceExtended: number;
  trendActivityFloor: number;
  labels?: {
    trend: string;
    chop: string;
    grind: string;
    dead: string;
  };
}

export interface HourBaseline {
  range: number[];
  persistence: number[];
  samples: number;
}

export interface BaselineTimeframe {
  lookback: number;
  label: string;
  hourBaselines: Record<string, HourBaseline>;
}

export interface StudyOutcome {
  name: string;
  samples: number;
  mfeR: number;
  maeR: number;
  ratio: number;
  hit2R: number;
  medianOutcomeR: number;
}

export interface BaselineArtifact {
  generatedAt: string;
  dataStart: string;
  dataEnd: string;
  symbol: string;
  regimeSpec: RegimeSpec;
  timeframes: Record<Interval, BaselineTimeframe>;
  fitEnd: string;
  sessions?: StudyOutcome[];
  weekdays?: StudyOutcome[];
  oosLabels?: Record<string, number>;
}

export interface DowSummary {
  dow_ist: number;
  dow_name: string;
  trades: number;
  win_rate: number;
  pf: number;
  exp_r: number;
  total_return: number;
}

export interface HourlySummary {
  hour_ist: number;
  hour_label: string;
  trades: number;
  win_rate: number;
  pf: number;
  exp_r: number;
}

export interface MatrixSlot {
  dow_ist: number;
  dow_name: string;
  hour_ist: number;
  hour_label: string;
  chop_pct: number;
  momo_pct: number;
  avg_range_bp: number;
  trades: number;
  win_rate: number;
  pf: number;
  exp_r: number;
  classification: string;
}

export interface ScheduleArtifact {
  generated_at: string;
  timezone: string;
  data_period: string;
  dow_summary: DowSummary[];
  hourly_summary: HourlySummary[];
  matrix_168: MatrixSlot[];
}
