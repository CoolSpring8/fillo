import type { AppSettings, OpenAIProviderConfig, ProviderConfig } from '../types';

const SETTINGS_KEY = 'settings:app';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';

const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    kind: 'on-device',
  },
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] as AppSettings | undefined;
  if (!settings) {
    return DEFAULT_SETTINGS;
  }
  if (settings.provider.kind === 'openai') {
    return {
      provider: normalizeOpenAIProvider(settings.provider),
    };
  }
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const normalized: AppSettings =
    settings.provider.kind === 'openai'
      ? { provider: normalizeOpenAIProvider(settings.provider) }
      : settings;
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
