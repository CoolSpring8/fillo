import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Affix,
  Alert,
  Button,
  Container,
  CopyButton,
  Group,
  List,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useForm } from '@mantine/form';
import { ensureOnDeviceAvailability, type LanguageModelAvailability } from '../../shared/llm/chromePrompt';
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
  getSettings,
  saveSettings,
  OPENAI_DEFAULT_BASE_URL,
} from '../../shared/storage/settings';
import { listAvailableAdapters } from '../../shared/apply/adapters';
import resumeSchema from '../../shared/schema/jsonresume-v1.json';
import { validateResume } from '../../shared/validate';
import type {
  AppSettings,
  ProviderConfig,
  ProviderSnapshot,
  ProfileRecord,
  ResumeExtractionResult,
} from '../../shared/types';
import { ProfilesCard, type ProfilesCardProfile } from './components/ProfilesCard';
import { ProviderCard } from './components/ProviderCard';
import { AdaptersCard, type AdapterItem } from './components/AdaptersCard';
import { AutofillCard } from './components/AutofillCard';
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

const STATUS_NOTIFICATION_ID = 'options-status';

function getStatusColor(phase: StatusPhase): string {
  if (phase === 'error') {
    return 'red';
  }
  if (phase === 'complete') {
    return 'green';
  }
  if (phase === 'idle') {
    return 'gray';
  }
  return 'brand';
}

function getStatusAutoClose(phase: StatusPhase): number | false {
  if (phase === 'error') {
    return 7000;
  }
  if (phase === 'complete') {
    return 5000;
  }
  if (phase === 'idle') {
    return 2000;
  }
  return false;
}

function buildOpenAIProvider(apiKey: string, model: string, apiBaseUrl: string): ProviderConfig {
  return createOpenAIProvider(apiKey, model, apiBaseUrl);
}

function buildSettings(
  kind: 'on-device' | 'openai',
  apiKey: string,
  model: string,
  apiBaseUrl: string,
  adapters: string[],
  autoFallback: AppSettings['autoFallback'],
): AppSettings {
  if (kind === 'openai') {
    return { provider: buildOpenAIProvider(apiKey, model, apiBaseUrl), adapters, autoFallback };
  }
  return { provider: { kind: 'on-device' }, adapters, autoFallback };
}

export default function App() {
  const form = useForm<ResumeFormValues>({
    initialValues: createEmptyResumeFormValues(),
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'on-device' | 'openai'>('on-device');
  const [availability, setAvailability] = useState<LanguageModelAvailability>('unavailable');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(OPENAI_DEFAULT_MODEL);
  const [apiBaseUrl, setApiBaseUrl] = useState(OPENAI_DEFAULT_BASE_URL);
  const adapters = useMemo(() => listAvailableAdapters(), []);
  const defaultAdapterIds = useMemo(() => adapters.map((adapter) => adapter.id), [adapters]);
  const [activeAdapters, setActiveAdapters] = useState<string[]>(defaultAdapterIds);
  const [autoFallback, setAutoFallback] = useState<AppSettings['autoFallback']>('skip');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [filePromptOpen, setFilePromptOpen] = useState(false);
  const [parseAgainConfirmOpen, setParseAgainConfirmOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [profilesState, setProfilesState] = useState<{ loading: boolean; error?: string }>({
    loading: true,
  });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ phase: 'idle', message: '' });
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const statusNotificationVisibleRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<'upload' | 'parse' | 'save' | null>(null);
  const [rawText, setRawText] = useState('');
  const [activeTab, setActiveTab] = useState<'profiles' | 'settings'>('profiles');
  const { t } = i18n;
  const translate = t as unknown as (key: string, substitutions?: unknown) => string;
  const providerLabels: Record<'on-device' | 'openai', string> = {
    'on-device': t('options.provider.onDevice'),
    openai: t('options.provider.openai'),
  };

  const refreshProfiles = useCallback(
    async (preferredId?: string) => {
      setProfilesState((state) => ({ ...state, loading: true, error: undefined }));
      try {
        const list = await listProfiles();
        setProfiles(list);
        setProfilesState({ loading: false });
        setSelectedProfileId((current) => {
          if (preferredId && list.some((profile) => profile.id === preferredId)) {
            return preferredId;
          }
          if (current && list.some((profile) => profile.id === current)) {
            return current;
          }
          return list.length > 0 ? list[0].id : null;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesState({ loading: false, error: message });
      }
    },
    [],
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
      form.setValues(empty);
      form.resetDirty(empty);
      setRawText('');
      return;
    }
    const values = resumeToFormValues(selectedProfile.resume);
    form.setValues(values);
    form.resetDirty(values);
    setRawText(selectedProfile.rawText);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfile]);

  useEffect(() => {
    getSettings().then((loaded) => {
      setSettings(loaded);
      if (loaded.provider.kind === 'openai') {
        setSelectedProvider('openai');
        setApiKey(loaded.provider.apiKey);
        setModel(loaded.provider.model);
        setApiBaseUrl(loaded.provider.apiBaseUrl);
      } else {
        setSelectedProvider('on-device');
        setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
      }
      setActiveAdapters(loaded.adapters.length > 0 ? loaded.adapters : defaultAdapterIds);
      setAutoFallback(loaded.autoFallback ?? 'skip');
    });
    ensureOnDeviceAvailability().then(setAvailability);
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
    if (!status.message) {
      if (statusNotificationVisibleRef.current) {
        notifications.hide(STATUS_NOTIFICATION_ID);
        statusNotificationVisibleRef.current = false;
      }
      return;
    }

    const payload = {
      id: STATUS_NOTIFICATION_ID,
      color: getStatusColor(status.phase),
      title: status.message,
      message: errorDetails ?? undefined,
      autoClose: getStatusAutoClose(status.phase),
      withCloseButton: true,
    };

    if (statusNotificationVisibleRef.current) {
      notifications.update(payload);
    } else {
      notifications.show(payload);
      statusNotificationVisibleRef.current = true;
    }
  }, [status, errorDetails]);

  useEffect(() => {
    return () => {
      if (statusNotificationVisibleRef.current) {
        notifications.hide(STATUS_NOTIFICATION_ID);
        statusNotificationVisibleRef.current = false;
      }
    };
  }, []);

  const handleProviderChange = async (value: 'on-device' | 'openai') => {
    setSelectedProvider(value);
    const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
    if (value === 'on-device') {
      setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
      const next = buildSettings('on-device', '', OPENAI_DEFAULT_MODEL, OPENAI_DEFAULT_BASE_URL, adaptersToUse, autoFallback);
      setSettings(next);
      await saveSettings(next);
    } else {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      setApiBaseUrl(nextBase);
      const next = buildSettings('openai', apiKey, model, nextBase, adaptersToUse, autoFallback);
      setSettings(next);
      await saveSettings(next);
    }
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (selectedProvider === 'openai') {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const next = buildSettings('openai', value, model, nextBase, adaptersToUse, autoFallback);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleModelChange = (value: string) => {
    setModel(value);
    if (selectedProvider === 'openai') {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const next = buildSettings('openai', apiKey, value, nextBase, adaptersToUse, autoFallback);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleApiBaseUrlChange = (value: string) => {
    setApiBaseUrl(value);
    if (selectedProvider === 'openai') {
      const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
      const next = buildSettings('openai', apiKey, model, value, adaptersToUse, autoFallback);
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
      const baseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const nextSettings =
        selectedProvider === 'openai'
          ? buildSettings('openai', apiKey, model, baseUrl, resolved, autoFallback)
          : buildSettings('on-device', '', OPENAI_DEFAULT_MODEL, OPENAI_DEFAULT_BASE_URL, resolved, autoFallback);
      setSettings(nextSettings);
      void saveSettings(nextSettings);
      return resolved;
    });
  };

  const handleAutoFallbackChange = (value: AppSettings['autoFallback']) => {
    setAutoFallback(value);
    const adaptersToUse = activeAdapters.length > 0 ? activeAdapters : defaultAdapterIds;
    const baseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
    const nextSettings =
      selectedProvider === 'openai'
        ? buildSettings('openai', apiKey, model, baseUrl, adaptersToUse, value)
        : buildSettings('on-device', '', OPENAI_DEFAULT_MODEL, OPENAI_DEFAULT_BASE_URL, adaptersToUse, value);
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
            ? apiKey.trim().length > 0
            : availability !== 'unavailable';
        if (!canParse) {
          parseErrorMessage = t('options.profileForm.status.parseUnavailable');
        } else {
          setStatus({ phase: 'parsing', message: t('options.profileForm.status.parsing') });
          try {
            const messages = buildResumePrompt(text);
            const baseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
            const providerConfig: ProviderConfig =
              selectedProvider === 'openai'
                ? createOpenAIProvider(apiKey, model, baseUrl)
                : createOnDeviceProvider();

            const raw = await invokeWithProvider(providerConfig, messages, {
              responseSchema: resumeSchema,
              temperature: 0,
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
                : { kind: 'on-device' };

            const formValues = resumeToFormValues(resume);
            const mergedValues = mergeResumeFormValues(form.getValues(), formValues);
            form.setValues(mergedValues);
            form.resetDirty(mergedValues);

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
        ? apiKey.trim().length > 0
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
      const baseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const providerConfig: ProviderConfig =
        selectedProvider === 'openai'
          ? createOpenAIProvider(apiKey, model, baseUrl)
          : createOnDeviceProvider();

      const raw = await invokeWithProvider(providerConfig, messages, {
        responseSchema: resumeSchema,
        temperature: 0,
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
          : { kind: 'on-device' };

      const parsedValues = resumeToFormValues(resume);
      const mergedValues = mergeResumeFormValues(form.getValues(), parsedValues);
      form.setValues(mergedValues);
      form.resetDirty(mergedValues);

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
      form.resetDirty(values);

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
      form.setValues(empty);
      form.resetDirty(empty);
      return;
    }
    const values = resumeToFormValues(selectedProfile.resume);
    form.setValues(values);
    form.resetDirty(values);
  };

  const handleSelectProfile = (id: string) => {
    setSelectedProfileId(id);
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
    setStatus({ phase: 'complete', message: t('options.profileForm.status.profileCreated') });
    setErrorDetails(null);
    await refreshProfiles(id);
  };

  const canUseOnDevice = availability !== 'unavailable';
  const onDeviceNote =
    availability === 'downloadable'
      ? t('onboarding.provider.onDevice.downloadable')
      : availability === 'downloading'
        ? t('onboarding.provider.onDevice.downloading')
        : availability === 'unavailable'
          ? t('onboarding.provider.onDevice.unavailable')
          : null;

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
    return parsedAt
      ? t('onboarding.manage.parsedOnDeviceAt', [parsedAt])
      : t('onboarding.manage.parsedOnDevice');
  };

  const profileCountLabel = profiles.length.toLocaleString();

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

  const canParseWithCurrentSettings =
    selectedProvider === 'openai'
      ? apiKey.trim().length > 0
      : availability !== 'unavailable';

  const showCopyHelper = Boolean(selectedProfile && rawText.trim().length > 0 && !canParseWithCurrentSettings);

  const profilesErrorLabel = profilesState.error
    ? t('onboarding.manage.error', [profilesState.error])
    : undefined;

  return (
    <Container size="lg" py="xl" style={{ minHeight: '100vh' }}>
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={1}>{t('onboarding.title')}</Title>
          <Text c="dimmed">{t('onboarding.description')}</Text>
        </Stack>

        <Tabs value={activeTab} onChange={(value) => setActiveTab((value ?? 'profiles') as 'profiles' | 'settings')}>
          <Tabs.List>
            <Tabs.Tab value="profiles">{t('onboarding.tabs.profiles')}</Tabs.Tab>
            <Tabs.Tab value="settings">{t('onboarding.tabs.aiSettings')}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="profiles">
            <Stack gap="xl" pt="md">
              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="xl">
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
              </SimpleGrid>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="settings">
            <Stack gap="xl" pt="md">
              <ProviderCard
                title={t('onboarding.parse.heading')}
                helper={t('onboarding.parse.helper')}
                providerLabels={providerLabels}
                selectedProvider={selectedProvider}
                canUseOnDevice={canUseOnDevice}
                onDeviceNote={onDeviceNote}
                apiKeyLabel={t('onboarding.openai.apiKey')}
                apiKeyPlaceholder={t('onboarding.openai.apiKeyPlaceholder')}
                modelLabel={t('onboarding.openai.model')}
                baseUrlLabel={t('onboarding.openai.baseUrl')}
                baseUrlPlaceholder={t('onboarding.openai.baseUrlPlaceholder')}
                openAiHelper={t('onboarding.openai.helper')}
                apiKey={apiKey}
                model={model}
                apiBaseUrl={apiBaseUrl}
                onProviderChange={handleProviderChange}
                onApiKeyChange={handleApiKeyChange}
                onModelChange={handleModelChange}
                onApiBaseUrlChange={handleApiBaseUrlChange}
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
              </SimpleGrid>
            </Stack>
          </Tabs.Panel>
        </Tabs>

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
      </Stack>

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
