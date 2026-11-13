import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { briefResponseSchema, buildBriefingPrompt, buildCoachPrompt, coachResponseSchema, validateModelOutput } from './ai';
import { AnthropicOutputError, createAnthropicClient } from './anthropic-client';
import { createPolygonClient, PolygonClientError, type PolygonBar } from './polygon-client';

export type BriefingAsk = {
  label: string;
  value: string;
};

export type BriefingRequest = {
  symbol: string;
  timeframe: string;
  asks: BriefingAsk[];
  notes?: string;
  style: 'concise' | 'balanced' | 'detailed';
};

export type CoachingRequest = {
  symbol: string;
  price: number;
  threshold: number;
  scenario: 'bullish' | 'bearish' | 'neutral';
  notes?: string;
  imageBase64?: string;
};

export type RiskInputs = {
  volatility: number;
  drawdown: number;
  liquidity: number;
  conviction: number;
};

export type ServerEnvironment = {
  port: number;
  sharedAppToken: string;
  polygonApiKey: string;
  anthropicApiKey: string;
  rateLimitWindowMs: number;
  maxRequests: number;
};

export type ServerDependencies = {
  polygonClient?: ReturnType<typeof createPolygonClient>;
  anthropicClient?: ReturnType<typeof createAnthropicClient>;
};

const VALID_TIMEFRAMES = new Set(['1D', '1W', '1M', '3M', '1Y', 'MAX']);
const VALID_SCENARIOS = new Set(['bullish', 'bearish', 'neutral']);
const VALID_STYLES = new Set(['concise', 'balanced', 'detailed']);

export function healthCheck(): { ok: boolean } {
  return { ok: true };
}

export function sanitizeSymbol(value: unknown): string {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return raw.replace(/[^A-Za-z0-9.-]/g, '').trim().toUpperCase();
}

function sanitizeText(value: unknown, maxLength = 500): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getHeaderValue(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const direct = headers[key] ?? headers[key.toLowerCase()];

  if (Array.isArray(direct)) {
    return direct[0];
  }

  return typeof direct === 'string' ? direct : undefined;
}

export function isAuthorized(headers: Record<string, string | string[] | undefined>, token: string): boolean {
  const expected = token.trim();

  if (!expected) {
    return true;
  }

  const rawHeader = getHeaderValue(headers, 'x-shared-app-token') ?? getHeaderValue(headers, 'authorization');

  if (!rawHeader) {
    return false;
  }

  const candidate = rawHeader.startsWith('Bearer ') ? rawHeader.slice(7).trim() : rawHeader.trim();
  return candidate === expected;
}

export function createRateLimiter(options: { maxRequests?: number; windowMs?: number } = {}): (key: string) => boolean {
  const maxRequests = options.maxRequests ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const hits = new Map<string, number[]>();

  return (key: string): boolean => {
    const normalizedKey = String(key || 'anonymous');
    const now = Date.now();
    const recentHits = (hits.get(normalizedKey) ?? []).filter((timestamp) => now - timestamp < windowMs);

    if (recentHits.length >= maxRequests) {
      hits.set(normalizedKey, recentHits);
      return false;
    }

    recentHits.push(now);
    hits.set(normalizedKey, recentHits);
    return true;
  };
}

export function validateBriefingRequest(input: unknown): BriefingRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Briefing payload must be an object.');
  }

  const body = input as Record<string, unknown>;
  const symbol = sanitizeSymbol(body.symbol);

  if (!symbol) {
    throw new Error('A valid symbol is required.');
  }

  const timeframeValue = typeof body.timeframe === 'string' ? body.timeframe.trim().toUpperCase() : '1D';
  const timeframe = VALID_TIMEFRAMES.has(timeframeValue) ? timeframeValue : '1D';

  const styleValue = typeof body.style === 'string' ? body.style.trim().toLowerCase() : 'balanced';
  const style = VALID_STYLES.has(styleValue) ? (styleValue as BriefingRequest['style']) : 'balanced';

  const asks = Array.isArray(body.asks)
    ? body.asks.map((ask, index) => {
        if (!ask || typeof ask !== 'object') {
          throw new Error(`Ask at index ${index} must be an object.`);
        }

        const item = ask as Record<string, unknown>;
        const label = sanitizeText(item.label, 60) || `Metric ${index + 1}`;
        const value = sanitizeText(item.value, 200) || 'n/a';

        return { label, value } satisfies BriefingAsk;
      })
    : [];

  const notes = sanitizeText(body.notes, 800);
  const result: BriefingRequest = {
    symbol,
    timeframe,
    asks,
    style,
  };

  if (notes) {
    result.notes = notes;
  }

  return result;
}

export function validateCoachingRequest(input: unknown): CoachingRequest {
  if (!input || typeof input !== 'object') {
    throw new Error('Coaching payload must be an object.');
  }

  const body = input as Record<string, unknown>;
  const symbol = sanitizeSymbol(body.symbol);

  if (!symbol) {
    throw new Error('A valid symbol is required.');
  }

  const price = Number(body.price);
  const threshold = Number(body.threshold);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('A positive numeric price is required.');
  }

  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('A positive numeric threshold is required.');
  }

  const scenario = typeof body.scenario === 'string' ? body.scenario.trim().toLowerCase() : 'neutral';
  if (!VALID_SCENARIOS.has(scenario)) {
    throw new Error('Scenario must be bullish, bearish, or neutral.');
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined;
  if (imageBase64 && imageBase64.length > 1_000_000) {
    throw new Error('Image payload exceeds the 1MB limit.');
  }

  const notes = sanitizeText(body.notes, 800);
  const result: CoachingRequest = {
    symbol,
    price,
    threshold,
    scenario: scenario as CoachingRequest['scenario'],
  };

  if (notes) {
    result.notes = notes;
  }

  if (imageBase64) {
    result.imageBase64 = imageBase64;
  }

  return result;
}

export function buildRiskSummary(inputs: RiskInputs): {
  score: number;
  band: 'low' | 'moderate' | 'high';
  notes: string[];
} {
  const volatility = clamp(Number(inputs.volatility ?? 0), 0, 1);
  const drawdown = clamp(Number(inputs.drawdown ?? 0), 0, 1);
  const liquidity = clamp(Number(inputs.liquidity ?? 0), 0, 1);
  const conviction = clamp(Number(inputs.conviction ?? 0), 0, 1);

  const score = Math.round(
    volatility * 35 +
      drawdown * 30 +
      (1 - liquidity) * 20 +
      (1 - conviction) * 15,
  );

  const band: 'low' | 'moderate' | 'high' = score < 35 ? 'low' : score < 70 ? 'moderate' : 'high';

  return {
    score: clamp(score, 0, 100),
    band,
    notes: [
      volatility > 0.6 ? 'Volatility is elevated.' : 'Volatility remains manageable.',
      drawdown > 0.25 ? 'Drawdown risk is elevated.' : 'Drawdown risk is acceptable.',
      liquidity > 0.7 ? 'Liquidity is healthy.' : 'Liquidity is thin and should be monitored.',
    ],
  };
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function isValidPolygonBar(bar: PolygonBar): boolean {
  return [bar.o, bar.h, bar.l, bar.c].every((value) => Number.isFinite(value) && value > 0)
    && bar.h >= Math.max(bar.o, bar.c, bar.l)
    && bar.l <= Math.min(bar.o, bar.c, bar.h)
    && Number.isFinite(bar.v)
    && bar.v > 0
    && typeof bar.t === 'number'
    && Number.isFinite(bar.t)
    && Number.isFinite(new Date(bar.t).getTime());
}

function sendBriefingError(res: Response, status: number, code: string, error: string): void {
  res.status(status).json({ ok: false, code, error });
}

export function logStartupEnvironment(env: Partial<ServerEnvironment> = {}): void {
  console.info(`POLYGON_API_KEY: ${(env.polygonApiKey ?? process.env.POLYGON_API_KEY ?? '').trim() ? 'yes' : 'no'}`);
  console.info(`ANTHROPIC_API_KEY: ${(env.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '').trim() ? 'yes' : 'no'}`);
  console.info(`SHARED_APP_TOKEN: ${(env.sharedAppToken ?? process.env.SHARED_APP_TOKEN ?? '').trim() ? 'yes' : 'no'}`);
}

export function createServer(env: Partial<ServerEnvironment> = {}, dependencies: ServerDependencies = {}): Express {
  const app = express();
  const token = (env.sharedAppToken ?? process.env.SHARED_APP_TOKEN ?? '').trim();
  const polygonApiKey = (env.polygonApiKey ?? process.env.POLYGON_API_KEY ?? '').trim();
  const anthropicApiKey = (env.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '').trim();
  const polygonClient = dependencies.polygonClient ?? (polygonApiKey ? createPolygonClient({ apiKey: polygonApiKey }) : null);
  const anthropicClient = dependencies.anthropicClient ?? (anthropicApiKey ? createAnthropicClient(anthropicApiKey) : null);
  const rateLimiter = createRateLimiter({
    maxRequests: env.maxRequests ?? Number(process.env.MAX_REQUESTS ?? 60),
    windowMs: env.rateLimitWindowMs ?? Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const start = Date.now();
    const end = (): void => {
      const duration = Date.now() - start;
      console.info(`${req.method} ${req.path} ${duration}ms`);
    };

    _res.on('finish', end);
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const key = (req.ip || req.socket.remoteAddress || 'anonymous').toString();

    if (!rateLimiter(key)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    if (token && !isAuthorized(req.headers, token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json(healthCheck());
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json(healthCheck());
  });

  app.post('/api/briefing', async (req: Request, res: Response) => {
    let payload: BriefingRequest;
    try {
      payload = validateBriefingRequest(req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid briefing request';
      sendBriefingError(res, 400, 'INVALID_REQUEST', message);
      return;
    }

    if (!polygonApiKey) {
      sendBriefingError(res, 503, 'MISSING_KEY', 'Missing required environment variable POLYGON_API_KEY.');
      return;
    }

    if (!anthropicApiKey) {
      sendBriefingError(res, 503, 'MISSING_KEY', 'Missing required environment variable ANTHROPIC_API_KEY.');
      return;
    }

    if (!polygonClient || !anthropicClient) {
      sendBriefingError(res, 503, 'MISSING_KEY', 'A required briefing provider is not configured.');
      return;
    }

    let bar: PolygonBar;
    try {
      bar = await polygonClient.getPreviousDayBar(payload.symbol);
      if (!isValidPolygonBar(bar)) {
        sendBriefingError(res, 502, 'POLYGON_ERROR', 'Polygon returned an incomplete previous-day aggregate.');
        return;
      }
    } catch (error) {
      const status = getErrorStatus(error);
      const polygonCode = error instanceof PolygonClientError ? error.code : undefined;
      if (status === 401 || polygonCode === 'authentication') {
        sendBriefingError(res, 502, 'POLYGON_AUTH', 'Polygon rejected the API key. Check POLYGON_API_KEY.');
      } else if (status === 403 || polygonCode === 'plan_restricted') {
        sendBriefingError(res, 502, 'POLYGON_PLAN', 'Polygon denied access to the previous-day aggregate endpoint for this key or plan.');
      } else {
        sendBriefingError(res, 502, 'POLYGON_ERROR', 'Polygon failed to return the previous-day aggregate.');
      }
      return;
    }

    const sourceDataPoints = [
      `Polygon ${payload.symbol} previous-day timestamp=${new Date(bar.t as number).toISOString()}`,
      `open=${bar.o}`,
      `high=${bar.h}`,
      `low=${bar.l}`,
      `close=${bar.c}`,
      `volume=${bar.v}`,
    ];
    const prompt = buildBriefingPrompt({
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      data: [
        ...sourceDataPoints.map((value) => {
          const separator = value.indexOf('=');
          return { label: value.slice(0, separator), value: value.slice(separator + 1) };
        }),
        ...payload.asks.map((ask) => ({ label: ask.label, value: ask.value })),
      ],
      ...(payload.notes ? { notes: payload.notes } : {}),
    });

    let raw: unknown;
    try {
      raw = await anthropicClient.generateBriefing({ prompt });
    } catch (error) {
      const status = getErrorStatus(error);
      if (error instanceof AnthropicOutputError) {
        sendBriefingError(res, 502, 'MODEL_OUTPUT_INVALID', `Claude returned an invalid briefing: ${error.message}`);
      } else if (status === 401 || status === 403) {
        sendBriefingError(res, 502, 'ANTHROPIC_AUTH', 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY.');
      } else {
        sendBriefingError(res, 502, 'ANTHROPIC_ERROR', `Anthropic briefing request failed${status ? ` (HTTP ${status})` : ''}.`);
      }
      return;
    }

    const parsed = briefResponseSchema.safeParse(raw);
    if (!parsed.success) {
      sendBriefingError(res, 502, 'MODEL_OUTPUT_INVALID', `Claude returned an invalid briefing: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
      return;
    }

    const analysis = parsed.data;
    if (analysis.setups.some((setup) => sanitizeSymbol(setup.ticker) !== payload.symbol)) {
      sendBriefingError(res, 502, 'MODEL_OUTPUT_INVALID', 'Claude returned an invalid briefing: every setup ticker must match the requested symbol.');
      return;
    }

    const model = {
      ...analysis,
      setups: analysis.setups.map((setup) => ({ ...setup, dataPoints: sourceDataPoints })),
    };

    res.json({
      ok: true,
      summary: {
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        style: payload.style,
        summary: analysis.marketContextSummary,
      },
      risk: { notes: analysis.risks },
      marketData: {
        provider: 'Polygon',
        ticker: payload.symbol,
        timestamp: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      },
      model,
      source: 'polygon+anthropic',
    });
  });

  app.post('/api/coaching', async (req: Request, res: Response) => {
    try {
      const payload = validateCoachingRequest(req.body);
      const risk = buildRiskSummary({
        volatility: clamp(payload.threshold / 100, 0, 1),
        drawdown: payload.scenario === 'bearish' ? 0.42 : 0.18,
        liquidity: 0.8,
        conviction: payload.scenario === 'bullish' ? 0.72 : 0.58,
      });

      if (anthropicClient) {
        try {
          const raw = await anthropicClient.generateCoach({
            prompt: buildCoachPrompt({
              symbol: payload.symbol,
              quote: {
                last: payload.price,
                bid: Math.max(0, payload.price - 0.25),
                ask: payload.price + 0.25,
                timestamp: new Date().toISOString(),
              },
              dataQuality: 'live',
              ...(payload.notes ? { notes: payload.notes } : {}),
            }),
          });
          const analysis = validateModelOutput(raw, coachResponseSchema);

          return res.json({
            ok: true,
            symbol: payload.symbol,
            stance: payload.scenario,
            price: payload.price,
            threshold: payload.threshold,
            guidance: analysis.actionNote,
            risk,
            model: analysis,
            source: 'anthropic',
          });
        } catch {
          return res.json({
            ok: true,
            symbol: payload.symbol,
            stance: payload.scenario,
            price: payload.price,
            threshold: payload.threshold,
            guidance: `${payload.symbol} is ${payload.scenario} near ${payload.price}. Keep position sizing disciplined and respect the ${payload.threshold}% risk band.`,
            risk,
            source: 'local',
          });
        }
      }

      res.json({
        ok: true,
        symbol: payload.symbol,
        stance: payload.scenario,
        price: payload.price,
        threshold: payload.threshold,
        guidance: `${payload.symbol} is ${payload.scenario} near ${payload.price}. Keep position sizing disciplined and respect the ${payload.threshold}% risk band.`,
        risk,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid coaching request';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/market/historical', (req: Request, res: Response) => {
    const symbol = sanitizeSymbol(req.query.symbol ?? 'AAPL');
    const multiplier = Number(req.query.multiplier ?? 1);
    const timespan = String(req.query.timespan ?? 'day');

    res.json({
      ok: true,
      symbol,
      multiplier,
      timespan,
      source: 'polygon',
      endpoint: '/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}',
      note: 'Use a valid Polygon API key on the server to populate this endpoint.',
      apiKeyConfigured: Boolean(env.polygonApiKey ?? process.env.POLYGON_API_KEY),
    });
  });

  app.get('/api/market/quote', (req: Request, res: Response) => {
    const symbol = sanitizeSymbol(req.query.symbol ?? 'AAPL');

    res.json({
      ok: true,
      symbol,
      bid: 0,
      ask: 0,
      last: 0,
      source: 'polygon',
      note: 'Real-time quote access depends on the provider plan and a valid token.',
      apiKeyConfigured: Boolean(env.polygonApiKey ?? process.env.POLYGON_API_KEY),
    });
  });

  app.get('/api/market/snapshot', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'Market snapshot integration remains unverified pending the official endpoint contract from the provider.',
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

export function startServer(env: Partial<ServerEnvironment> = {}): Express {
  const port = Number(env.port ?? process.env.PORT ?? 3001);
  const app = createServer(env);

  logStartupEnvironment(env);

  app.listen(port, () => {
    console.info(`Market Coach proxy listening on port ${port}`);
  });

  return app;
}

export default createServer;
