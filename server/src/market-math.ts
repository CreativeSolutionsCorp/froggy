export type OhlcvBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export function calculatePreviousClose(bars: OhlcvBar[]): number {
  if (bars.length === 0) {
    return 0;
  }

  const firstBar = bars[0];
  if (!firstBar) {
    return 0;
  }

  if (bars.length === 1) {
    return firstBar.c;
  }

  const previousBar = bars[Math.max(0, bars.length - 2)];
  return previousBar ? previousBar.c : firstBar.c;
}

export function calculateGapFromPriorClose(bars: OhlcvBar[]): number {
  if (bars.length < 2) {
    return 0;
  }

  const previousClose = calculatePreviousClose(bars);
  const latestBar = bars[bars.length - 1];
  return latestBar ? latestBar.o - previousClose : 0;
}

export function calculateAtr(bars: OhlcvBar[], periods: number = 14): number {
  if (bars.length < 2) {
    return 0;
  }

  const window = bars.slice(-Math.max(2, periods));
  if (window.length < 2) {
    return 0;
  }

  let totalTrueRange = 0;

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

    totalTrueRange += trueRange;
  }

  return Number((totalTrueRange / (window.length - 1)).toFixed(4));
}

export function calculateAverageVolume(bars: OhlcvBar[], periods: number = 20): number {
  if (bars.length === 0) {
    return 0;
  }

  const window = bars.slice(-periods);
  const totalVolume = window.reduce((sum, bar) => sum + bar.v, 0);
  return totalVolume / window.length;
}

export function calculateRelativeVolume(bars: OhlcvBar[], periods: number = 20): number {
  if (bars.length === 0) {
    return 0;
  }

  const window = bars.slice(-periods);
  const averageVolume = calculateAverageVolume(window, window.length);
  const latestBar = bars[bars.length - 1];
  const currentVolume = latestBar ? latestBar.v : 0;

  if (averageVolume === 0) {
    return 0;
  }

  return Number((currentVolume / averageVolume).toFixed(4));
}

export function getPriorDayRange(bars: OhlcvBar[]): { high: number; low: number } {
  if (bars.length === 0) {
    return { high: 0, low: 0 };
  }

  const lastBar = bars[bars.length - 1];
  if (!lastBar) {
    return { high: 0, low: 0 };
  }

  return { high: lastBar.h, low: lastBar.l };
}

export function calculatePivotLevels(bars: OhlcvBar[]): { pivot: number; r1: number; s1: number } {
  if (bars.length === 0) {
    return { pivot: 0, r1: 0, s1: 0 };
  }

  const lastBar = bars[bars.length - 1];
  if (!lastBar) {
    return { pivot: 0, r1: 0, s1: 0 };
  }

  const pivot = Math.round((lastBar.h + lastBar.l + lastBar.c) / 3);
  const r1 = 2 * pivot - lastBar.l;
  const s1 = 2 * pivot - lastBar.h;

  return {
    pivot,
    r1: Math.round(r1),
    s1: Math.round(s1),
  };
}

export function calculateSma(values: number[], periods: number = 20): number {
  if (values.length === 0) {
    return 0;
  }

  const window = values.slice(-periods);
  const total = window.reduce((sum, value) => sum + value, 0);
  return total / window.length;
}
