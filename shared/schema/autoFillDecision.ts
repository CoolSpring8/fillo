export const AUTO_FILL_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    decision: { enum: ['fill', 'reject'] },
    key: { type: 'string' },
    reason: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['decision'],
  additionalProperties: false,
} as const;

export type AutoFillDecisionKind = 'fill' | 'reject';
