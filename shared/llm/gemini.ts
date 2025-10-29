import type { Content, GenerateContentParameters } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import type { ChatMessage } from '../types';
import { ProviderConfigurationError, ProviderInvocationError } from './errors';

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
}

export interface GeminiInvocationOptions {
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
}

export async function promptGemini(
  { apiKey, model }: GeminiProviderOptions,
  messages: ChatMessage[],
  { responseSchema, temperature, signal }: GeminiInvocationOptions = {},
): Promise<string> {
  if (!apiKey?.trim()) {
    throw new ProviderConfigurationError('gemini', 'Gemini API key is missing.');
  }
  if (!model?.trim()) {
    throw new ProviderConfigurationError('gemini', 'Gemini model is missing.');
  }

  const { contents, systemInstruction } = buildRequestMessages(messages);
  if (contents.length === 0) {
    throw new ProviderInvocationError('gemini', 'Gemini request requires at least one user message.');
  }

  const client = new GoogleGenAI({ apiKey });
  const config: NonNullable<GenerateContentParameters['config']> = {};
  if (typeof temperature === 'number') {
    config.temperature = temperature;
  }
  if (signal) {
    config.abortSignal = signal;
  }
  if (responseSchema) {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = responseSchema;
  }
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const params: GenerateContentParameters = {
    model,
    contents,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };

  try {
    const response = await client.models.generateContent(params);
    const text = response.text;
    if (!text?.trim()) {
      throw new ProviderInvocationError('gemini', 'Gemini response missing content.');
    }
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderInvocationError('gemini', `Gemini request failed: ${message}`);
  }
}

function buildRequestMessages(messages: ChatMessage[]): {
  contents: Content[];
  systemInstruction?: string;
} {
  const systemParts: string[] = [];
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim().length > 0) {
        systemParts.push(message.content.trim());
      }
      continue;
    }
    const role = message.role === 'assistant' ? 'model' : 'user';
    contents.push({
      role,
      parts: [{ text: message.content }],
    });
  }
  return {
    contents,
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n') : undefined,
  };
}
