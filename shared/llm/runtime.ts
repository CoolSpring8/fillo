import type { ChatMessage, ProviderConfig } from '../types';
import { promptOnDevice } from './chromePrompt';
import { promptOpenAI } from './openai';
import { promptGemini } from './gemini';
import {
  NoProviderConfiguredError,
  ProviderConfigurationError,
} from './errors';

export interface OnDeviceTemplateOptions {
  key: string;
  seedMessages: ChatMessage[];
}

export interface LlmInvocationOptions {
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
  onDeviceTemplate?: OnDeviceTemplateOptions;
}

export async function invokeWithProvider(
  provider: ProviderConfig | null | undefined,
  messages: ChatMessage[],
  options: LlmInvocationOptions = {},
): Promise<string> {
  if (!provider) {
    throw new NoProviderConfiguredError();
  }

  const { onDeviceTemplate, ...baseOptions } = options;

  switch (provider.kind) {
    case 'on-device':
      return promptOnDevice(messages, { ...baseOptions, template: onDeviceTemplate });
    case 'openai':
      return promptOpenAI(
        {
          apiKey: provider.apiKey,
          model: provider.model,
          apiBaseUrl: provider.apiBaseUrl,
        },
        messages,
        baseOptions,
      );
    case 'gemini':
      return promptGemini(
        {
          apiKey: provider.apiKey,
          model: provider.model,
        },
        messages,
        baseOptions,
      );
    default: {
      const exhaustive: never = provider;
      throw new ProviderConfigurationError('on-device', `Unsupported provider ${String(exhaustive)}`);
    }
  }
}
