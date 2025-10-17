import type { ChatMessage } from '../types';

export function buildResumePrompt(rawText: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are an information extractor tasked with converting resume text into the JSON Resume v1.0.0 format.',
        'Rules:',
        '- Use JSON Resume fields when they match the information.',
        '- If a detail does not cleanly map to JSON Resume, place it under "custom" with descriptive keys.',
        '- Never invent facts. Skip items that are not present.',
        '- The response must be valid JSON matching the provided schema.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Here is the raw text extracted from a resume PDF:',
        rawText,
        'Produce: { "resume": { ... }, "custom": { ... } }',
      ].join('\n\n'),
    },
  ];
}
