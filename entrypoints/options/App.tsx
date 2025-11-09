import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  Affix,
  Alert,
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
import {
  CheckCircle2,
  Circle,
  Compass,
  Cpu,
  IdCard,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
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

type TocNavLink = {
  id: string;
  label: string;
  ref: RefObject<HTMLDivElement | null>;
  icon: LucideIcon;
  color: string;
};

interface SectionHeadingProps {
  icon: LucideIcon;
  color: string;
  title: string;
  description?: string;
}

function SectionHeading({ icon: Icon, color, title, description }: SectionHeadingProps) {
  return (
    <Stack gap={4}>
      <Group gap="xs" align="center">
        <ThemeIcon size={36} radius="xl" variant="light" color={color}>
          <Icon size={18} strokeWidth={2} />
        </ThemeIcon>
        <Text fw={600} fz="xl">
          {title}
        </Text>
      </Group>
      {description ? (
        <Text fz="sm" c="dimmed">
          {description}
        </Text>
      ) : null}
    </Stack>
  );
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
  const statusNotificationId = useRef<string | null>(null);
  const [highlightedSection, setHighlightedSection] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
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

  const navLinks = useMemo<TocNavLink[]>(
    () => [
      {
        id: 'section-getting-started',
        label: t('options.sections.gettingStarted'),
        ref: setupSectionRef,
        icon: Sparkles,
        color: 'orange',
      },
      {
        id: 'section-provider',
        label: t('options.sections.provider'),
        ref: providerSectionRef,
        icon: Cpu,
        color: 'brand',
      },
      {
        id: 'section-profiles',
        label: t('options.sections.profiles'),
        ref: profilesSectionRef,
        icon: IdCard,
        color: 'indigo',
      },
      {
        id: 'section-autofill',
        label: t('options.sections.autofill'),
        ref: autofillSectionRef,
        icon: WandSparkles,
        color: 'teal',
      },
      {
        id: 'section-advanced',
        label: t('options.sections.advanced'),
        ref: advancedSectionRef,
        icon: SlidersHorizontal,
        color: 'gray',
      },
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
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const triggerSectionHighlight = useCallback((id: string) => {
    setHighlightedSection(id);
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedSection((current) => (current === id ? null : current));
    }, 1600);
  }, []);

  const handleScrollTo = useCallback(
    (id: string) => {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        triggerSectionHighlight(id);
      }
    },
    [triggerSectionHighlight],
  );

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
  const sectionClassName = useCallback(
    (id: string) =>
      highlightedSection === id
        ? 'fillo-options__section fillo-options__section--highlighted'
        : 'fillo-options__section',
    [highlightedSection],
  );

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
        .fillo-options__toc {
          position: relative;
          border: 1px solid var(--mantine-color-gray-3);
          background-color: var(--mantine-color-body);
        }
        .fillo-options__toc-content {
          position: relative;
          z-index: 1;
        }
        .fillo-options__toc-link {
          border-radius: 12px;
          padding-block: 8px;
          transition: background-color 120ms ease, transform 120ms ease;
        }
        .fillo-options__toc-link:hover {
          background-color: var(--mantine-color-gray-0);
          transform: translateX(2px);
        }
        .fillo-options__section {
          position: relative;
          border-radius: 12px;
          z-index: 0;
        }
        .fillo-options__section::after {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 16px;
          background-color: transparent;
          box-shadow: none;
          transition: background-color 200ms ease;
          pointer-events: none;
          z-index: -1;
        }
        .fillo-options__section--highlighted::after {
          background-color: var(--mantine-color-brand-0);
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

          </Group>

          <Flex gap="xl" align="flex-start" direction={{ base: 'column', md: 'row' }}>
          <Paper
            withBorder
            radius="lg"
            shadow="sm"
            p="md"
            w={{ base: '100%', md: 260 }}
            style={{ position: 'sticky', top: rem(32) }}
            className="fillo-options__toc"
          >
            <Stack gap="md" className="fillo-options__toc-content">
              <Stack gap={4}>
                <Group gap="xs" align="center">
                  <ThemeIcon size={32} radius="xl" variant="light" color="brand">
                    <Compass size={18} strokeWidth={2} />
                  </ThemeIcon>
                  <Text fw={600}>{t('options.toc.title')}</Text>
                </Group>
                <Text fz="xs" c="dimmed">
                  {t('options.toc.helper')}
                </Text>
              </Stack>
              <Stack gap="xs">
                {navLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <NavLink
                      key={link.id}
                      label={link.label}
                      component="button"
                      type="button"
                      onClick={() => handleScrollTo(link.id)}
                      style={{ textAlign: 'left' }}
                      className="fillo-options__toc-link"
                      leftSection={
                        <ThemeIcon size={30} radius="lg" variant="light" color={link.color}>
                          <Icon size={16} strokeWidth={2} />
                        </ThemeIcon>
                      }
                    />
                  );
                })}
              </Stack>
            </Stack>
          </Paper>

          <Stack flex={1} gap="xl">
            <Box
              id="section-getting-started"
              ref={setupSectionRef}
              className={sectionClassName('section-getting-started')}
            >
              <Paper withBorder radius="lg" p="lg" shadow="sm">
                <Stack gap="md">
                  <SectionHeading
                    icon={Sparkles}
                    color="orange"
                    title={t('options.sections.gettingStarted')}
                    description={t('options.gettingStarted.helper')}
                  />
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

            <Box
              id="section-provider"
              ref={providerSectionRef}
              className={sectionClassName('section-provider')}
            >
              <ProviderCard
                title={t('options.sections.provider')}
                helper={t('options.provider.helper')}
                headingIcon={Cpu}
                headingIconColor="brand"
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

            <Box
              id="section-profiles"
              ref={profilesSectionRef}
              className={sectionClassName('section-profiles')}
            >
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
                      headingIcon={IdCard}
                      headingIconColor="indigo"
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
                      <ThemeIcon size={48} radius="xl" variant="light" color="indigo">
                        <IdCard size={22} strokeWidth={2} />
                      </ThemeIcon>
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

            <Box
              id="section-autofill"
              ref={autofillSectionRef}
              className={sectionClassName('section-autofill')}
            >
              <Stack gap="md">
                <SectionHeading
                  icon={WandSparkles}
                  color="teal"
                  title={t('options.sections.autofill')}
                  description={t('options.autofill.description')}
                />
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

            <Box
              id="section-advanced"
              ref={advancedSectionRef}
              className={sectionClassName('section-advanced')}
            >
              <Stack gap="md">
                <SectionHeading
                  icon={SlidersHorizontal}
                  color="gray"
                  title={t('options.sections.advanced')}
                  description={t('options.advanced.description')}
                />

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
