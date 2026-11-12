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

export function calculatePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const { accountSize, riskPercent, entryPrice, stopPrice, targetPrice } = input;

  if (!Number.isFinite(accountSize) || accountSize <= 0) {
    throw new Error('Account size must be a positive number.');
  }

  if (!Number.isFinite(riskPercent) || riskPercent <= 0) {
    throw new Error('Risk percent must be a positive number.');
  }

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error('Entry price must be a positive number.');
  }

  if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
    throw new Error('Stop price must be a positive number.');
  }

  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    throw new Error('Target price must be a positive number.');
  }

  if (stopPrice >= entryPrice) {
    throw new Error('Stop price must be below the entry price for a long trade.');
  }

  const riskDistance = entryPrice - stopPrice;
  if (riskDistance <= 0) {
    throw new Error('Risk distance must be greater than zero.');
  }

  const dollarRisk = (accountSize * riskPercent) / 100;
  const shareCount = Math.floor(dollarRisk / riskDistance);
  const rewardDistance = targetPrice - entryPrice;

  if (rewardDistance <= 0) {
    throw new Error('Target price must be above the entry price for a long trade.');
  }

  return {
    dollarRisk,
    shareCount,
    rewardToRisk: Number((rewardDistance / riskDistance).toFixed(4)),
  };
}

export type StopLossCandidate = {
  label: 'prior-day-low' | 'atr' | 'nearest-support';
  price: number;
};

export function calculateStopLossLevels(input: {
  priorDayLow: number;
  entryPrice: number;
  atr: number;
  supportLevels: number[];
}): StopLossCandidate[] {
  const { priorDayLow, entryPrice, atr, supportLevels } = input;

  if (!Number.isFinite(priorDayLow) || priorDayLow <= 0) {
    throw new Error('Prior-day low must be positive.');
  }

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error('Entry price must be positive.');
  }

  if (!Number.isFinite(atr) || atr <= 0) {
    throw new Error('ATR must be positive.');
  }

  const atrStop = entryPrice - atr;
  const supportList = supportLevels.filter((level) => Number.isFinite(level) && level > 0);
  let nearestSupport = priorDayLow;

  if (supportList.length > 0) {
    const initialSupport = supportList[0];
    if (initialSupport) {
      nearestSupport = supportList.reduce((best, current) => {
        const bestGap = Math.abs(best - entryPrice);
        const currentGap = Math.abs(current - entryPrice);
        return currentGap < bestGap ? current : best;
      }, initialSupport);
    }
  }

  const candidates: StopLossCandidate[] = [
    { label: 'prior-day-low', price: priorDayLow },
    { label: 'atr', price: atrStop },
    { label: 'nearest-support', price: nearestSupport },
  ];

  return candidates.map((candidate) => ({
    ...candidate,
    price: Number(candidate.price.toFixed(4)),
  }));
}
