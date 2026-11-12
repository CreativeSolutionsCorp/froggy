import { z } from 'zod';

export const briefResponseSchema = z.object({
  marketContextSummary: z.string().min(1),
  setups: z.array(
    z.object({
      ticker: z.string().min(1),
      direction: z.enum(['long', 'short']),
      entryZone: z.object({
        low: z.number(),
        high: z.number(),
      }),
      stopPrice: z.number(),
      targets: z.array(z.number()).min(1).max(5),
      rewardToRisk: z.number(),
      confidence: z.enum(['low', 'medium', 'high']),
      reasoning: z.string().min(1),
      dataPoints: z.array(z.string()).min(1),
      invalidationCondition: z.string().min(1),
    }),
  ).max(5),
  risks: z.array(z.string()).min(1),
  disclaimer: z.string().min(1).refine((value) => /not financial advice/i.test(value), {
    message: 'Disclaimers must say the output is not financial advice.',
  }),
});

export const coachResponseSchema = z.object({
  headline: z.string().min(1),
  actionNote: z.string().min(1),
  updatedLevels: z.object({
    entry: z.number(),
    stop: z.number(),
    target: z.number(),
  }),
  riskWarning: z.string().optional(),
  dataQualityNote: z.string().min(1),
  disclaimer: z.string().min(1).refine((value) => /not financial advice/i.test(value), {
    message: 'Disclaimers must say the output is not financial advice.',
  }),
});

export function validateModelOutput<T>(payload: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new Error(`Model validation failed: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }

  return result.data;
}

export function buildBriefingPrompt(input: {
  symbol: string;
  timeframe: string;
  notes?: string;
  data: Array<{ label: string; value: string }>;
}): string {
  const details = input.data.length > 0
    ? input.data.map((item) => `${item.label}: ${item.value}`).join('; ')
    : 'insufficient data';

  return [
    'You are an analyst, not an advisor.',
    'Use only the data supplied. If the data is incomplete, say "insufficient data" instead of guessing.',
    'Never state certainty or guarantee profit.',
    'Each setup must include a stop and an invalidation condition.',
    `Symbol: ${input.symbol}`,
    `Timeframe: ${input.timeframe}`,
    `Data: ${details}`,
    input.notes ? `Notes: ${input.notes}` : 'Notes: none',
    'Return JSON only matching the briefing schema.',
    'This output is for research only and is not financial advice.',
  ].join('\n');
}

export function buildCoachPrompt(input: {
  symbol: string;
  quote: {
    last: number;
    bid: number;
    ask: number;
    timestamp: string;
  };
  dataQuality: 'live' | 'delayed' | 'unreadable';
  notes?: string;
}): string {
  return [
    'You are an analyst, not an advisor.',
    'Treat the API quote values as the source of truth. Use the image only for open positions, average cost, and chart drawings, and flag mismatches.',
    'If the data is incomplete or unreadable, say "insufficient data" instead of guessing.',
    'Never state certainty or guarantee profit.',
    'Include a stop and the invalidation condition for any setup or action note.',
    `Symbol: ${input.symbol}`,
    `Quote: ${JSON.stringify(input.quote)}`,
    `Data quality: ${input.dataQuality}`,
    input.notes ? `Notes: ${input.notes}` : 'Notes: none',
    'Return JSON only matching the live coach schema.',
    'This output is for research only and is not financial advice.',
  ].join('\n');
}
