import { describe, expect, it } from 'vitest';
import { hasAutoFillModel } from '../../../entrypoints/sidepanel/autoFillJudge';
import type { ProviderConfig } from '../../../shared/types';

describe('hasAutoFillModel', () => {
  it('returns false when provider is missing', () => {
    expect(hasAutoFillModel(null)).toBe(false);
    expect(hasAutoFillModel(undefined)).toBe(false);
  });

  it('returns true for on-device provider', () => {
    const provider: ProviderConfig = { kind: 'on-device' };
    expect(hasAutoFillModel(provider)).toBe(true);
  });

  it('requires api key and model for OpenAI', () => {
    const provider: ProviderConfig = {
      kind: 'openai',
      apiKey: 'sk-key',
      model: 'gpt-4o-mini',
      apiBaseUrl: 'https://api.openai.com',
    };
    expect(hasAutoFillModel(provider)).toBe(true);

    expect(
      hasAutoFillModel({
        ...provider,
        apiKey: '   ',
      }),
    ).toBe(false);

    expect(
      hasAutoFillModel({
        ...provider,
        model: '',
      }),
    ).toBe(false);
  });

  it('requires api key and model for Gemini', () => {
    const provider: ProviderConfig = {
      kind: 'gemini',
      apiKey: 'AIza-key',
      model: 'gemini-2.5-flash',
    };
    expect(hasAutoFillModel(provider)).toBe(true);

    expect(
      hasAutoFillModel({
        ...provider,
        apiKey: '',
      }),
    ).toBe(false);

    expect(
      hasAutoFillModel({
        ...provider,
        model: '   ',
      }),
    ).toBe(false);
  });
});
