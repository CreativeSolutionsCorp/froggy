import { calculateAtr, calculateGapFromPriorClose, calculatePivotLevels, calculatePreviousClose, calculateRelativeVolume, calculateSma, getPriorDayRange } from '../src/market-math';
import { calculatePositionSizing, calculateStopLossLevels } from '../src/position-sizing';

const baseBars = [
  { t: 1, o: 100, h: 101, l: 99, c: 100, v: 1000 },
  { t: 2, o: 101, h: 102, l: 100, c: 101, v: 1200 },
  { t: 3, o: 101, h: 103, l: 100, c: 102, v: 1100 },
  { t: 4, o: 102, h: 104, l: 101, c: 103, v: 1300 },
  { t: 5, o: 103, h: 105, l: 102, c: 104, v: 1400 },
  { t: 6, o: 104, h: 105, l: 103, c: 105, v: 1500 },
  { t: 7, o: 105, h: 106, l: 104, c: 106, v: 1600 },
  { t: 8, o: 106, h: 108, l: 105, c: 107, v: 1700 },
  { t: 9, o: 107, h: 109, l: 106, c: 108, v: 1800 },
  { t: 10, o: 108, h: 110, l: 107, c: 109, v: 2000 },
  { t: 11, o: 109, h: 110, l: 108, c: 110, v: 2100 },
  { t: 12, o: 110, h: 111, l: 108, c: 109, v: 1900 },
  { t: 13, o: 109, h: 111, l: 108, c: 110, v: 2200 },
  { t: 14, o: 110, h: 112, l: 109, c: 111, v: 2300 },
  { t: 15, o: 111, h: 112, l: 110, c: 112, v: 2500 },
  { t: 16, o: 112, h: 113, l: 111, c: 113, v: 2600 },
  { t: 17, o: 113, h: 114, l: 112, c: 114, v: 2700 },
  { t: 18, o: 114, h: 115, l: 113, c: 115, v: 2800 },
  { t: 19, o: 115, h: 116, l: 114, c: 116, v: 2900 },
  { t: 20, o: 116, h: 117, l: 115, c: 117, v: 3000 },
];

describe('market math', () => {
  it('calculates previous close, gap, ATR, average volume, relative volume, prior range, pivot, and SMA values', () => {
    expect(calculatePreviousClose(baseBars)).toBe(116);
    expect(calculateGapFromPriorClose(baseBars)).toBe(0);
    expect(calculateAtr(baseBars, 14)).toBeCloseTo(2.4615, 4);
    expect(calculateSma(baseBars.map((bar) => bar.c), 20)).toBeCloseTo(108.6, 2);
    expect(calculateSma(baseBars.map((bar) => bar.c), 50)).toBeCloseTo(108.6, 2);
    expect(calculateRelativeVolume(baseBars, 20)).toBeCloseTo(1.5152, 4);
    expect(getPriorDayRange(baseBars)).toEqual({ high: 117, low: 115 });
    expect(calculatePivotLevels(baseBars)).toMatchObject({ pivot: 116, r1: 117, s1: 115 });
  });

  it('handles edge cases', () => {
    expect(calculateAtr([{ t: 1, o: 10, h: 11, l: 9, c: 10, v: 0 }], 14)).toBe(0);
    expect(calculateRelativeVolume([{ t: 1, o: 10, h: 10, l: 10, c: 10, v: 0 }], 20)).toBe(0);
    expect(calculateSma([10, 11, 12], 14)).toBeCloseTo(11, 6);
  });

  it('computes position sizing and stop-loss candidates', () => {
    const sizing = calculatePositionSizing({ accountSize: 100000, riskPercent: 1, entryPrice: 100, stopPrice: 98, targetPrice: 104 });
    expect(sizing.dollarRisk).toBe(1000);
    expect(sizing.shareCount).toBe(500);
    expect(sizing.rewardToRisk).toBe(2);

    expect(() => calculatePositionSizing({ accountSize: 100000, riskPercent: 1, entryPrice: 100, stopPrice: 102, targetPrice: 104 })).toThrow();

    const stops = calculateStopLossLevels({
      priorDayLow: 98,
      entryPrice: 100,
      atr: 2,
      supportLevels: [98.5, 99.2, 99.8],
    });

    expect(stops).toEqual([
      { label: 'prior-day-low', price: 98 },
      { label: 'atr', price: 98 },
      { label: 'nearest-support', price: 99.8 },
    ]);
  });
});
