import { describe, expect, it, vi } from 'vitest';
import {
  buildAppSettings,
  deriveOnDeviceSupport,
} from '../../../../entrypoints/options/hooks/providerUtils';
import type { AppSettings } from '../../../../shared/types';
import type { OnDeviceDownloadState } from '../../../../entrypoints/options/hooks/useProviderSettings';

const noop = (key: string, args?: unknown) =>
  Array.isArray(args) ? `${key}:${args.join(',')}` : key;

describe('buildAppSettings', () => {
  it('creates OpenAI settings with adapters', () => {
    const settings = buildAppSettings(
      'openai',
      { apiKey: 'sk-test', model: 'gpt-mini', apiBaseUrl: 'https://custom' },
      { apiKey: '', model: '' },
      ['adapter-a'],
      'pause',
      false,
    );

    expect(settings.provider).toEqual({
      kind: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-mini',
      apiBaseUrl: 'https://custom',
    });
    expect(settings.adapters).toEqual(['adapter-a']);
    expect(settings.autoFallback).toBe('pause');
    expect(settings.highlightOverlay).toBe(false);
  });

  it('returns on-device settings when provider is local', () => {
    const settings = buildAppSettings(
      'on-device',
      { apiKey: '', model: '', apiBaseUrl: '' },
      { apiKey: '', model: '' },
      ['adapter-a', 'adapter-b'],
      'skip',
      true,
    );

    expect(settings.provider).toEqual({ kind: 'on-device' });
    expect(settings.adapters).toHaveLength(2);
  });
});

describe('deriveOnDeviceSupport', () => {
  const baseState: OnDeviceDownloadState = { phase: 'idle', progress: 0 };

  it('returns unavailable note when the model is not supported', () => {
    const support = deriveOnDeviceSupport({
      availability: 'unavailable',
      downloadState: baseState,
      t: noop,
      translate: noop,
      onDownload: vi.fn(),
    });

    expect(support?.note).toBe('onboarding.provider.onDevice.unavailable');
  });

  it('surfaces download progress hints', () => {
    const support = deriveOnDeviceSupport({
      availability: 'downloading',
      downloadState: { phase: 'downloading', progress: 0.42 },
      t: noop,
      translate: noop,
      onDownload: vi.fn(),
    });

    expect(support?.progress).toBe(42);
    expect(support?.actionDisabled).toBe(true);
  });

  it('provides retry action when download fails', () => {
    const retry = vi.fn();
    const support = deriveOnDeviceSupport({
      availability: 'available',
      downloadState: { phase: 'error', progress: 0, error: 'disk full' },
      t: noop,
      translate: noop,
      onDownload: retry,
    });

    expect(support?.actionLabel).toBe('onboarding.provider.onDevice.retry');
    support?.onAction?.();
    expect(retry).toHaveBeenCalled();
  });

  it('confirms availability when model already present', () => {
    const support = deriveOnDeviceSupport({
      availability: 'available',
      downloadState: baseState,
      t: noop,
      translate: noop,
      onDownload: vi.fn(),
    });

    expect(support?.note).toBe('onboarding.provider.onDevice.available');
  });
});
