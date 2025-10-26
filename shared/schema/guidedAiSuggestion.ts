export const GUIDED_AI_SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    value: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['value'],
  additionalProperties: false,
} as const;

export type GuidedAiSuggestion = {
  value: string;
  reason?: string;
};
