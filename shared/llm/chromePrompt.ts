import { OUTPUT_SCHEMA } from '../schema/outputSchema';
import type { ChatMessage, ResumeExtractionResult } from '../types';

export type LanguageModelAvailability = 'unavailable' | 'available' | 'downloadable' | 'downloading';

interface ChromeLanguageModel {
  availability?: () => Promise<LanguageModelAvailability>;
  create: (options?: Record<string, unknown>) => Promise<ChromeLanguageModelSession>;
}

interface ChromeLanguageModelSession {
  prompt: (input: string, options?: Record<string, unknown>) => Promise<string>;
  destroy?: () => void;
}

declare global {
  interface Window {
    LanguageModel?: ChromeLanguageModel;
    ai?: {
      languageModel?: ChromeLanguageModel;
    };
  }
}

function getLanguageModel(): ChromeLanguageModel | undefined {
  return window.LanguageModel ?? window.ai?.languageModel;
}

function formatMessages(messages: ChatMessage[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');
}

export async function ensureOnDeviceAvailability(): Promise<LanguageModelAvailability> {
  const languageModel = getLanguageModel();
  if (!languageModel) {
    return 'unavailable';
  }

  if (!languageModel.availability) {
    return 'available';
  }

  try {
    return await languageModel.availability();
  } catch {
    return 'unavailable';
  }
}

export async function promptOnDevice(messages: ChatMessage[]): Promise<ResumeExtractionResult> {
  const languageModel = getLanguageModel();
  if (!languageModel) {
    throw new Error('On-device model unavailable in this context.');
  }

  const session = await languageModel.create();

  try {
    const promptText = formatMessages(messages);
    const responseJson = await session.prompt(promptText, {
      // Chrome Prompt API expects a JSON schema constraint when enforcing structure.
      responseConstraint: {
        type: 'json_schema',
        schema: OUTPUT_SCHEMA,
      },
      temperature: 0,
    });

    const parsed = JSON.parse(responseJson) as ResumeExtractionResult;
    return {
      resume: parsed.resume ?? {},
      custom: parsed.custom ?? {},
    };
  } finally {
    session.destroy?.();
  }
}
