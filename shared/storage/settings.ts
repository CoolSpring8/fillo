import type { AppSettings, OpenAIProviderConfig, ProviderConfig } from '../types';
import { getAllAdapterIds } from '../apply/slots';

const SETTINGS_KEY = 'settings:app';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';

const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    kind: 'on-device',
  },
  adapters: getAllAdapterIds(),
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] as AppSettings | undefined;
  if (!settings) {
    return DEFAULT_SETTINGS;
  }
  const adapters = Array.isArray(settings.adapters) && settings.adapters.length > 0 ? settings.adapters : getAllAdapterIds();
  if (settings.provider.kind === 'openai') {
    return {
      provider: normalizeOpenAIProvider(settings.provider),
      adapters,
    };
  }
  return {
    provider: settings.provider,
    adapters,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const adapters = settings.adapters && settings.adapters.length > 0 ? settings.adapters : getAllAdapterIds();
  const normalized: AppSettings =
    settings.provider.kind === 'openai'
      ? { provider: normalizeOpenAIProvider(settings.provider), adapters }
      : { provider: settings.provider, adapters };
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

function normalizeOpenAIProvider(provider: OpenAIProviderConfig): OpenAIProviderConfig {
  return {
    ...provider,
    apiBaseUrl: provider.apiBaseUrl?.trim().length ? provider.apiBaseUrl : OPENAI_DEFAULT_BASE_URL,
  };
}
