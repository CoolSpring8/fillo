import type { AppSettings, ProviderConfig } from '../types';

const SETTINGS_KEY = 'settings:app';

const DEFAULT_SETTINGS: AppSettings = {
  provider: {
    kind: 'on-device',
  },
};

export async function getSettings(): Promise<AppSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] as AppSettings | undefined;
  return settings ?? DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export function createOnDeviceProvider(): ProviderConfig {
  return { kind: 'on-device' };
}

export function createOpenAIProvider(apiKey: string, model: string): ProviderConfig {
  return { kind: 'openai', apiKey, model };
}
