import type { LanguageModelAvailability } from '../../../shared/llm/chromePrompt';
import {
  createGeminiProvider,
  createOpenAIProvider,
} from '../../../shared/storage/settings';
import type { AppSettings } from '../../../shared/types';
import type { OnDeviceSupportProps } from '../components/ProviderCard';
import type {
  GeminiConfigState,
  OnDeviceDownloadState,
  OpenAiConfigState,
  ProviderKind,
} from './useProviderSettings';

export function buildAppSettings(
  kind: ProviderKind,
  openAi: OpenAiConfigState,
  gemini: GeminiConfigState,
  adapters: string[],
  autoFallback: AppSettings['autoFallback'],
  highlightOverlay: boolean,
): AppSettings {
  if (kind === 'openai') {
    return {
      provider: createOpenAIProvider(openAi.apiKey, openAi.model, openAi.apiBaseUrl),
      adapters,
      autoFallback,
      highlightOverlay,
    };
  }
  if (kind === 'gemini') {
    return {
      provider: createGeminiProvider(gemini.apiKey, gemini.model),
      adapters,
      autoFallback,
      highlightOverlay,
    };
  }
  return {
    provider: { kind: 'on-device' },
    adapters,
    autoFallback,
    highlightOverlay,
  };
}

interface OnDeviceSupportParams {
  availability: LanguageModelAvailability;
  downloadState: OnDeviceDownloadState;
  t: (key: string, substitutions?: unknown) => string;
  translate: (key: string, substitutions?: unknown) => string;
  onDownload: () => void | Promise<void>;
}

export function deriveOnDeviceSupport({
  availability,
  downloadState,
  t,
  translate,
  onDownload,
}: OnDeviceSupportParams): OnDeviceSupportProps | undefined {
  if (availability === 'unavailable') {
    return {
      note: t('onboarding.provider.onDevice.unavailable'),
    };
  }

  if (downloadState.phase === 'error') {
    const reason =
      downloadState.error && downloadState.error.trim().length > 0
        ? downloadState.error
        : translate('onboarding.provider.onDevice.downloadFailedUnknown');
    return {
      note: translate('onboarding.provider.onDevice.downloadFailed', [reason]),
      actionLabel: translate('onboarding.provider.onDevice.retry'),
      onAction: onDownload,
    };
  }

  if (availability === 'available' || downloadState.phase === 'complete') {
    return {
      note: translate('onboarding.provider.onDevice.available'),
    };
  }

  if (downloadState.phase === 'downloading' || availability === 'downloading') {
    const progressValue = downloadState.phase === 'downloading' ? downloadState.progress : 0;
    const progressPercent = Math.round(progressValue * 100);
    return {
      note:
        progressValue > 0
          ? translate('onboarding.provider.onDevice.progress', [progressPercent.toString()])
          : t('onboarding.provider.onDevice.downloading'),
      progress: Math.max(0, Math.min(100, progressValue * 100)),
      actionLabel: translate('onboarding.provider.onDevice.download'),
      actionDisabled: true,
    };
  }

  return {
    note: t('onboarding.provider.onDevice.downloadable'),
    actionLabel: translate('onboarding.provider.onDevice.download'),
    onAction: onDownload,
  };
}
