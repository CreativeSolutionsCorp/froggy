export type BriefingSetup = {
  ticker: string;
  direction: 'long' | 'short';
  entryZone: { low: number; high: number };
  stopPrice: number;
  targets: number[];
  rewardToRisk: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
  dataPoints: string[];
  invalidationCondition: string;
};

export type BriefingRecord = {
  id: string;
  symbol: string;
  summary: string;
  disclaimer: string;
  setups: BriefingSetup[];
  timestamp: string;
};

export type BriefingApiResponse = {
  ok: true;
  summary: { symbol: string; timeframe: string; style: string; summary: string };
  model: { disclaimer: string; setups: BriefingSetup[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isValidBriefingSetup(value: unknown): value is BriefingSetup {
  if (!isRecord(value) || !isRecord(value.entryZone)) {
    return false;
  }

  const { entryZone } = value;
  return typeof value.ticker === 'string'
    && value.ticker.trim().length > 0
    && (value.direction === 'long' || value.direction === 'short')
    && isPositiveNumber(entryZone.low)
    && isPositiveNumber(entryZone.high)
    && entryZone.low <= entryZone.high
    && isPositiveNumber(value.stopPrice)
    && Array.isArray(value.targets)
    && value.targets.length > 0
    && value.targets.every(isPositiveNumber)
    && isPositiveNumber(value.rewardToRisk)
    && (value.confidence === 'low' || value.confidence === 'medium' || value.confidence === 'high')
    && typeof value.reasoning === 'string'
    && value.reasoning.trim().length > 0
    && Array.isArray(value.dataPoints)
    && value.dataPoints.length > 0
    && value.dataPoints.every((point) => typeof point === 'string' && point.trim().length > 0)
    && typeof value.invalidationCondition === 'string'
    && value.invalidationCondition.trim().length > 0;
}

export function isValidBriefingRecord(value: unknown): value is BriefingRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.symbol === 'string'
    && value.symbol.trim().length > 0
    && typeof value.summary === 'string'
    && value.summary.trim().length > 0
    && typeof value.disclaimer === 'string'
    && value.disclaimer.trim().length > 0
    && typeof value.timestamp === 'string'
    && Number.isFinite(new Date(value.timestamp).getTime())
    && Array.isArray(value.setups)
    && value.setups.length > 0
    && value.setups.every(isValidBriefingSetup);
}

export function isValidBriefingResponse(value: unknown): value is BriefingApiResponse {
  return isRecord(value)
    && value.ok === true
    && isRecord(value.summary)
    && typeof value.summary.symbol === 'string'
    && value.summary.symbol.trim().length > 0
    && typeof value.summary.timeframe === 'string'
    && typeof value.summary.style === 'string'
    && typeof value.summary.summary === 'string'
    && value.summary.summary.trim().length > 0
    && isRecord(value.model)
    && typeof value.model.disclaimer === 'string'
    && value.model.disclaimer.trim().length > 0
    && Array.isArray(value.model.setups)
    && value.model.setups.length > 0
    && value.model.setups.every(isValidBriefingSetup);
}