import type { AppSettings, GeminiProviderConfig, OpenAIProviderConfig, ProviderConfig } from '../types';
import { getAllAdapterIds } from '../apply/slots';

const SETTINGS_KEY = 'settings:app';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    kind: 'on-device',
  },
  adapters: getAllAdapterIds(),
  autoFallback: 'skip',
  highlightOverlay: true,
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] as AppSettings | undefined;
  if (!settings) {
    return DEFAULT_SETTINGS;
  }
  const adapters = Array.isArray(settings.adapters) && settings.adapters.length > 0 ? settings.adapters : getAllAdapterIds();
  const autoFallback: AppSettings['autoFallback'] = settings.autoFallback === 'pause' ? 'pause' : 'skip';
  const highlightOverlay = settings.highlightOverlay === false ? false : true;
  if (settings.provider.kind === 'openai') {
    return {
      provider: normalizeOpenAIProvider(settings.provider),
      adapters,
      autoFallback,
      highlightOverlay,
    };
  }
  if (settings.provider.kind === 'gemini') {
    return {
      provider: normalizeGeminiProvider(settings.provider),
      adapters,
      autoFallback,
      highlightOverlay,
    };
  }
  return {
    provider: settings.provider,
    adapters,
    autoFallback,
    highlightOverlay,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const adapters = settings.adapters && settings.adapters.length > 0 ? settings.adapters : getAllAdapterIds();
  const highlightOverlay = settings.highlightOverlay === false ? false : true;
  const normalized: AppSettings = {
    provider: normalizeProvider(settings.provider),
    adapters,
    autoFallback: settings.autoFallback === 'pause' ? 'pause' : 'skip',
    highlightOverlay,
  };
  await browser.storage.local.set({ [SETTINGS_KEY]: normalized });
}

export function createOnDeviceProvider(): ProviderConfig {
  return { kind: 'on-device' };
}

export function createOpenAIProvider(
  apiKey: string,
  model: string,
  apiBaseUrl: string = OPENAI_DEFAULT_BASE_URL,
): ProviderConfig {
  return normalizeOpenAIProvider({ kind: 'openai', apiKey, model, apiBaseUrl });
}

export function createGeminiProvider(apiKey: string, model: string = GEMINI_DEFAULT_MODEL): ProviderConfig {
  return normalizeGeminiProvider({ kind: 'gemini', apiKey, model });
}

function normalizeOpenAIProvider(provider: OpenAIProviderConfig): OpenAIProviderConfig {
  return {
    ...provider,
    apiBaseUrl: provider.apiBaseUrl?.trim().length ? provider.apiBaseUrl : OPENAI_DEFAULT_BASE_URL,
  };
}

function normalizeGeminiProvider(provider: GeminiProviderConfig): GeminiProviderConfig {
  return {
    kind: 'gemini',
    apiKey: provider.apiKey?.trim() ?? '',
    model: provider.model?.trim() ?? '',
  };
}

function normalizeProvider(provider: ProviderConfig): ProviderConfig {
  if (provider.kind === 'openai') {
    return normalizeOpenAIProvider(provider);
  }
  if (provider.kind === 'gemini') {
    return normalizeGeminiProvider(provider);
  }
  return provider;
}
