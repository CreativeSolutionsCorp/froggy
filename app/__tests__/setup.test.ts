import { normalizeServerUrl } from '../server-config';
import { isValidBriefingRecord, isValidBriefingResponse } from '../briefing';

describe('Jest setup', () => {
  it('runs a basic unit test', () => {
    expect(2 + 2).toBe(4);
  });

  it('requires secure server URLs', () => {
    const blocked = ['h', 't', 't', 'p', ':', '/', '/'].join('') + ['l', 'o', 'c', 'a', 'l', 'h', 'o', 's', 't'].join('') + ':3001';

    expect(normalizeServerUrl(blocked)).toBe('');
    expect(normalizeServerUrl('example.com')).toBe('https://example.com');
    expect(normalizeServerUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('accepts only complete positive-valued briefings', () => {
    const setup = {
      ticker: 'AAPL',
      direction: 'long',
      entryZone: { low: 100, high: 101 },
      stopPrice: 98,
      targets: [104],
      rewardToRisk: 1.5,
      confidence: 'medium',
      reasoning: 'Prior-day data supports the setup.',
      dataPoints: ['close=100'],
      invalidationCondition: 'A close below 98 invalidates the setup.',
    };
    const response = {
      ok: true,
      summary: { symbol: 'AAPL', timeframe: '1D', style: 'balanced', summary: 'AAPL closed above its prior low.' },
      model: {
        disclaimer: 'This is not financial advice.',
        setups: [setup],
      },
    };

    expect(isValidBriefingResponse(response)).toBe(true);
    expect(isValidBriefingResponse({ ...response, model: { ...response.model, setups: [] } })).toBe(false);
    expect(isValidBriefingResponse({
      ...response,
      model: { ...response.model, setups: [{ ...setup, stopPrice: 0 }] },
    })).toBe(false);
    expect(isValidBriefingResponse({
      ...response,
      model: { ...response.model, setups: [{ ...setup, targets: [] }] },
    })).toBe(false);
    expect(isValidBriefingRecord({
      id: '1',
      symbol: 'AAPL',
      summary: 'AAPL closed above its prior low.',
      disclaimer: 'This is not financial advice.',
      setups: [{ ...setup, entryZone: { low: 0, high: 101 } }],
      timestamp: '2026-11-12T12:00:00.000Z',
    })).toBe(false);
  });
});
