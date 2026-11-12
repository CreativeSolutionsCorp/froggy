export type MarketBar = {
  t?: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type PositionSizingInput = {
  accountSize: number;
  riskPercent: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
};

export type PositionSizingResult = {
  dollarRisk: number;
  shareCount: number;
  rewardToRisk: number;
};

export function calculateGapFromPriorClose(
  currentBar: MarketBar | undefined,
  previousBar: MarketBar | undefined,
): number {
  const current = currentBar ?? { o: 0, h: 0, l: 0, c: 0, v: 0 };
  const previous = previousBar ?? current;
  return current.o - previous.c;
}

export function calculateAverageTrueRange(bars: MarketBar[], periods: number = 14): number {
  if (bars.length < 2) {
    return 0;
  }

  const window = bars.slice(-Math.max(2, periods));
  if (window.length < 2) {
    return 0;
  }

  let total = 0;

  for (let index = 1; index < window.length; index += 1) {
    const previousBar = window[index - 1];
    const currentBar = window[index];

    if (!previousBar || !currentBar) {
      continue;
    }

    const trueRange = Math.max(
      currentBar.h - currentBar.l,
      Math.abs(currentBar.h - previousBar.c),
      Math.abs(currentBar.l - previousBar.c),
    );

    total += trueRange;
  }

  return total / (window.length - 1);
}

export function calculateRelativeVolume(
  bars: MarketBar[],
  periods: number = 20,
  overrideVolume?: number,
): { averageVolume: number; relativeVolume: number } {
  if (bars.length === 0) {
    return { averageVolume: 0, relativeVolume: 0 };
  }

  const window = bars.slice(-periods);
  const averageVolume = window.reduce((sum, bar) => sum + bar.v, 0) / window.length;
  const currentVolume = overrideVolume ?? bars[bars.length - 1]?.v ?? 0;

  return {
    averageVolume,
    relativeVolume: averageVolume === 0 ? 0 : currentVolume / averageVolume,
  };
}

export function calculateSma(values: number[], periods: number = 20): number {
  if (values.length === 0) {
    return 0;
  }

  const window = values.slice(-periods);
  if (window.length === 0) {
    return 0;
  }

  const total = window.reduce((sum, value) => sum + value, 0);
  return total / window.length;
}

export function calculateValueAtRisk(accountSize: number, riskPercent: number): number {
  if (!Number.isFinite(accountSize) || accountSize <= 0) {
    return 0;
  }

  if (!Number.isFinite(riskPercent) || riskPercent <= 0) {
    return 0;
  }

  return (accountSize * riskPercent) / 100;
}

export function calculatePivotLevels(bar: MarketBar): {
  pivot: number;
  r1: number;
  s1: number;
  r2: number;
  s2: number;
} {
  const pivot = (bar.h + bar.l + bar.c) / 3;
  const range = bar.h - bar.l;

  return {
    pivot,
    r1: 2 * pivot - bar.l,
    s1: 2 * pivot - bar.h,
    r2: pivot + range,
    s2: pivot - range,
  };
}

export function buildStopProposals(input: {
  entryPrice: number;
  priorDayLow: number;
  atr: number;
  supportLevels: number[];
}): Array<{ label: string; level: number }> {
  const priorDayLow = Number(input.priorDayLow);
  const entryPrice = Number(input.entryPrice);
  const atr = Number(input.atr);

  const candidates = [
    { label: 'Prior day low', level: priorDayLow },
    { label: '1 ATR below entry', level: entryPrice - atr },
    { label: 'Nearest support', level: input.supportLevels.reduce((best, level) => {
      if (level <= entryPrice) {
        return Math.abs(level - entryPrice) < Math.abs(best - entryPrice) ? level : best;
      }
      return best;
    }, input.supportLevels[0] ?? priorDayLow) },
  ];

  return candidates.map((candidate) => ({
    label: candidate.label,
    level: Number(candidate.level.toFixed(4)),
  }));
}

export function calculatePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const { accountSize, riskPercent, entryPrice, stopPrice, targetPrice } = input;

  if (!Number.isFinite(accountSize) || accountSize <= 0) {
    throw new Error('Account size must be positive.');
  }

  if (!Number.isFinite(riskPercent) || riskPercent <= 0) {
    throw new Error('Risk percent must be positive.');
  }

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error('Entry price must be positive.');
  }

  if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
    throw new Error('Stop price must be positive.');
  }

  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    throw new Error('Target price must be positive.');
  }

  if (stopPrice >= entryPrice) {
    throw new Error('stop price must be below the entry price for a long trade.');
  }

  const dollarRisk = calculateValueAtRisk(accountSize, riskPercent);
  const riskDistance = entryPrice - stopPrice;

  if (riskDistance <= 0) {
    throw new Error('Risk distance must be greater than zero.');
  }

  const shareCount = Math.floor(dollarRisk / riskDistance);
  const rewardDistance = targetPrice - entryPrice;

  if (rewardDistance <= 0) {
    throw new Error('Target price must be above the entry price for a long trade.');
  }

  return {
    dollarRisk,
    shareCount,
    rewardToRisk: rewardDistance / riskDistance,
  };
}
