export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resume: {
      type: 'object',
      additionalProperties: true,
    },
    custom: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['resume', 'custom'],
} as const;

export type OutputSchema = typeof OUTPUT_SCHEMA;
