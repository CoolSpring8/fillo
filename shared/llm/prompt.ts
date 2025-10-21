import type { ChatMessage } from '../types';

export function buildResumePrompt(rawText: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are an information extractor tasked with converting resume text into the JSON Resume v1.0.0 format.',
        'Rules:',
        '- Use JSON Resume fields when they match the information.',
        '- If a detail does not cleanly map to JSON Resume, add it under meta.custom with descriptive keys.',
        '- Unrecognized properties are allowed anywhere (extensions under meta.custom preferred).',
        '- Never invent facts. Skip items that are not present.',
        '- Reply with a single JSON object that satisfies the provided schema.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Here is the raw text extracted from a resume PDF:',
        rawText,
        'Produce a single JSON object describing the resume that conforms to JSON Resume v1.0.0.',
      ].join('\n\n'),
    },
  ];
}
