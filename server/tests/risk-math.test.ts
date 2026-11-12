import {
  calculateAverageTrueRange,
  calculateGapFromPriorClose,
  calculatePivotLevels,
  calculateRelativeVolume,
  calculateSma,
  calculateValueAtRisk,
  buildStopProposals,
  calculatePositionSizing,
  type MarketBar,
} from '../src/risk-math';

describe('risk math', () => {
  const bars: MarketBar[] = [
    { o: 100, h: 110, l: 95, c: 105, v: 1200 },
    { o: 105, h: 108, l: 96, c: 101, v: 1800 },
    { o: 101, h: 104, l: 97, c: 102, v: 1500 },
    { o: 102, h: 109, l: 98, c: 108, v: 2200 },
    { o: 108, h: 112, l: 104, c: 110, v: 1400 },
  ];

  it('calculates gap from prior close to open', () => {
    const barOne = bars[1] ?? bars[0];
    const barTwo = bars[2] ?? bars[0];
    const previousOne = bars[0] ?? barOne;
    const previousTwo = bars[1] ?? barTwo;

    expect(calculateGapFromPriorClose(barOne, previousOne)).toBeCloseTo(0);
    expect(calculateGapFromPriorClose(barTwo, previousTwo)).toBeCloseTo(0);
  });

  it('calculates average true range over 14 sessions', () => {
    const atr = calculateAverageTrueRange([
      { o: 100, h: 110, l: 90, c: 105, v: 1000 },
      { o: 105, h: 112, l: 96, c: 108, v: 1000 },
      { o: 108, h: 113, l: 100, c: 110, v: 1000 },
    ]);

    expect(atr).toBeCloseTo(14.5, 8);
  });

  it('calculates 20-session average volume and relative volume', () => {
    const barFour = bars[4] ?? bars[bars.length - 1];
    const volumeStats = calculateRelativeVolume(bars, 20, barFour?.v ?? 0);

    expect(volumeStats.averageVolume).toBeCloseTo(1620, 5);
    expect(volumeStats.relativeVolume).toBeCloseTo(0.8641975309, 8);
  });

  it('calculates pivot levels and SMA values', () => {
    const pivot = calculatePivotLevels({ o: 100, h: 110, l: 95, c: 105, v: 1200 });
    expect(pivot.pivot).toBeCloseTo(103.3333333333, 8);
    expect(pivot.s1).toBeCloseTo(96.6666666667, 8);
    expect(pivot.r1).toBeCloseTo(111.6666666667, 8);

    const sma20 = calculateSma(bars.map((bar) => bar.c), 20);
    expect(sma20).toBeCloseTo(105.2, 8);
  });

  it('calculates value at risk and position sizing', () => {
    const sizing = calculatePositionSizing({
      accountSize: 10000,
      riskPercent: 1,
      entryPrice: 100,
      stopPrice: 95,
      targetPrice: 110,
    });

    expect(sizing.dollarRisk).toBeCloseTo(100, 8);
    expect(sizing.shareCount).toBe(20);
    expect(sizing.rewardToRisk).toBeCloseTo(2, 8);

    expect(() =>
      calculatePositionSizing({
        accountSize: 10000,
        riskPercent: 1,
        entryPrice: 100,
        stopPrice: 110,
        targetPrice: 110,
      }),
    ).toThrow('stop price');
  });

  it('builds stop proposals from prior low, ATR, and support', () => {
    const proposals = buildStopProposals({
      entryPrice: 102,
      priorDayLow: 96,
      atr: 4,
      supportLevels: [94, 91, 89],
    });

    expect(proposals).toEqual([
      { label: 'Prior day low', level: 96 },
      { label: '1 ATR below entry', level: 98 },
      { label: 'Nearest support', level: 94 },
    ]);
  });

  it('handles flat prices and zero volume without crashing', () => {
    const zeroVolume = calculateRelativeVolume(
      [
        { o: 100, h: 100, l: 100, c: 100, v: 0 },
        { o: 100, h: 100, l: 100, c: 100, v: 0 },
      ],
      20,
      0,
    );

    expect(zeroVolume.averageVolume).toBe(0);
    expect(zeroVolume.relativeVolume).toBe(0);
    expect(calculateValueAtRisk(1000, 0)).toBe(0);
  });
});
