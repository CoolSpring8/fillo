import { OUTPUT_SCHEMA } from '../schema/outputSchema';
import type { ChatMessage, ResumeExtractionResult } from '../types';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  apiBaseUrl?: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function promptOpenAI(
  { apiKey, model, apiBaseUrl }: OpenAIProviderOptions,
  messages: ChatMessage[],
): Promise<ResumeExtractionResult> {
  const baseUrlRaw = apiBaseUrl && apiBaseUrl.trim().length ? apiBaseUrl : DEFAULT_OPENAI_BASE_URL;
  const baseUrl = baseUrlRaw.endsWith('/') ? baseUrlRaw.slice(0, -1) : baseUrlRaw;
  const endpoint = `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'resume_extraction',
          strict: true,
          schema: OUTPUT_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${details}`);
  }

  const data = (await response.json()) as OpenAIChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI response missing content.');
  }

  const parsed = JSON.parse(text) as ResumeExtractionResult;
  return {
    resume: parsed.resume ?? {},
    custom: parsed.custom ?? {},
  };
}
