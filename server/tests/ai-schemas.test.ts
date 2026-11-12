import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { briefResponseSchema, coachResponseSchema, validateModelOutput, buildBriefingPrompt, buildCoachPrompt } from '../src/ai';

describe('AI schema validation', () => {
  it('validates a briefing fixture and prompt builder output', () => {
    const fixturePath = join(__dirname, 'fixtures', 'briefing-response.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const parsed = briefResponseSchema.parse(fixture);

    expect(parsed.setups.length).toBeLessThanOrEqual(5);
    expect(parsed.disclaimer).toContain('not financial advice');

    const prompt = buildBriefingPrompt({ symbol: 'AAPL', timeframe: '1D', notes: 'Momentum is steady', data: [{ label: 'Close', value: '214.50' }] });
    expect(prompt).toContain('AAPL');
    expect(prompt).toContain('insufficient data');
  });

  it('validates a coach fixture and prompt builder output', () => {
    const fixturePath = join(__dirname, 'fixtures', 'coach-response.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const parsed = coachResponseSchema.parse(fixture);

    expect(parsed.headline).toBeTruthy();
    expect(parsed.disclaimer).toContain('not financial advice');

    const prompt = buildCoachPrompt({ symbol: 'MSFT', quote: { last: 423.2, bid: 423.1, ask: 423.3, timestamp: '2026-11-12T16:00:00Z' }, dataQuality: 'live' });
    expect(prompt).toContain('MSFT');
    expect(prompt).toContain('insufficient data');
  });

  it('rejects invalid data and surfaces validation errors', () => {
    expect(() => validateModelOutput({ bad: 'value' }, briefResponseSchema)).toThrow();
  });
});
