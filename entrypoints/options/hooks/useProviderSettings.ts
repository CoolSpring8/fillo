import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  downloadOnDeviceModel,
  ensureOnDeviceAvailability,
  type LanguageModelAvailability,
} from '../../../shared/llm/chromePrompt';
import { listAvailableAdapters } from '../../../shared/apply/adapters';
import {
  createGeminiProvider,
  createOpenAIProvider,
  getSettings,
  saveSettings,
  OPENAI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
} from '../../../shared/storage/settings';
import type { AppSettings } from '../../../shared/types';
import type { AdapterItem } from '../components/AdaptersCard';
import type { OnDeviceSupportProps } from '../components/ProviderCard';

export type ProviderKind = 'on-device' | 'openai' | 'gemini';

export interface OpenAiConfigState {
  apiKey: string;
  model: string;
  apiBaseUrl: string;
}

export interface GeminiConfigState {
  apiKey: string;
  model: string;
}

type OnDeviceDownloadPhase = 'idle' | 'downloading' | 'complete' | 'error';

export interface OnDeviceDownloadState {
  phase: OnDeviceDownloadPhase;
  progress: number;
  error?: string;
}

interface UseProviderSettingsParams {
  t: (key: string, substitutions?: unknown) => string;
  translate: (key: string, substitutions?: unknown) => string;
}

interface UseProviderSettingsResult {
  selectedProvider: ProviderKind;
  openAiConfig: OpenAiConfigState;
  geminiConfig: GeminiConfigState;
  autoFallback: AppSettings['autoFallback'];
  highlightOverlay: boolean;
  availability: LanguageModelAvailability;
  onDeviceDownloadState: OnDeviceDownloadState;
  canUseOnDevice: boolean;
  onDeviceSupport?: OnDeviceSupportProps;
  providerConfigured: boolean;
  adapterItems: AdapterItem[];
  handleProviderChange: (value: ProviderKind) => Promise<void>;
  handleOpenAiApiKeyChange: (value: string) => void;
  handleOpenAiModelChange: (value: string) => void;
  handleOpenAiApiBaseUrlChange: (value: string) => void;
  handleGeminiApiKeyChange: (value: string) => void;
  handleGeminiModelChange: (value: string) => void;
  handleToggleAdapter: (id: string, checked: boolean) => void;
  handleAutoFallbackChange: (value: AppSettings['autoFallback']) => void;
  handleHighlightOverlayChange: (value: boolean) => void;
}

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
type AdapterDefinition = ReturnType<typeof listAvailableAdapters>[number];

export function useProviderSettings({
  t,
  translate,
}: UseProviderSettingsParams): UseProviderSettingsResult {
  const adapters = useMemo(() => listAvailableAdapters(), []);
  const defaultAdapterIds = useMemo(
    () => adapters.map((adapter: AdapterDefinition) => adapter.id),
    [adapters],
  );

  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>('on-device');
  const [availability, setAvailability] = useState<LanguageModelAvailability>('unavailable');
  const [onDeviceDownloadState, setOnDeviceDownloadState] = useState<OnDeviceDownloadState>({
    phase: 'idle',
    progress: 0,
  });
  const [openAiConfig, setOpenAiConfig] = useState<OpenAiConfigState>({
    apiKey: '',
    model: OPENAI_DEFAULT_MODEL,
    apiBaseUrl: OPENAI_DEFAULT_BASE_URL,
  });
  const [geminiConfig, setGeminiConfig] = useState<GeminiConfigState>({
    apiKey: '',
    model: GEMINI_DEFAULT_MODEL,
  });
  const [activeAdapters, setActiveAdapters] = useState<string[]>(defaultAdapterIds);
  const [autoFallback, setAutoFallback] = useState<AppSettings['autoFallback']>('skip');
  const [highlightOverlay, setHighlightOverlay] = useState(true);

  useEffect(() => {
    getSettings().then((loaded: AppSettings) => {
      if (loaded.provider.kind === 'openai') {
        setSelectedProvider('openai');
        setOpenAiConfig({
          apiKey: loaded.provider.apiKey ?? '',
          model: loaded.provider.model?.trim().length ? loaded.provider.model : OPENAI_DEFAULT_MODEL,
          apiBaseUrl: loaded.provider.apiBaseUrl?.trim().length
            ? loaded.provider.apiBaseUrl
            : OPENAI_DEFAULT_BASE_URL,
        });
      } else if (loaded.provider.kind === 'gemini') {
        setSelectedProvider('gemini');
        setGeminiConfig({
          apiKey: loaded.provider.apiKey ?? '',
          model: loaded.provider.model?.trim().length ? loaded.provider.model : GEMINI_DEFAULT_MODEL,
        });
      } else {
        setSelectedProvider('on-device');
      }
      setActiveAdapters(loaded.adapters.length > 0 ? loaded.adapters : defaultAdapterIds);
      setAutoFallback(loaded.autoFallback ?? 'skip');
      setHighlightOverlay(loaded.highlightOverlay !== false);
    });

    ensureOnDeviceAvailability().then((value: LanguageModelAvailability) => {
      setAvailability(value);
      if (value === 'available') {
        setOnDeviceDownloadState((current) =>
          current.phase === 'complete' ? current : { phase: 'complete', progress: 1 },
        );
        return;
      }
      if (value === 'downloading') {
        setOnDeviceDownloadState((current) =>
          current.phase === 'downloading' ? current : { phase: 'downloading', progress: 0 },
        );
        return;
      }
      setOnDeviceDownloadState((current) =>
        current.phase === 'error' ? current : { phase: 'idle', progress: 0 },
      );
    });
  }, [defaultAdapterIds]);

  const buildSettings = useCallback(
    (
      kind: ProviderKind,
      openAi: OpenAiConfigState,
      gemini: GeminiConfigState,
      adaptersList: string[],
      autoFallbackValue: AppSettings['autoFallback'],
      highlightOverlayValue: boolean,
    ): AppSettings => {
      if (kind === 'openai') {
        return {
          provider: createOpenAIProvider(openAi.apiKey, openAi.model, openAi.apiBaseUrl),
          adapters: adaptersList,
          autoFallback: autoFallbackValue,
          highlightOverlay: highlightOverlayValue,
        };
      }
      if (kind === 'gemini') {
        return {
          provider: createGeminiProvider(gemini.apiKey, gemini.model),
          adapters: adaptersList,
          autoFallback: autoFallbackValue,
          highlightOverlay: highlightOverlayValue,
        };
      }
      return {
        provider: { kind: 'on-device' },
        adapters: adaptersList,
        autoFallback: autoFallbackValue,
        highlightOverlay: highlightOverlayValue,
      };
    },
    [],
  );

  const handleDownloadOnDevice = useCallback(async () => {
    if (onDeviceDownloadState.phase === 'downloading') {
      return;
    }
    setOnDeviceDownloadState({ phase: 'downloading', progress: 0 });
    setAvailability('downloading');
    let downloadFailed = false;
    try {
      await downloadOnDeviceModel({
        onProgress: (value) => {
          setOnDeviceDownloadState((current) => {
            if (current.phase !== 'downloading') {
              return current;
            }
            return { ...current, progress: value };
          });
        },
      });
    } catch (error) {
      downloadFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      setOnDeviceDownloadState({ phase: 'error', progress: 0, error: message });
    } finally {
      const latest = await ensureOnDeviceAvailability();
      setAvailability(latest);
      if (downloadFailed) {
        return;
      }
      if (latest === 'available') {
        setOnDeviceDownloadState({ phase: 'complete', progress: 1 });
        return;
      }
      if (latest === 'downloading') {
        setOnDeviceDownloadState((current) =>
          current.phase === 'downloading' ? current : { phase: 'downloading', progress: 0 },
        );
        return;
      }
      setOnDeviceDownloadState({ phase: 'idle', progress: 0 });
    }
  }, [onDeviceDownloadState.phase]);

  const canUseOnDevice = availability !== 'unavailable';

  const adaptersToUse = useCallback(
    (nextAdapters: string[]) => (nextAdapters.length > 0 ? nextAdapters : defaultAdapterIds),
    [defaultAdapterIds],
  );

  const handleProviderChange = useCallback(
    async (value: ProviderKind) => {
      setSelectedProvider(value);
      const resolvedAdapters = adaptersToUse(activeAdapters);
      if (value === 'openai') {
        const nextOpenAi =
          openAiConfig.apiBaseUrl.trim().length > 0
            ? openAiConfig
            : { ...openAiConfig, apiBaseUrl: OPENAI_DEFAULT_BASE_URL };
        if (nextOpenAi !== openAiConfig) {
          setOpenAiConfig(nextOpenAi);
        }
        const next = buildSettings(
          'openai',
          nextOpenAi,
          geminiConfig,
          resolvedAdapters,
          autoFallback,
          highlightOverlay,
        );
        await saveSettings(next);
        return;
      }
      if (value === 'gemini') {
        const next = buildSettings(
          'gemini',
          openAiConfig,
          geminiConfig,
          resolvedAdapters,
          autoFallback,
          highlightOverlay,
        );
        await saveSettings(next);
        return;
      }
      const next = buildSettings(
        'on-device',
        openAiConfig,
        geminiConfig,
        resolvedAdapters,
        autoFallback,
        highlightOverlay,
      );
      await saveSettings(next);
    },
    [
      activeAdapters,
      adaptersToUse,
      autoFallback,
      buildSettings,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
    ],
  );

  const persistSettings = useCallback(
    (
      kind: ProviderKind,
      openAi: OpenAiConfigState,
      gemini: GeminiConfigState,
      adaptersList: string[],
      fallbackValue: AppSettings['autoFallback'],
      highlightValue: boolean,
    ) => {
      const next = buildSettings(kind, openAi, gemini, adaptersList, fallbackValue, highlightValue);
      void saveSettings(next);
    },
    [buildSettings],
  );

  const handleOpenAiApiKeyChange = useCallback(
    (value: string) => {
      const updated = { ...openAiConfig, apiKey: value };
      setOpenAiConfig(updated);
      if (selectedProvider === 'openai') {
        const resolvedAdapters = adaptersToUse(activeAdapters);
        const baseUrl =
          updated.apiBaseUrl.trim().length > 0 ? updated.apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
        const configured =
          baseUrl === updated.apiBaseUrl ? updated : { ...updated, apiBaseUrl: baseUrl };
        persistSettings(
          'openai',
          configured,
          geminiConfig,
          resolvedAdapters,
          autoFallback,
          highlightOverlay,
        );
      }
    },
    [
      activeAdapters,
      adaptersToUse,
      autoFallback,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
      persistSettings,
      selectedProvider,
    ],
  );

  const handleOpenAiModelChange = useCallback(
    (value: string) => {
      const updated = { ...openAiConfig, model: value };
      setOpenAiConfig(updated);
      if (selectedProvider === 'openai') {
        const resolvedAdapters = adaptersToUse(activeAdapters);
        const baseUrl =
          updated.apiBaseUrl.trim().length > 0 ? updated.apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
        const configured =
          baseUrl === updated.apiBaseUrl ? updated : { ...updated, apiBaseUrl: baseUrl };
        persistSettings(
          'openai',
          configured,
          geminiConfig,
          resolvedAdapters,
          autoFallback,
          highlightOverlay,
        );
      }
    },
    [
      activeAdapters,
      adaptersToUse,
      autoFallback,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
      persistSettings,
      selectedProvider,
    ],
  );

  const handleOpenAiApiBaseUrlChange = useCallback(
    (value: string) => {
      const updated = { ...openAiConfig, apiBaseUrl: value };
      setOpenAiConfig(updated);
      if (selectedProvider === 'openai') {
        const resolvedAdapters = adaptersToUse(activeAdapters);
        const baseUrl = value.trim().length > 0 ? value : OPENAI_DEFAULT_BASE_URL;
        const configured = baseUrl === value ? updated : { ...updated, apiBaseUrl: baseUrl };
        persistSettings(
          'openai',
          configured,
          geminiConfig,
          resolvedAdapters,
          autoFallback,
          highlightOverlay,
        );
      }
    },
    [
      activeAdapters,
      adaptersToUse,
      autoFallback,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
      persistSettings,
      selectedProvider,
    ],
  );

  const handleGeminiApiKeyChange = useCallback(
    (value: string) => {
      const updated = { ...geminiConfig, apiKey: value };
      setGeminiConfig(updated);
      if (selectedProvider === 'gemini') {
        const resolvedAdapters = adaptersToUse(activeAdapters);
        persistSettings(
          'gemini',
          openAiConfig,
          updated,
          resolvedAdapters,
          autoFallback,
          highlightOverlay,
        );
      }
    },
    [
      activeAdapters,
      adaptersToUse,
      autoFallback,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
      persistSettings,
      selectedProvider,
    ],
  );

  const handleGeminiModelChange = useCallback(
    (value: string) => {
      const updated = { ...geminiConfig, model: value };
      setGeminiConfig(updated);
      if (selectedProvider === 'gemini') {
        const resolvedAdapters = adaptersToUse(activeAdapters);
        persistSettings(
          'gemini',
          openAiConfig,
          updated,
          resolvedAdapters,
          autoFallback,
          highlightOverlay,
        );
      }
    },
    [
      activeAdapters,
      adaptersToUse,
      autoFallback,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
      persistSettings,
      selectedProvider,
    ],
  );

  const handleToggleAdapter = useCallback(
    (id: string, checked: boolean) => {
      setActiveAdapters((current) => {
        const next = checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id);
        const resolved = adaptersToUse(next);
        const openAiForSettings =
          openAiConfig.apiBaseUrl.trim().length > 0
            ? openAiConfig
            : { ...openAiConfig, apiBaseUrl: OPENAI_DEFAULT_BASE_URL };
        const nextSettings = buildSettings(
          selectedProvider,
          openAiForSettings,
          geminiConfig,
          resolved,
          autoFallback,
          highlightOverlay,
        );
        void saveSettings(nextSettings);
        return resolved;
      });
    },
    [
      adaptersToUse,
      autoFallback,
      buildSettings,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
      selectedProvider,
    ],
  );

  const handleAutoFallbackChange = useCallback(
    (value: AppSettings['autoFallback']) => {
      setAutoFallback(value);
      const resolvedAdapters = adaptersToUse(activeAdapters);
      const openAiForSettings =
        openAiConfig.apiBaseUrl.trim().length > 0
          ? openAiConfig
          : { ...openAiConfig, apiBaseUrl: OPENAI_DEFAULT_BASE_URL };
      const nextSettings = buildSettings(
        selectedProvider,
        openAiForSettings,
        geminiConfig,
        resolvedAdapters,
        value,
        highlightOverlay,
      );
      void saveSettings(nextSettings);
    },
    [
      activeAdapters,
      adaptersToUse,
      buildSettings,
      geminiConfig,
      highlightOverlay,
      openAiConfig,
      selectedProvider,
    ],
  );

  const handleHighlightOverlayChange = useCallback(
    (value: boolean) => {
      setHighlightOverlay(value);
      const resolvedAdapters = adaptersToUse(activeAdapters);
      const openAiForSettings =
        openAiConfig.apiBaseUrl.trim().length > 0
          ? openAiConfig
          : { ...openAiConfig, apiBaseUrl: OPENAI_DEFAULT_BASE_URL };
      const nextSettings = buildSettings(
        selectedProvider,
        openAiForSettings,
        geminiConfig,
        resolvedAdapters,
        autoFallback,
        value,
      );
      void saveSettings(nextSettings);
    },
    [
      activeAdapters,
      adaptersToUse,
      autoFallback,
      buildSettings,
      geminiConfig,
      openAiConfig,
      selectedProvider,
    ],
  );

  const adapterItems = useMemo<AdapterItem[]>(
    () =>
      adapters.map((adapter: AdapterDefinition) => ({
        id: adapter.id,
        name: t(adapter.nameKey),
        description: adapter.descriptionKey ? t(adapter.descriptionKey) : null,
        checked: activeAdapters.includes(adapter.id),
      })),
    [activeAdapters, adapters, t],
  );

  const onDeviceSupport = useMemo<OnDeviceSupportProps | undefined>(() => {
    if (availability === 'unavailable') {
      return {
        note: t('onboarding.provider.onDevice.unavailable'),
      };
    }

    if (onDeviceDownloadState.phase === 'error') {
      const reason =
        onDeviceDownloadState.error && onDeviceDownloadState.error.trim().length > 0
          ? onDeviceDownloadState.error
          : translate('onboarding.provider.onDevice.downloadFailedUnknown');
      return {
        note: translate('onboarding.provider.onDevice.downloadFailed', [reason]),
        actionLabel: translate('onboarding.provider.onDevice.retry'),
        onAction: handleDownloadOnDevice,
      };
    }

    if (availability === 'available' || onDeviceDownloadState.phase === 'complete') {
      return {
        note: translate('onboarding.provider.onDevice.available'),
      };
    }

    if (onDeviceDownloadState.phase === 'downloading' || availability === 'downloading') {
      const progressValue =
        onDeviceDownloadState.phase === 'downloading' ? onDeviceDownloadState.progress : 0;
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
      onAction: handleDownloadOnDevice,
    };
  }, [availability, handleDownloadOnDevice, onDeviceDownloadState, t, translate]);

  const providerConfigured = useMemo(() => {
    if (selectedProvider === 'on-device') {
      return availability === 'available' || onDeviceDownloadState.phase === 'complete';
    }
    if (selectedProvider === 'openai') {
      return openAiConfig.apiKey.trim().length > 0 && openAiConfig.model.trim().length > 0;
    }
    if (selectedProvider === 'gemini') {
      return geminiConfig.apiKey.trim().length > 0 && geminiConfig.model.trim().length > 0;
    }
    return false;
  }, [
    availability,
    geminiConfig.apiKey,
    geminiConfig.model,
    onDeviceDownloadState.phase,
    openAiConfig.apiKey,
    openAiConfig.model,
    selectedProvider,
  ]);

  return {
    selectedProvider,
    openAiConfig,
    geminiConfig,
    autoFallback,
    highlightOverlay,
    availability,
    onDeviceDownloadState,
    canUseOnDevice,
    onDeviceSupport,
    providerConfigured,
    adapterItems,
    handleProviderChange,
    handleOpenAiApiKeyChange,
    handleOpenAiModelChange,
    handleOpenAiApiBaseUrlChange,
    handleGeminiApiKeyChange,
    handleGeminiModelChange,
    handleToggleAdapter,
    handleAutoFallbackChange,
    handleHighlightOverlayChange,
  };
}
