import type { ChatMessage } from '../types';

export function buildResumePrompt(rawText: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are an information extractor tasked with converting resume text into JSON.',
        'Rules:',
        '- Use schema fields when they match the information.',
        '- Skip items that are not present.',
        '- Reply with a single JSON object that satisfies the provided schema.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Here is the raw text extracted from a resume PDF:',
        rawText,
      ].join('\n\n'),
    },
  ];
}
