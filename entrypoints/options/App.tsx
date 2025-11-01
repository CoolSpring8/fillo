import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Affix,
  Alert,
  Badge,
  Box,
  Button,
  Container,
  CopyButton,
  Flex,
  Group,
  List,
  Modal,
  NavLink,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
  rem,
} from '@mantine/core';
import { useForm } from 'react-hook-form';
import {
  downloadOnDeviceModel,
  ensureOnDeviceAvailability,
  type LanguageModelAvailability,
} from '../../shared/llm/chromePrompt';
import { invokeWithProvider } from '../../shared/llm/runtime';
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../../shared/llm/errors';
import { buildResumePrompt } from '../../shared/llm/prompt';
import { extractTextFromPdf } from '../../shared/pdf/extractText';
import { deleteProfile, listProfiles, saveProfile, storeFile } from '../../shared/storage/profiles';
import {
  createOnDeviceProvider,
  createOpenAIProvider,
  createGeminiProvider,
  getSettings,
  saveSettings,
  OPENAI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
} from '../../shared/storage/settings';
import { getActiveProfileId, setActiveProfileId } from '../../shared/storage/activeProfile';
import { listAvailableAdapters } from '../../shared/apply/adapters';
import resumeSchema from '../../shared/schema/jsonresume-v1.llm.json';
import { validateResume } from '../../shared/validate';
import { CheckCircle2, Circle } from 'lucide-react';
import { notifications } from '@mantine/notifications';
import type {
  AppSettings,
  ProviderConfig,
  ProviderSnapshot,
  ProfileRecord,
  ResumeExtractionResult,
} from '../../shared/types';
import { listAssociations, clearAllMemory, deleteAssociation } from '../../shared/memory/store';
import { ProfilesCard, type ProfilesCardProfile } from './components/ProfilesCard';
import { ProviderCard } from './components/ProviderCard';
import { AdaptersCard, type AdapterItem } from './components/AdaptersCard';
import { AutofillCard } from './components/AutofillCard';
import { OverlayCard } from './components/OverlayCard';
import { MemoryCard, type MemoryEntry } from './components/MemoryCard';
import {
  ProfileForm,
  createEmptyResumeFormValues,
  formValuesToResume,
  mergeResumeFormValues,
  resumeToFormValues,
  type ResumeFormValues,
} from './components/ProfileForm';

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

type StatusPhase = 'idle' | 'extracting' | 'parsing' | 'saving' | 'complete' | 'error';

interface StatusState {
  phase: StatusPhase;
  message: string;
}

interface MemoryState {
  loading: boolean;
  error?: string;
}

type OnDeviceDownloadPhase = 'idle' | 'downloading' | 'complete' | 'error';

interface OnDeviceDownloadState {
  phase: OnDeviceDownloadPhase;
  progress: number;
  error?: string;
}

interface ConfettiPiece {
  id: number;
  left: number;
  tx: number;
  delay: number;
  color: string;
}

interface TourStep {
  element: HTMLElement;
  title: string;
  description: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  align: 'start' | 'center' | 'end';
}

function buildOpenAIProvider(apiKey: string, model: string, apiBaseUrl: string): ProviderConfig {
  return createOpenAIProvider(apiKey, model, apiBaseUrl);
}

function buildGeminiProvider(apiKey: string, model: string): ProviderConfig {
  return createGeminiProvider(apiKey, model);
}

function buildSettings(
  kind: 'on-device' | 'openai' | 'gemini',
  openAi: { apiKey: string; model: string; apiBaseUrl: string },
  gemini: { apiKey: string; model: string },
  adapters: string[],
  autoFallback: AppSettings['autoFallback'],
  highlightOverlay: boolean,
): AppSettings {
  if (kind === 'openai') {
    return {
      provider: buildOpenAIProvider(openAi.apiKey, openAi.model, openAi.apiBaseUrl),
      adapters,
      autoFallback,
      highlightOverlay,
    };
  }
  if (kind === 'gemini') {
    return {
      provider: buildGeminiProvider(gemini.apiKey, gemini.model),
      adapters,
      autoFallback,
      highlightOverlay,
    };
  }
  return { provider: { kind: 'on-device' }, adapters, autoFallback, highlightOverlay };
}

export default function App() {
  const form = useForm<ResumeFormValues>({
    defaultValues: createEmptyResumeFormValues(),
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'on-device' | 'openai' | 'gemini'>('on-device');
  const [availability, setAvailability] = useState<LanguageModelAvailability>('unavailable');
  const [onDeviceDownloadState, setOnDeviceDownloadState] = useState<OnDeviceDownloadState>({
    phase: 'idle',
    progress: 0,
  });
  const [openAiConfig, setOpenAiConfig] = useState({
    apiKey: '',
    model: OPENAI_DEFAULT_MODEL,
    apiBaseUrl: OPENAI_DEFAULT_BASE_URL,
  });
  const [geminiConfig, setGeminiConfig] = useState({
    apiKey: '',
    model: GEMINI_DEFAULT_MODEL,
  });
  const adapters = useMemo(() => listAvailableAdapters(), []);
  const defaultAdapterIds = useMemo(() => adapters.map((adapter) => adapter.id), [adapters]);
  const [activeAdapters, setActiveAdapters] = useState<string[]>(defaultAdapterIds);
  const [autoFallback, setAutoFallback] = useState<AppSettings['autoFallback']>('skip');
  const [highlightOverlay, setHighlightOverlay] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [filePromptOpen, setFilePromptOpen] = useState(false);
  const [parseAgainConfirmOpen, setParseAgainConfirmOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [profilesState, setProfilesState] = useState<{ loading: boolean; error?: string }>({
    loading: true,
  });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const selectedProfileIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ phase: 'idle', message: '' });
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<'upload' | 'parse' | 'save' | null>(null);
  const [rawText, setRawText] = useState('');
  const [memoryItems, setMemoryItems] = useState<MemoryEntry[]>([]);
  const [memoryState, setMemoryState] = useState<MemoryState>({ loading: true });
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [celebrationVersion, setCelebrationVersion] = useState(0);
  const celebrationButtonRef = useRef<HTMLButtonElement | null>(null);
  const importButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusNotificationId = useRef<string | null>(null);
  const skipNextCelebrationRef = useRef(false);
  const [tourState, setTourState] = useState<{ steps: TourStep[]; index: number } | null>(null);
  const [tourRect, setTourRect] = useState<DOMRect | null>(null);
  const setupSectionRef = useRef<HTMLDivElement | null>(null);
  const providerSectionRef = useRef<HTMLDivElement | null>(null);
  const profilesSectionRef = useRef<HTMLDivElement | null>(null);
  const autofillSectionRef = useRef<HTMLDivElement | null>(null);
  const advancedSectionRef = useRef<HTMLDivElement | null>(null);
  const { t } = i18n;
  const translate = t as unknown as (key: string, substitutions?: unknown) => string;
  const providerLabels: Record<'on-device' | 'openai' | 'gemini', string> = {
    'on-device': t('options.provider.onDevice'),
    openai: t('options.provider.openai'),
    gemini: t('options.provider.gemini'),
  };

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
  }, [selectedProfileId]);

  useEffect(() => {
    let mounted = true;
    browser.storage.local
      .get('onboarding:completed')
      .then((result) => {
        if (!mounted) {
          return;
        }
        const completed = Boolean(result['onboarding:completed']);
        setOnboardingCompleted(completed);
      })
      .catch(() => {
        if (mounted) {
          setOnboardingCompleted(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const refreshProfiles = useCallback(
    async (preferredId?: string) => {
      setProfilesState((state) => ({ ...state, loading: true, error: undefined }));
      try {
        const list = await listProfiles();
        setProfiles(list);
        setProfilesState({ loading: false });
        const storedActiveId = await getActiveProfileId();
        const availableIds = new Set(list.map((profile) => profile.id));
        const currentSelected = selectedProfileIdRef.current;
        let nextSelected: string | null = null;
        if (preferredId && availableIds.has(preferredId)) {
          nextSelected = preferredId;
        } else if (storedActiveId && availableIds.has(storedActiveId)) {
          nextSelected = storedActiveId;
        } else if (currentSelected && availableIds.has(currentSelected)) {
          nextSelected = currentSelected;
        } else {
          nextSelected = list.length > 0 ? list[0].id : null;
        }
        setSelectedProfileId(nextSelected);
        if (nextSelected !== storedActiveId) {
          try {
            await setActiveProfileId(nextSelected);
          } catch (error) {
            console.warn('Unable to persist active profile', error);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesState({ loading: false, error: message });
      }
    },
    [],
  );

  const refreshMemoryItems = useCallback(async () => {
    setMemoryState({ loading: true, error: undefined });
    try {
      const list = await listAssociations();
      setMemoryItems(list);
      setMemoryState({ loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemoryState({ loading: false, error: message });
    }
  }, []);

  const handleClearMemory = useCallback(async () => {
    setMemoryState((state) => ({ ...state, loading: true, error: undefined }));
    try {
      await clearAllMemory();
      await refreshMemoryItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemoryState({ loading: false, error: message });
    }
  }, [refreshMemoryItems]);

  const handleDeleteMemory = useCallback(async (key: string) => {
    setMemoryState((state) => ({ ...state, loading: true, error: undefined }));
    try {
      await deleteAssociation(key);
      await refreshMemoryItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemoryState({ loading: false, error: message });
    }
  }, [refreshMemoryItems]);

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

  const formatMemoryEntry = useCallback(
    ({ key, association }: MemoryEntry) => {
      const parts: string[] = [key];
      const preferred = association.preferredSlot;
      if (preferred) {
        parts.push(t('options.memory.preferredSlot', [preferred]));
      }
      const last = association.lastValue?.trim();
      if (last && last.length > 0) {
        const limited = last.length <= 80 ? last : `${last.slice(0, 79)}…`;
        parts.push(t('options.memory.lastValue', [limited]));
      }
      return parts.join(' · ');
    },
    [t],
  );

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const validationErrors = useMemo(() => {
    if (!selectedProfile?.validation || selectedProfile.validation.valid) {
      return [];
    }
    return selectedProfile.validation.errors ?? [];
  }, [selectedProfile]);

  useEffect(() => {
    if (!selectedProfile) {
      const empty = createEmptyResumeFormValues();
      form.reset(empty);
      setRawText('');
      return;
    }
    const values = resumeToFormValues(selectedProfile.resume);
    form.reset(values);
    setRawText(selectedProfile.rawText);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfile]);

  useEffect(() => {
    getSettings().then((loaded) => {
      setSettings(loaded);
      if (loaded.provider.kind === 'openai') {
        setSelectedProvider('openai');
        setOpenAiConfig({
          apiKey: loaded.provider.apiKey ?? '',
          model: loaded.provider.model?.trim().length ? loaded.provider.model : OPENAI_DEFAULT_MODEL,
          apiBaseUrl: loaded.provider.apiBaseUrl?.trim().length ? loaded.provider.apiBaseUrl : OPENAI_DEFAULT_BASE_URL,
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
    ensureOnDeviceAvailability().then((value) => {
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
    void refreshProfiles();
  }, [defaultAdapterIds, refreshProfiles]);

  useEffect(() => {
    const listener = () => {
      void refreshProfiles();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refreshProfiles]);

  useEffect(() => {
    void refreshMemoryItems();
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if ('memory:associations' in changes) {
        void refreshMemoryItems();
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refreshMemoryItems]);

  const handleProviderChange = async (value: 'on-device' | 'openai' | 'gemini') => {
    setSelectedProvider(value);
    const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
    if (value === 'openai') {
      const nextOpenAi =
        openAiConfig.apiBaseUrl.trim().length > 0
          ? openAiConfig
          : { ...openAiConfig, apiBaseUrl: OPENAI_DEFAULT_BASE_URL };
      if (nextOpenAi !== openAiConfig) {
        setOpenAiConfig(nextOpenAi);
      }
      const next = buildSettings('openai', nextOpenAi, geminiConfig, adaptersToUse, autoFallback, highlightOverlay);
      setSettings(next);
      await saveSettings(next);
      return;
    }
    if (value === 'gemini') {
      const next = buildSettings('gemini', openAiConfig, geminiConfig, adaptersToUse, autoFallback, highlightOverlay);
      setSettings(next);
      await saveSettings(next);
      return;
    }
    const next = buildSettings('on-device', openAiConfig, geminiConfig, adaptersToUse, autoFallback, highlightOverlay);
    setSettings(next);
    await saveSettings(next);
  };

  const handleOpenAiApiKeyChange = (value: string) => {
    const updated = { ...openAiConfig, apiKey: value };
    setOpenAiConfig(updated);
    if (selectedProvider === 'openai') {
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const baseUrl = updated.apiBaseUrl.trim().length ? updated.apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const configured =
        baseUrl === updated.apiBaseUrl ? updated : { ...updated, apiBaseUrl: baseUrl };
      const next = buildSettings('openai', configured, geminiConfig, adaptersToUse, autoFallback, highlightOverlay);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleOpenAiModelChange = (value: string) => {
    const updated = { ...openAiConfig, model: value };
    setOpenAiConfig(updated);
    if (selectedProvider === 'openai') {
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const baseUrl = updated.apiBaseUrl.trim().length ? updated.apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const configured =
        baseUrl === updated.apiBaseUrl ? updated : { ...updated, apiBaseUrl: baseUrl };
      const next = buildSettings('openai', configured, geminiConfig, adaptersToUse, autoFallback, highlightOverlay);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleOpenAiApiBaseUrlChange = (value: string) => {
    const updated = { ...openAiConfig, apiBaseUrl: value };
    setOpenAiConfig(updated);
    if (selectedProvider === 'openai') {
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const baseUrl = value.trim().length ? value : OPENAI_DEFAULT_BASE_URL;
      const configured = baseUrl === value ? updated : { ...updated, apiBaseUrl: baseUrl };
      const next = buildSettings('openai', configured, geminiConfig, adaptersToUse, autoFallback, highlightOverlay);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleGeminiApiKeyChange = (value: string) => {
    const updated = { ...geminiConfig, apiKey: value };
    setGeminiConfig(updated);
    if (selectedProvider === 'gemini') {
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const next = buildSettings('gemini', openAiConfig, updated, adaptersToUse, autoFallback, highlightOverlay);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleGeminiModelChange = (value: string) => {
    const updated = { ...geminiConfig, model: value };
    setGeminiConfig(updated);
    if (selectedProvider === 'gemini') {
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const next = buildSettings('gemini', openAiConfig, updated, adaptersToUse, autoFallback, highlightOverlay);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const adapterItems = useMemo<AdapterItem[]>(
    () =>
      adapters.map((adapter) => ({
        id: adapter.id,
        name: t(adapter.nameKey),
        description: adapter.descriptionKey ? t(adapter.descriptionKey) : null,
        checked: activeAdapters.includes(adapter.id),
      })),
    [adapters, activeAdapters, t],
  );

  const handleToggleAdapter = (id: string, checked: boolean) => {
    setActiveAdapters((current) => {
      const next = checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id);
      const resolved = next.length > 0 ? next : defaultAdapterIds;
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
      setSettings(nextSettings);
      void saveSettings(nextSettings);
      return resolved;
    });
  };

  const handleAutoFallbackChange = (value: AppSettings['autoFallback']) => {
    setAutoFallback(value);
    const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
    const openAiForSettings =
      openAiConfig.apiBaseUrl.trim().length > 0
        ? openAiConfig
        : { ...openAiConfig, apiBaseUrl: OPENAI_DEFAULT_BASE_URL };
    const nextSettings = buildSettings(
      selectedProvider,
      openAiForSettings,
      geminiConfig,
      adaptersToUse,
      value,
      highlightOverlay,
    );
    setSettings(nextSettings);
    void saveSettings(nextSettings);
  };

  const handleHighlightOverlayChange = (value: boolean) => {
    setHighlightOverlay(value);
    const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
    const openAiForSettings =
      openAiConfig.apiBaseUrl.trim().length > 0
        ? openAiConfig
        : { ...openAiConfig, apiBaseUrl: OPENAI_DEFAULT_BASE_URL };
    const nextSettings = buildSettings(
      selectedProvider,
      openAiForSettings,
      geminiConfig,
      adaptersToUse,
      autoFallback,
      value,
    );
    setSettings(nextSettings);
    void saveSettings(nextSettings);
  };

  const handleFileSelect = (file: File | null) => {
    if (!file) {
      return;
    }
    setPendingFile(file);
    setFilePromptOpen(true);
    setStatus({ phase: 'idle', message: '' });
    setErrorDetails(null);
  };

  const closeFilePrompt = () => {
    setFilePromptOpen(false);
    setPendingFile(null);
  };

  const openParseAgainConfirm = () => {
    setParseAgainConfirmOpen(true);
  };

  const closeParseAgainConfirm = () => {
    setParseAgainConfirmOpen(false);
  };

  const handleFileAction = async (mode: 'parse' | 'store') => {
    if (!pendingFile) {
      return;
    }
    await processFile(pendingFile, mode);
    closeFilePrompt();
  };

  const processFile = async (file: File, mode: 'parse' | 'store') => {
    if (!selectedProfile) {
      return;
    }
    setBusy(true);
    setBusyAction(mode === 'parse' ? 'parse' : 'upload');
    setErrorDetails(null);
    setStatus({ phase: 'extracting', message: t('options.profileForm.status.extracting') });

    try {
      const { text } = await extractTextFromPdf(file);

      if (!text.trim()) {
        throw new Error(t('onboarding.errors.noText'));
      }

      const fileRef = await storeFile(selectedProfile.id, file);

      let resumeResult = selectedProfile.resume;
      let providerSnapshot = selectedProfile.provider;
      let parsedAt = selectedProfile.parsedAt;
      let validation = selectedProfile.validation;
      const parseRequested = mode === 'parse';
      let parseSucceeded = false;
      let parseErrorMessage: string | null = null;
      let parseErrorDetails: string | null = null;

      if (parseRequested) {
        const canParse =
          selectedProvider === 'openai'
            ? openAiConfig.apiKey.trim().length > 0 && openAiConfig.model.trim().length > 0
            : selectedProvider === 'gemini'
              ? geminiConfig.apiKey.trim().length > 0 && geminiConfig.model.trim().length > 0
              : availability !== 'unavailable';
        if (!canParse) {
          parseErrorMessage = t('options.profileForm.status.parseUnavailable');
        } else {
          setStatus({ phase: 'parsing', message: t('options.profileForm.status.parsing') });
          try {
            const messages = buildResumePrompt(text);
            const providerConfig: ProviderConfig =
              selectedProvider === 'openai'
                ? createOpenAIProvider(openAiConfig.apiKey, openAiConfig.model, openAiConfig.apiBaseUrl)
                : selectedProvider === 'gemini'
                  ? createGeminiProvider(geminiConfig.apiKey, geminiConfig.model)
                  : createOnDeviceProvider();

            const raw = await invokeWithProvider(providerConfig, messages, {
              responseSchema: resumeSchema,
              temperature: 0,
              onDeviceTemplate: {
                key: 'resume-extraction/v1',
                seedMessages: messages.slice(0, 1),
              },
            });

            const parsed = JSON.parse(raw) as unknown;
            const resume: ResumeExtractionResult =
              parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as ResumeExtractionResult)
                : {};

            const snapshot: ProviderSnapshot =
              providerConfig.kind === 'openai'
                ? {
                    kind: 'openai',
                    model: providerConfig.model,
                    apiBaseUrl: providerConfig.apiBaseUrl,
                  }
                : providerConfig.kind === 'gemini'
                  ? {
                      kind: 'gemini',
                      model: providerConfig.model,
                    }
                  : { kind: 'on-device' };

            const formValues = resumeToFormValues(resume);
            const mergedValues = mergeResumeFormValues(form.getValues(), formValues);
            form.reset(mergedValues);

            const mergedResume = formValuesToResume(mergedValues);
            const validationResult = validateResume(mergedResume);

            resumeResult = mergedResume;
            providerSnapshot = snapshot;
            parsedAt = new Date().toISOString();
            validation = {
              valid: validationResult.valid,
              errors: validationResult.errors,
            };
            parseSucceeded = true;
            setStatus({ phase: 'saving', message: t('options.profileForm.status.savingParsed') });
          } catch (error) {
            if (
              error instanceof NoProviderConfiguredError ||
              error instanceof ProviderConfigurationError ||
              error instanceof ProviderAvailabilityError
            ) {
              parseErrorMessage = error.message;
              parseErrorDetails = null;
            } else {
              const message = error instanceof Error ? error.message : String(error);
              parseErrorMessage =
                error instanceof ProviderInvocationError
                  ? error.message
                  : t('options.profileForm.status.parseFailed');
              parseErrorDetails = error instanceof ProviderInvocationError ? null : message;
            }
          }
        }
      }

      if (!parseRequested || parseSucceeded) {
        setStatus({ phase: 'saving', message: t('options.profileForm.status.savingUpload') });
      }

      const updated: ProfileRecord = {
        ...selectedProfile,
        sourceFile: fileRef,
        rawText: text,
        resume: resumeResult,
        provider: providerSnapshot,
        parsedAt,
        validation,
      };

      await saveProfile(updated);
      await refreshProfiles(updated.id);
      setRawText(text);

      if (parseRequested) {
        if (parseSucceeded) {
          setStatus({ phase: 'complete', message: t('options.profileForm.status.parsed') });
          setErrorDetails(null);
        } else if (parseErrorMessage) {
          setStatus({ phase: 'error', message: parseErrorMessage });
          setErrorDetails(parseErrorDetails);
        }
      } else {
        setStatus({ phase: 'complete', message: t('options.profileForm.status.stored') });
        setErrorDetails(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ phase: 'error', message: t('options.profileForm.status.uploadFailed') });
      setErrorDetails(message);
      console.error(error);
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const handleParseAgain = async () => {
    if (!selectedProfile || busy) {
      return;
    }
    closeParseAgainConfirm();
    const text = rawText.trim();
    if (!text) {
      return;
    }

    const canParse =
      selectedProvider === 'openai'
        ? openAiConfig.apiKey.trim().length > 0 && openAiConfig.model.trim().length > 0
        : selectedProvider === 'gemini'
          ? geminiConfig.apiKey.trim().length > 0 && geminiConfig.model.trim().length > 0
          : availability !== 'unavailable';

    if (!canParse) {
      setStatus({ phase: 'error', message: t('options.profileForm.status.parseUnavailable') });
      setErrorDetails(null);
      return;
    }

    setBusy(true);
    setBusyAction('parse');
    setErrorDetails(null);
    setStatus({ phase: 'parsing', message: t('options.profileForm.status.parsing') });

    try {
      const messages = buildResumePrompt(text);
      const providerConfig: ProviderConfig =
        selectedProvider === 'openai'
          ? createOpenAIProvider(openAiConfig.apiKey, openAiConfig.model, openAiConfig.apiBaseUrl)
          : selectedProvider === 'gemini'
            ? createGeminiProvider(geminiConfig.apiKey, geminiConfig.model)
            : createOnDeviceProvider();

      const raw = await invokeWithProvider(providerConfig, messages, {
        responseSchema: resumeSchema,
        temperature: 0,
        onDeviceTemplate: {
          key: 'resume-extraction/v1',
          seedMessages: messages.slice(0, 1),
        },
      });

      const parsed = JSON.parse(raw) as unknown;
      const resume: ResumeExtractionResult =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as ResumeExtractionResult)
          : {};

      const snapshot: ProviderSnapshot =
        providerConfig.kind === 'openai'
          ? {
              kind: 'openai',
              model: providerConfig.model,
              apiBaseUrl: providerConfig.apiBaseUrl,
            }
          : providerConfig.kind === 'gemini'
            ? {
                kind: 'gemini',
                model: providerConfig.model,
              }
            : { kind: 'on-device' };

      const parsedValues = resumeToFormValues(resume);
      const mergedValues = mergeResumeFormValues(form.getValues(), parsedValues);
      form.reset(mergedValues);

      const mergedResume = formValuesToResume(mergedValues);
      const validationResult = validateResume(mergedResume);

      setStatus({ phase: 'saving', message: t('options.profileForm.status.savingParsed') });

      const updated: ProfileRecord = {
        ...selectedProfile,
        resume: mergedResume,
        provider: snapshot,
        parsedAt: new Date().toISOString(),
        validation: {
          valid: validationResult.valid,
          errors: validationResult.errors,
        },
      };

      await saveProfile(updated);
      await refreshProfiles(updated.id);
      setStatus({ phase: 'complete', message: t('options.profileForm.status.parsed') });
      setErrorDetails(null);
    } catch (error) {
      if (
        error instanceof NoProviderConfiguredError ||
        error instanceof ProviderConfigurationError ||
        error instanceof ProviderAvailabilityError
      ) {
        setStatus({ phase: 'error', message: error.message });
        setErrorDetails(null);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const displayMessage =
          error instanceof ProviderInvocationError
            ? error.message
            : t('options.profileForm.status.parseFailed');
        const details = error instanceof ProviderInvocationError ? null : message;
        setStatus({ phase: 'error', message: displayMessage });
        setErrorDetails(details);
      }
      console.error(error);
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const handleSaveForm = async (values: ResumeFormValues) => {
    if (!selectedProfile) {
      return;
    }
    setBusy(true);
    setBusyAction('save');
    setStatus({ phase: 'saving', message: t('options.profileForm.status.savingForm') });
    setErrorDetails(null);

    try {
      const resumeData = formValuesToResume(values);
      const hasResume = Object.keys(resumeData).length > 0;
      const resumePayload = hasResume ? resumeData : undefined;
      const validationResult = resumePayload ? validateResume(resumePayload) : undefined;

      const updated: ProfileRecord = {
        ...selectedProfile,
        resume: resumePayload,
        parsedAt: resumePayload ? new Date().toISOString() : undefined,
        validation: resumePayload
          ? {
              valid: validationResult?.valid ?? true,
              errors: validationResult?.errors,
            }
          : undefined,
      };

      await saveProfile(updated);
      await refreshProfiles(updated.id);
      form.reset(values);

      setStatus({ phase: 'complete', message: t('options.profileForm.status.savedForm') });
      setErrorDetails(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ phase: 'error', message: t('options.profileForm.status.saveFailed') });
      setErrorDetails(message);
      console.error(error);
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const handleResetForm = () => {
    if (!selectedProfile) {
      const empty = createEmptyResumeFormValues();
      form.reset(empty);
      return;
    }
    const values = resumeToFormValues(selectedProfile.resume);
    form.reset(values);
  };

  const handleSelectProfile = (id: string) => {
    setSelectedProfileId(id);
    void setActiveProfileId(id).catch((error) => {
      console.warn('Unable to set active profile', error);
    });
  };

  const handleDeleteProfile = async (id: string) => {
    await deleteProfile(id);
    setStatus({ phase: 'complete', message: t('options.profileForm.status.profileDeleted') });
    setErrorDetails(null);
    await refreshProfiles();
  };

  const handleCreateProfile = async () => {
    const id = crypto.randomUUID();
    const profile: ProfileRecord = {
      id,
      createdAt: new Date().toISOString(),
      rawText: '',
      resume: {},
    };
    await saveProfile(profile);
    try {
      await setActiveProfileId(id);
    } catch (error) {
      console.warn('Unable to set active profile after creation', error);
    }
    setStatus({ phase: 'complete', message: t('options.profileForm.status.profileCreated') });
    setErrorDetails(null);
    await refreshProfiles(id);
  };

  const handleResetOnboarding = useCallback(async () => {
    try {
      await browser.storage.local.set({ 'onboarding:completed': false });
      setCelebrationOpen(false);
      setOnboardingCompleted(false);
      skipNextCelebrationRef.current = true;
      notifications.show({
        color: 'brand',
        message: t('options.advanced.resetOnboardingSuccess'),
      });
    } catch (error) {
      notifications.show({
        color: 'red',
        message: t('options.advanced.resetOnboardingError'),
      });
      console.error('Unable to reset onboarding flag', error);
    }
  }, [t]);

  const handleReplayCelebration = useCallback(() => {
    setCelebrationVersion((value) => value + 1);
    setCelebrationOpen(true);
  }, []);

  const canUseOnDevice = availability !== 'unavailable';
  const onDeviceSupport = useMemo(() => {
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
      };
    }

    return {
      note: t('onboarding.provider.onDevice.downloadable'),
      actionLabel: translate('onboarding.provider.onDevice.download'),
      onAction: handleDownloadOnDevice,
    };
  }, [availability, handleDownloadOnDevice, onDeviceDownloadState, t]);

  const resolveProfileName = (profile: ProfileRecord): string => {
    const resume = profile.resume;
    if (resume && typeof resume === 'object' && !Array.isArray(resume)) {
      const basics = (resume as Record<string, unknown>).basics;
      if (basics && typeof basics === 'object' && !Array.isArray(basics)) {
        const name = (basics as Record<string, unknown>).name;
        if (typeof name === 'string' && name.trim().length > 0) {
          return name.trim();
        }
      }
    }
    return t('onboarding.manage.unnamed');
  };

  const formatProfileSummary = (profile: ProfileRecord): string => {
    const created = formatDateTime(profile.createdAt);
    const characters = profile.rawText.length.toLocaleString();
    if (profile.sourceFile?.name) {
      return t('onboarding.manage.summaryWithFile', [
        created,
        profile.sourceFile.name,
        characters,
      ]);
    }
    return t('onboarding.manage.summary', [created, characters]);
  };

  const formatProfileParsing = (profile: ProfileRecord): string => {
    if (!profile.provider) {
      return t('onboarding.manage.notParsed');
    }
    const parsedAt = profile.parsedAt ? formatDateTime(profile.parsedAt) : null;
    if (profile.provider.kind === 'openai') {
      return parsedAt
        ? t('onboarding.manage.parsedOpenAIAt', [profile.provider.model, parsedAt])
        : t('onboarding.manage.parsedOpenAI', [profile.provider.model]);
    }
    if (profile.provider.kind === 'gemini') {
      return parsedAt
        ? t('onboarding.manage.parsedGeminiAt', [profile.provider.model, parsedAt])
        : t('onboarding.manage.parsedGemini', [profile.provider.model]);
    }
    return parsedAt
      ? t('onboarding.manage.parsedOnDeviceAt', [parsedAt])
      : t('onboarding.manage.parsedOnDevice');
  };

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
    onDeviceDownloadState.phase,
    openAiConfig.apiKey,
    openAiConfig.model,
    geminiConfig.apiKey,
    geminiConfig.model,
    selectedProvider,
  ]);

  const profileCountLabel = profiles.length.toLocaleString();
  const hasProfiles = profiles.length > 0;
  const totalSteps = 2;
  const completedSteps = (providerConfigured ? 1 : 0) + (hasProfiles ? 1 : 0);
  const progressCountLabel = t('options.progress.count', [`${completedSteps}`, `${totalSteps}`]);
  const progressBadgeLabel =
    completedSteps === totalSteps ? t('options.progress.done', [progressCountLabel]) : progressCountLabel;
  const progressColor = completedSteps === totalSteps ? 'teal' : completedSteps > 0 ? 'brand' : 'gray';

  const setupChecklist = useMemo(
    () => [
      {
        id: 'provider',
        complete: providerConfigured,
        title: t('options.checklist.provider.title'),
        description: t('options.checklist.provider.description'),
        target: 'section-provider',
      },
      {
        id: 'profile',
        complete: hasProfiles,
        title: t('options.checklist.profile.title'),
        description: t('options.checklist.profile.description'),
        target: 'section-profiles',
      },
    ],
    [providerConfigured, hasProfiles, t],
  );

  const navLinks = useMemo(
    () => [
      { id: 'section-getting-started', label: t('options.sections.gettingStarted'), ref: setupSectionRef },
      { id: 'section-provider', label: t('options.sections.provider'), ref: providerSectionRef },
      { id: 'section-profiles', label: t('options.sections.profiles'), ref: profilesSectionRef },
      { id: 'section-autofill', label: t('options.sections.autofill'), ref: autofillSectionRef },
      { id: 'section-advanced', label: t('options.sections.advanced'), ref: advancedSectionRef },
    ],
    [t],
  );

  const confettiPieces = useMemo<ConfettiPiece[]>(() => {
    if (!celebrationOpen) {
      return [];
    }
    return Array.from({ length: 80 }, (_, index) => ({
      id: index,
      left: Math.random() * 100,
      tx: Math.random() * 100 - 50,
      delay: Math.random() * 0.2,
      color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`,
    }));
  }, [celebrationOpen, celebrationVersion]);

  useEffect(() => {
    if (!providerConfigured || !hasProfiles || onboardingCompleted === null) {
      return;
    }
    if (!onboardingCompleted) {
      if (skipNextCelebrationRef.current) {
        skipNextCelebrationRef.current = false;
        return;
      }
      setCelebrationVersion((value) => value + 1);
      setCelebrationOpen(true);
      setOnboardingCompleted(true);
      void browser.storage.local.set({ 'onboarding:completed': true }).catch((error) => {
        console.warn('Unable to persist onboarding completion', error);
      });
    }
  }, [providerConfigured, hasProfiles, onboardingCompleted]);

  useEffect(() => {
    if (!celebrationOpen) {
      return;
    }
    celebrationButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCelebrationOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [celebrationOpen]);

  useEffect(() => {
    if (!tourState) {
      setTourRect(null);
      return;
    }
    const step = tourState.steps[tourState.index];
    if (!step) {
      setTourState(null);
      setTourRect(null);
      return;
    }
    const updateRect = () => {
      const rect = step.element.getBoundingClientRect();
      setTourRect(rect);
    };
    updateRect();
    const handleResize = () => updateRect();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [tourState]);

  useEffect(() => {
    if (!tourState) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTourState(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tourState]);

  const handleScrollTo = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  useEffect(() => {
    const activeId = statusNotificationId.current;

    if (!status.message) {
      if (activeId) {
        notifications.hide(activeId);
        statusNotificationId.current = null;
      }
      return;
    }

    const baseId = activeId ?? `status-${Date.now()}`;

    if (status.phase === 'idle') {
      if (activeId) {
        notifications.hide(activeId);
        statusNotificationId.current = null;
      }
      return;
    }

    if (status.phase === 'complete') {
      const payload = {
        id: baseId,
        color: 'teal' as const,
        title: status.message,
        message: errorDetails ?? undefined,
        autoClose: 4000,
        withCloseButton: true,
        loading: false,
      };
      if (activeId) {
        notifications.update(payload);
      } else {
        notifications.show(payload);
      }
      statusNotificationId.current = null;
      return;
    }

    if (status.phase === 'error') {
      const payload = {
        id: baseId,
        color: 'red' as const,
        title: status.message,
        message: errorDetails ?? undefined,
        autoClose: 6000,
        withCloseButton: true,
        loading: false,
      };
      if (activeId) {
        notifications.update(payload);
      } else {
        notifications.show(payload);
      }
      statusNotificationId.current = null;
      return;
    }

    const payload = {
      id: baseId,
      color: 'brand' as const,
      title: status.message,
      message: errorDetails ?? undefined,
      autoClose: false,
      withCloseButton: false,
      loading: true,
    };

    if (activeId) {
      notifications.update(payload);
    } else {
      notifications.show(payload);
    }
    statusNotificationId.current = baseId;
  }, [status, errorDetails]);

  const handleStartTour = useCallback(() => {
    const steps: TourStep[] = [];
    if (importButtonRef.current) {
      steps.push({
        element: importButtonRef.current,
        title: t('options.tour.import.title'),
        description: t('options.tour.import.description'),
        side: 'bottom',
        align: 'center',
      });
    }
    if (providerSectionRef.current) {
      steps.push({
        element: providerSectionRef.current,
        title: t('options.tour.provider.title'),
        description: t('options.tour.provider.description'),
        side: 'right',
        align: 'start',
      });
    }
    if (profilesSectionRef.current) {
      steps.push({
        element: profilesSectionRef.current,
        title: t('options.tour.profiles.title'),
        description: t('options.tour.profiles.description'),
        side: 'right',
        align: 'center',
      });
    }
    if (autofillSectionRef.current) {
      steps.push({
        element: autofillSectionRef.current,
        title: t('options.tour.autofill.title'),
        description: t('options.tour.autofill.description'),
        side: 'right',
        align: 'start',
      });
    }

    if (steps.length === 0) {
      notifications.show({
        color: 'yellow',
        message: t('options.tour.unavailable'),
      });
      return;
    }

    steps[0].element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTourState({ steps, index: 0 });
  }, [t]);

  const handleTourAdvance = useCallback(() => {
    setTourState((state) => {
      if (!state) {
        return state;
      }
      const nextIndex = state.index + 1;
      if (nextIndex >= state.steps.length) {
        return null;
      }
      state.steps[nextIndex].element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { steps: state.steps, index: nextIndex };
    });
  }, []);

  const handleTourRetreat = useCallback(() => {
    setTourState((state) => {
      if (!state) {
        return state;
      }
      const prevIndex = Math.max(0, state.index - 1);
      if (prevIndex === state.index) {
        return state;
      }
      state.steps[prevIndex].element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { steps: state.steps, index: prevIndex };
    });
  }, []);

  const handleTourClose = useCallback(() => {
    setTourState(null);
  }, []);

  const currentTourStep = tourState ? tourState.steps[tourState.index] ?? null : null;
  const tourStepCount = tourState ? tourState.steps.length : 0;
  const tourStepNumber = tourState ? tourState.index + 1 : 0;

  const tourPopoverStyle = useMemo(() => {
    if (!tourRect || !currentTourStep) {
      return undefined;
    }
    const gap = 16;
    const transforms: string[] = [];
    const style: CSSProperties = {
      position: 'fixed',
      pointerEvents: 'auto',
    };
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

    if (currentTourStep.side === 'bottom') {
      style.top = Math.min(viewportHeight - gap, tourRect.bottom + gap);
    } else if (currentTourStep.side === 'top') {
      style.top = Math.max(gap, tourRect.top - gap);
      transforms.push('translateY(-100%)');
    } else {
      style.top = Math.max(gap, Math.min(tourRect.top, viewportHeight - gap));
    }

    if (currentTourStep.side === 'right') {
      style.left = Math.min(viewportWidth - gap, tourRect.right + gap);
    } else if (currentTourStep.side === 'left') {
      style.left = Math.max(gap, tourRect.left - gap);
      transforms.push('translateX(-100%)');
    } else {
      style.left = Math.max(gap, Math.min(tourRect.left, viewportWidth - gap));
    }

    if (currentTourStep.side === 'top' || currentTourStep.side === 'bottom') {
      if (currentTourStep.align === 'center') {
        style.left = tourRect.left + tourRect.width / 2;
        transforms.push('translateX(-50%)');
      } else if (currentTourStep.align === 'end') {
        style.left = tourRect.right;
        transforms.push('translateX(-100%)');
      }
    } else {
      if (currentTourStep.align === 'center') {
        style.top = tourRect.top + tourRect.height / 2;
        transforms.push('translateY(-50%)');
      } else if (currentTourStep.align === 'end') {
        style.top = tourRect.bottom;
        transforms.push('translateY(-100%)');
      }
    }

    if (transforms.length > 0) {
      style.transform = transforms.join(' ');
    }

    return style;
  }, [tourRect, currentTourStep]);

  const profilesData: ProfilesCardProfile[] = profiles.map((profile) => ({
    id: profile.id,
    name: resolveProfileName(profile),
    summary: formatProfileSummary(profile),
    parsing: formatProfileParsing(profile),
    isActive: selectedProfile?.id === profile.id,
  }));

  const fileSummary = selectedProfile?.sourceFile
    ? t('options.profileForm.upload.currentFile', [
        selectedProfile.sourceFile.name,
        selectedProfile.sourceFile.size.toLocaleString(),
      ])
    : null;

  const rawSummary =
    selectedProfile && rawText.trim().length > 0
      ? t('options.profileForm.upload.rawSummary', [rawText.length.toLocaleString()])
      : null;

  const formSaving = busy && busyAction === 'save';

  const canParseAgain = Boolean(selectedProfile && rawText.trim().length > 0);

  const showCopyHelper = Boolean(
    selectedProfile &&
    rawText.trim().length > 0 &&
    selectedProvider === 'on-device' &&
    availability === 'unavailable',
  );

  const profilesErrorLabel = profilesState.error
    ? t('onboarding.manage.error', [profilesState.error])
    : undefined;

  return (
    <>
      <style>{`
        .fillo-celebration {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          background-color: rgba(0, 0, 0, 0.55);
          z-index: 2000;
          padding: 24px;
        }
        .fillo-celebration__confetti {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .fillo-confetto {
          position: absolute;
          top: -10px;
          width: 8px;
          height: 14px;
          border-radius: 2px;
          animation: fillo-confetti-fall 1.8s linear forwards;
        }
        .fillo-celebration__card {
          position: relative;
          width: min(320px, 90vw);
          text-align: center;
          animation: fillo-celebration-pop 0.18s ease-out;
        }
        .fillo-tour {
          position: fixed;
          inset: 0;
          z-index: 2100;
        }
        .fillo-tour__highlight {
          position: fixed;
          border-radius: 12px;
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
          pointer-events: none;
          transition: all 140ms ease;
        }
        .fillo-tour__popover {
          max-width: min(360px, calc(100vw - 32px));
        }
        @keyframes fillo-celebration-pop {
          from {
            transform: scale(0.96);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes fillo-confetti-fall {
          to {
            transform: translate3d(var(--tx, 0px), 110vh, 0) rotate(540deg);
            opacity: 0;
          }
        }
      `}</style>
      <Container size="xl" py="xl" style={{ minHeight: '100vh' }}>
        <Stack gap="xl">
          <Group align="flex-start" justify="space-between" gap="xl" wrap="wrap">
            <Stack gap={4} style={{ flex: '1 1 320px', minWidth: 240 }}>
              <Title order={1}>{t('options.title')}</Title>
              <Text c="dimmed">{t('options.description')}</Text>
            </Stack>

            <Group gap="sm" align="center">
              <Badge variant="light" color={progressColor} radius="xl">
                {progressBadgeLabel}
              </Badge>
              <Button
                variant="default"
                onClick={handleStartTour}
              >
                {t('options.actions.startTour')}
              </Button>
              <Button
                ref={importButtonRef}
                variant="filled"
                onClick={handleCreateProfile}
                disabled={!providerConfigured || busy}
              >
                {t('options.actions.importResume')}
              </Button>
            </Group>
          </Group>

          <Flex gap="xl" align="flex-start" direction={{ base: 'column', md: 'row' }}>
          <Paper
            withBorder
            radius="lg"
            shadow="sm"
            p="md"
            w={{ base: '100%', md: 260 }}
            style={{ position: 'sticky', top: rem(32) }}
          >
            <Stack gap="xs">
              {navLinks.map((link) => (
                <NavLink
                  key={link.id}
                  label={link.label}
                  component="button"
                  type="button"
                  onClick={() => handleScrollTo(link.id)}
                  style={{ textAlign: 'left' }}
                />
              ))}
            </Stack>
          </Paper>

          <Stack flex={1} gap="xl">
            <Box id="section-getting-started" ref={setupSectionRef}>
              <Paper withBorder radius="lg" p="lg" shadow="sm">
                <Stack gap="md">
                  <div>
                    <Text fw={600} fz="xl">
                      {t('options.sections.gettingStarted')}
                    </Text>
                    <Text fz="sm" c="dimmed">
                      {t('options.gettingStarted.helper')}
                    </Text>
                  </div>
                  <Stack gap="md">
                    {setupChecklist.map((item) => (
                      <Group key={item.id} align="flex-start" gap="sm">
                        <ThemeIcon
                          size={32}
                          variant="light"
                          color={item.complete ? 'teal' : 'gray'}
                          radius="xl"
                        >
                          {item.complete ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                        </ThemeIcon>
                        <Stack gap={4} style={{ flex: 1 }}>
                          <Text fw={600}>{item.title}</Text>
                          <Text fz="sm" c="dimmed">
                            {item.description}
                          </Text>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => handleScrollTo(item.target)}
                          >
                            {t('options.checklist.openSection')}
                          </Button>
                        </Stack>
                      </Group>
                    ))}
                  </Stack>
                  <Text fz="sm" c="dimmed">
                    {t('options.gettingStarted.tip')}
                  </Text>
                </Stack>
              </Paper>
            </Box>

            <Box id="section-provider" ref={providerSectionRef}>
              <ProviderCard
                title={t('options.sections.provider')}
                helper={t('options.provider.helper')}
                providerLabels={providerLabels}
                selectedProvider={selectedProvider}
                canUseOnDevice={canUseOnDevice}
                onDeviceSupport={onDeviceSupport}
                openAi={{
                  apiKeyLabel: t('onboarding.openai.apiKey'),
                  apiKeyPlaceholder: t('onboarding.openai.apiKeyPlaceholder'),
                  modelLabel: t('onboarding.openai.model'),
                  baseUrlLabel: t('onboarding.openai.baseUrl'),
                  baseUrlPlaceholder: t('onboarding.openai.baseUrlPlaceholder'),
                  helper: t('onboarding.openai.helper'),
                  apiKey: openAiConfig.apiKey,
                  model: openAiConfig.model,
                  apiBaseUrl: openAiConfig.apiBaseUrl,
                  onApiKeyChange: handleOpenAiApiKeyChange,
                  onModelChange: handleOpenAiModelChange,
                  onApiBaseUrlChange: handleOpenAiApiBaseUrlChange,
                }}
                gemini={{
                  apiKeyLabel: t('onboarding.gemini.apiKey'),
                  apiKeyPlaceholder: t('onboarding.gemini.apiKeyPlaceholder'),
                  modelLabel: t('onboarding.gemini.model'),
                  helper: t('onboarding.gemini.helper'),
                  apiKey: geminiConfig.apiKey,
                  model: geminiConfig.model,
                  onApiKeyChange: handleGeminiApiKeyChange,
                  onModelChange: handleGeminiModelChange,
                }}
                onProviderChange={handleProviderChange}
              />
            </Box>

            <Box id="section-profiles" ref={profilesSectionRef}>
              <Stack gap="md">
                {providerConfigured ? (
                  <Stack gap="xl">
                    <ProfilesCard
                      title={t('onboarding.manage.heading')}
                      countLabel={t('onboarding.manage.count', [profileCountLabel])}
                      addLabel={t('onboarding.manage.addProfile')}
                      loadingLabel={t('onboarding.manage.loading')}
                      emptyLabel={t('onboarding.manage.empty')}
                      deleteLabel={t('onboarding.manage.delete')}
                      errorLabel={profilesErrorLabel}
                      profiles={profilesData}
                      isLoading={profilesState.loading}
                      busy={busy}
                      onCreate={handleCreateProfile}
                      onSelect={handleSelectProfile}
                      onDelete={handleDeleteProfile}
                    />

                    <Stack gap="md">
                      {selectedProfile ? (
                        <ProfileForm
                          form={form}
                          onSubmit={handleSaveForm}
                          onReset={handleResetForm}
                          disabled={busy}
                          saving={formSaving}
                          onFileSelect={handleFileSelect}
                          onParseAgain={canParseAgain ? openParseAgainConfirm : undefined}
                          parseAgainDisabled={!canParseAgain}
                          fileSummary={fileSummary}
                          rawSummary={rawSummary}
                        />
                      ) : (
                        <Paper withBorder radius="lg" p="lg" shadow="sm">
                          <Stack gap="sm">
                            <Text fw={600}>{t('options.profileForm.empty.heading')}</Text>
                            <Text fz="sm" c="dimmed">
                              {t('options.profileForm.empty.description')}
                            </Text>
                            <Button variant="light" onClick={handleCreateProfile} disabled={busy}>
                              {t('options.profileForm.empty.create')}
                            </Button>
                          </Stack>
                        </Paper>
                      )}

                      {validationErrors.length > 0 && (
                        <Alert variant="light" color="yellow">
                          <Stack gap="xs">
                            <Text fw={600}>{t('onboarding.validation.heading')}</Text>
                            <List spacing={4} size="sm">
                              {validationErrors.map((item) => (
                                <List.Item key={item}>{item}</List.Item>
                              ))}
                            </List>
                          </Stack>
                        </Alert>
                      )}
                    </Stack>
                  </Stack>
                ) : (
                  <Paper withBorder radius="lg" p="xl" shadow="sm">
                    <Stack gap="sm" align="center">
                      <Text fw={600} fz="lg" ta="center">
                        {t('options.profiles.gate.title')}
                      </Text>
                      <Text fz="sm" c="dimmed" ta="center">
                        {t('options.profiles.gate.description')}
                      </Text>
                      <Button onClick={() => handleScrollTo('section-provider')}>
                        {t('options.profiles.gate.cta')}
                      </Button>
                    </Stack>
                  </Paper>
                )}
              </Stack>
            </Box>

            <Box id="section-autofill" ref={autofillSectionRef}>
              <Stack gap="md">
                <div>
                  <Text fw={600} fz="xl">
                    {t('options.sections.autofill')}
                  </Text>
                  <Text fz="sm" c="dimmed">
                    {t('options.autofill.description')}
                  </Text>
                </div>
                <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl">
                  <AdaptersCard
                    title={t('options.adapters.heading')}
                    description={t('options.adapters.description')}
                    items={adapterItems}
                    onToggle={handleToggleAdapter}
                  />

                  <AutofillCard
                    title={t('options.autofill.heading')}
                    description={t('options.autofill.description')}
                    value={autoFallback}
                    skipLabel={t('options.autofill.skip')}
                    pauseLabel={t('options.autofill.pause')}
                    onChange={handleAutoFallbackChange}
                  />

                  <OverlayCard
                    title={translate('options.overlay.heading')}
                    description={translate('options.overlay.description')}
                    toggleLabel={translate('options.overlay.toggle')}
                    enabledHint={translate('options.overlay.enabled')}
                    disabledHint={translate('options.overlay.disabled')}
                    value={highlightOverlay}
                    onChange={handleHighlightOverlayChange}
                  />
                </SimpleGrid>
              </Stack>
            </Box>

            <Box id="section-advanced" ref={advancedSectionRef}>
              <Stack gap="md">
                <div>
                  <Text fw={600} fz="xl">
                    {t('options.sections.advanced')}
                  </Text>
                  <Text fz="sm" c="dimmed">
                    {t('options.advanced.description')}
                  </Text>
                </div>

                <MemoryCard
                  title={t('options.memory.heading')}
                  description={t('options.memory.description')}
                  refreshLabel={t('options.memory.refresh')}
                  clearLabel={t('options.memory.clearAll')}
                  deleteLabel={t('options.memory.delete')}
                  emptyLabel={t('options.memory.empty')}
                  loadingLabel={t('options.memory.loading')}
                  error={memoryState.error ? t('options.memory.error', [memoryState.error]) : undefined}
                  items={memoryItems}
                  loading={memoryState.loading}
                  onRefresh={() => {
                    void refreshMemoryItems();
                  }}
                  onClearAll={() => {
                    void handleClearMemory();
                  }}
                  onDelete={(key) => {
                    void handleDeleteMemory(key);
                  }}
                  formatEntry={formatMemoryEntry}
                />
                <Group gap="sm">
                  <Button variant="subtle" size="xs" onClick={handleResetOnboarding}>
                    {t('options.advanced.resetOnboarding')}
                  </Button>
                  <Button variant="subtle" size="xs" onClick={handleReplayCelebration}>
                    {t('options.advanced.replayCelebration')}
                  </Button>
                </Group>
              </Stack>
            </Box>
          </Stack>
        </Flex>
      </Stack>

      <Modal
          opened={filePromptOpen}
          onClose={closeFilePrompt}
          title={t('options.profileForm.upload.modalTitle')}
          centered
        >
          <Stack gap="md">
            <Text>{t('options.profileForm.upload.modalDescription')}</Text>
            <Stack gap="sm">
              <Button
                onClick={() => handleFileAction('parse')}
                disabled={busy}
              >
                {t('options.profileForm.upload.parseAction')}
              </Button>
              <Button
                variant="default"
                onClick={() => handleFileAction('store')}
                disabled={busy}
              >
                {t('options.profileForm.upload.storeAction')}
              </Button>
            </Stack>
          </Stack>
        </Modal>

      <Modal
        opened={parseAgainConfirmOpen}
        onClose={closeParseAgainConfirm}
        title={translate('options.profileForm.upload.parseAgainConfirmTitle')}
        centered
        >
          <Stack gap="md">
            <Text>{translate('options.profileForm.upload.parseAgainConfirmDescription')}</Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={closeParseAgainConfirm} disabled={busy}>
                {translate('options.profileForm.upload.parseAgainConfirmCancel')}
              </Button>
              <Button onClick={handleParseAgain} disabled={busy}>
                {translate('options.profileForm.upload.parseAgainConfirmConfirm')}
              </Button>
          </Group>
        </Stack>
      </Modal>

      {showCopyHelper && (
        <Affix position={{ bottom: 24, right: 24 }}>
          <Paper shadow="lg" radius="md" p="md" style={{ width: 280 }}>
            <Stack gap="sm">
              <Text fw={600}>{t('options.profileForm.copyHelper.heading')}</Text>
              <Text fz="sm" c="dimmed">
                {t('options.profileForm.copyHelper.description')}
              </Text>
              <Textarea
                value={rawText}
                readOnly
                autosize
                minRows={6}
                maxRows={12}
                spellCheck={false}
              />
              <CopyButton value={rawText}>
                {({ copied, copy }) => (
                  <Button onClick={copy} fullWidth variant={copied ? 'light' : 'filled'} color={copied ? 'green' : 'brand'}>
                    {copied
                      ? t('options.profileForm.copyHelper.copied')
                      : t('options.profileForm.copyHelper.copy')}
                  </Button>
                )}
              </CopyButton>
            </Stack>
          </Paper>
        </Affix>
      )}
    </Container>
      {celebrationOpen && (
        <Box
          className="fillo-celebration"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fillo-celebration-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setCelebrationOpen(false);
            }
          }}
        >
          <Box className="fillo-celebration__confetti">
            {confettiPieces.map((piece) => (
              <Box
                key={piece.id}
                className="fillo-confetto"
                style={
                  {
                    left: `${piece.left}%`,
                    animationDelay: `${piece.delay}s`,
                    backgroundColor: piece.color,
                    '--tx': `${piece.tx}px`,
                  } as CSSProperties & { '--tx': string }
                }
              />
            ))}
          </Box>
          <Paper className="fillo-celebration__card" shadow="xl" radius="lg" p="xl">
            <Stack gap="sm" align="center">
              <Title id="fillo-celebration-title" order={3}>
                {t('options.celebration.title')}
              </Title>
              <Text fz="sm" c="dimmed">
                {t('options.celebration.message')}
              </Text>
              <Button
                ref={celebrationButtonRef}
                onClick={() => {
                  setCelebrationOpen(false);
                  handleScrollTo('section-autofill');
                }}
              >
                {t('options.celebration.cta')}
              </Button>
            </Stack>
          </Paper>
        </Box>
      )}
      {tourState && currentTourStep && tourRect && tourPopoverStyle && (
        <Box
          className="fillo-tour"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fillo-tour-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleTourClose();
            }
          }}
        >
          <Box
            className="fillo-tour__highlight"
            style={{
              top: Math.max(8, tourRect.top),
              left: Math.max(8, tourRect.left),
              width: Math.max(1, tourRect.width),
              height: Math.max(1, tourRect.height),
            }}
          />
          <Paper
            className="fillo-tour__popover"
            shadow="xl"
            radius="lg"
            p="md"
            style={tourPopoverStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <Stack gap="sm">
              <Stack gap={4}>
                <Text fz="xs" c="dimmed">
                  {t('options.tour.progress', [tourStepNumber.toString(), tourStepCount.toString()])}
                </Text>
                <Text fw={600} id="fillo-tour-title">
                  {currentTourStep.title}
                </Text>
                <Text fz="sm" c="dimmed">
                  {currentTourStep.description}
                </Text>
              </Stack>
              <Group gap="xs" justify="space-between" align="center">
                <Button variant="subtle" size="xs" onClick={handleTourClose}>
                  {t('options.tour.close')}
                </Button>
                <Group gap="xs">
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={handleTourRetreat}
                    disabled={tourState.index === 0}
                  >
                    {t('options.tour.previous')}
                  </Button>
                  <Button size="xs" onClick={handleTourAdvance}>
                    {tourState.index === tourStepCount - 1
                      ? t('options.tour.done')
                      : t('options.tour.next')}
                  </Button>
                </Group>
              </Group>
            </Stack>
          </Paper>
        </Box>
      )}
    </>
  );
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
