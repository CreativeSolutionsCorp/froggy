import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRateLimiter, createServer, sanitizeSymbol, validateBriefingRequest, validateCoachingRequest, buildRiskSummary, isAuthorized, healthCheck, logStartupEnvironment, type ServerDependencies } from '../src/index';
import { PolygonClientError } from '../src/polygon-client';
import { AnthropicOutputError } from '../src/anthropic-client';

const validBriefingOutput: unknown = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'briefing-response.json'), 'utf8'));
const previousDayBar = { T: 'AAPL', o: 100, h: 105, l: 98, c: 103, v: 900, t: 1_731_000_000_000 };

function createBriefingApp(options: {
  polygonError?: Error;
  anthropicError?: Error;
  modelOutput?: unknown;
} = {}) {
  const polygonClient = {
    getPreviousDayBar: jest.fn().mockImplementation(() => (
      options.polygonError ? Promise.reject(options.polygonError) : Promise.resolve(previousDayBar)
    )),
  };
  const anthropicClient = {
    generateBriefing: jest.fn().mockImplementation(() => (
      options.anthropicError ? Promise.reject(options.anthropicError) : Promise.resolve(options.modelOutput ?? validBriefingOutput)
    )),
    generateCoach: jest.fn(),
  };
  const dependencies = {
    polygonClient: polygonClient as unknown as NonNullable<ServerDependencies['polygonClient']>,
    anthropicClient: anthropicClient as unknown as NonNullable<ServerDependencies['anthropicClient']>,
  };
  return {
    app: createServer({ sharedAppToken: 'secret', polygonApiKey: 'test-polygon-key', anthropicApiKey: 'test-anthropic-key' }, dependencies),
    polygonClient,
    anthropicClient,
  };
}

const validBriefingRequest = {
  symbol: 'AAPL',
  timeframe: '1D',
  asks: [],
  style: 'balanced',
};

describe('server health', () => {
  it('returns an ok status', () => {
    expect(healthCheck()).toEqual({ ok: true });
  });

  it('logs only yes/no for required credentials', () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    logStartupEnvironment({
      polygonApiKey: 'polygon-secret',
      anthropicApiKey: '',
      sharedAppToken: 'app-secret',
    });

    expect(log.mock.calls).toEqual([
      ['POLYGON_API_KEY: yes'],
      ['ANTHROPIC_API_KEY: no'],
      ['SHARED_APP_TOKEN: yes'],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    log.mockRestore();
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
    const { app, polygonClient, anthropicClient } = createBriefingApp();

    const response = await request(app)
      .post('/api/briefing')
      .set('x-shared-app-token', 'secret')
      .send(validBriefingRequest);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      summary: { symbol: 'AAPL' },
      marketData: { provider: 'Polygon', close: 103 },
      source: 'polygon+anthropic',
    });
    expect(response.body.model.setups[0].dataPoints).toContain('close=103');
    expect(response.body.risk).toEqual({ notes: (validBriefingOutput as { risks: string[] }).risks });
    expect(response.body.marketData.volume).toBeGreaterThan(0);
    expect(polygonClient.getPreviousDayBar).toHaveBeenCalledWith('AAPL');
    expect(anthropicClient.generateBriefing).toHaveBeenCalledTimes(1);
    expect(anthropicClient.generateBriefing.mock.calls[0]?.[0].prompt).toContain('close: 103');
  });

  it('returns MISSING_KEY when a required provider key is absent', async () => {
    const app = createServer({ sharedAppToken: 'secret', polygonApiKey: '', anthropicApiKey: '' });
    const response = await request(app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('MISSING_KEY');
    expect(response.body.error).toContain('POLYGON_API_KEY');
  });

  it('maps Polygon authentication and plan errors to stable codes', async () => {
    const auth = createBriefingApp({ polygonError: new PolygonClientError('unauthorized', 'authentication', 401) });
    const plan = createBriefingApp({ polygonError: new PolygonClientError('forbidden', 'plan_restricted', 403) });

    const authResponse = await request(auth.app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);
    const planResponse = await request(plan.app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);

    expect(authResponse.body.code).toBe('POLYGON_AUTH');
    expect(planResponse.body.code).toBe('POLYGON_PLAN');
  });

  it('maps Anthropic authentication errors to a stable code', async () => {
    const { app } = createBriefingApp({ anthropicError: Object.assign(new Error('unauthorized'), { status: 401 }) });
    const response = await request(app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('ANTHROPIC_AUTH');
  });

  it('maps malformed Claude text to MODEL_OUTPUT_INVALID', async () => {
    const { app } = createBriefingApp({ anthropicError: new AnthropicOutputError('Anthropic output could not be parsed as JSON.') });
    const response = await request(app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('MODEL_OUTPUT_INVALID');
  });

  it('rejects invalid model levels and empty setups', async () => {
    const zeroLevel = createBriefingApp({
      modelOutput: {
        ...(validBriefingOutput as object),
        setups: [{ ...((validBriefingOutput as { setups: object[] }).setups[0]), stopPrice: 0 }],
      },
    });
    const emptySetups = createBriefingApp({
      modelOutput: { ...(validBriefingOutput as object), setups: [] },
    });

    const zeroResponse = await request(zeroLevel.app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);
    const emptyResponse = await request(emptySetups.app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);

    expect(zeroResponse.body.code).toBe('MODEL_OUTPUT_INVALID');
    expect(emptyResponse.body.code).toBe('MODEL_OUTPUT_INVALID');
    expect(zeroResponse.status).toBe(502);
  });

  it('does not expose provider error details on failed calls', async () => {
    const { app } = createBriefingApp({ anthropicError: Object.assign(new Error('invalid x-api-key secret-value'), { status: 401 }) });
    const response = await request(app).post('/api/briefing').set('x-shared-app-token', 'secret').send(validBriefingRequest);

    expect(response.body.error).not.toContain('secret-value');
    expect(response.body.error).toContain('ANTHROPIC_API_KEY');
  });
});
