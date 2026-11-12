import request from 'supertest';
import { createRateLimiter, createServer, sanitizeSymbol, validateBriefingRequest, validateCoachingRequest, buildRiskSummary, isAuthorized, healthCheck } from '../src/index';

describe('server health', () => {
  it('returns an ok status', () => {
    expect(healthCheck()).toEqual({ ok: true });
  });
});

describe('market proxy helpers', () => {
  it('normalizes symbols', () => {
    expect(sanitizeSymbol(' aapl ')).toBe('AAPL');
  });

  it('validates brief request payloads', () => {
    const payload = validateBriefingRequest({
      symbol: ' aapl ',
      timeframe: '1D',
      notes: 'Bullish breakout',
      style: 'concise',
    });

    expect(payload).toMatchObject({
      symbol: 'AAPL',
      timeframe: '1D',
      style: 'concise',
      notes: 'Bullish breakout',
    });
  });

  it('validates coaching payloads', () => {
    const payload = validateCoachingRequest({
      symbol: 'msft',
      price: 420.5,
      threshold: 15,
      scenario: 'bullish',
      notes: 'Momentum is strong',
    });

    expect(payload).toMatchObject({
      symbol: 'MSFT',
      price: 420.5,
      threshold: 15,
      scenario: 'bullish',
    });
  });

  it('builds a risk summary', () => {
    const summary = buildRiskSummary({
      volatility: 0.4,
      drawdown: 0.18,
      liquidity: 0.85,
      conviction: 0.65,
    });

    expect(summary.score).toBeGreaterThanOrEqual(0);
    expect(summary.score).toBeLessThanOrEqual(100);
    expect(['low', 'moderate', 'high']).toContain(summary.band);
  });

  it('checks shared-token authorization', () => {
    expect(isAuthorized({ 'x-shared-app-token': 'alpha' }, 'alpha')).toBe(true);
    expect(isAuthorized({ authorization: 'Bearer beta' }, 'alpha')).toBe(false);
  });

  it('enforces per-window rate limiting', () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60000 });
    const state = { ip: '127.0.0.1' } as const;

    expect(limiter(state.ip)).toBe(true);
    expect(limiter(state.ip)).toBe(true);
    expect(limiter(state.ip)).toBe(false);
  });
});

describe('api endpoints', () => {
  it('requires a valid shared token', async () => {
    const app = createServer({ sharedAppToken: 'secret' });

    const response = await request(app).get('/health').set('x-shared-app-token', 'wrong');

    expect(response.status).toBe(401);
  });

  it('serves a briefing payload', async () => {
    const app = createServer({ sharedAppToken: 'secret' });

    const response = await request(app)
      .post('/api/briefing')
      .set('x-shared-app-token', 'secret')
      .send({
        symbol: 'nvda',
        timeframe: '1D',
        asks: [
          {
            label: 'Trend',
            value: 'Bullish',
          },
        ],
        notes: 'Strong momentum',
        style: 'concise',
      });

    expect(response.status).toBe(200);
    expect(response.body.summary).toBeDefined();
    expect(response.body.summary.symbol).toBe('NVDA');
  });
});
