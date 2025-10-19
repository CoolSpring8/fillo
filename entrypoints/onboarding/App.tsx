import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Container, List, Stack, Text, Title } from '@mantine/core';
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
import { getAllAdapterIds } from '../../shared/apply/slots';
import { OUTPUT_SCHEMA } from '../../shared/schema/outputSchema';
import { validateResume } from '../../shared/validate';
import type {
  AppSettings,
  ProviderConfig,
  ProviderSnapshot,
  ProfileRecord,
  ResumeExtractionResult,
} from '../../shared/types';
import { ProfilesCard, type ProfilesCardProfile } from './components/ProfilesCard';
import { UploadCard } from './components/UploadCard';
import { ProviderCard } from './components/ProviderCard';
import { EditProfileCard } from './components/EditProfileCard';

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

type StatusPhase = 'idle' | 'extracting' | 'parsing' | 'saving' | 'complete' | 'error';

interface StatusState {
  phase: StatusPhase;
  message: string;
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
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'on-device' | 'openai'>('on-device');
  const [availability, setAvailability] = useState<LanguageModelAvailability>('unavailable');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(OPENAI_DEFAULT_MODEL);
  const [apiBaseUrl, setApiBaseUrl] = useState(OPENAI_DEFAULT_BASE_URL);
  const [file, setFile] = useState<File | null>(null);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [profilesState, setProfilesState] = useState<{ loading: boolean; error?: string }>({
    loading: true,
  });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ phase: 'idle', message: '' });
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<'extract' | 'parse' | 'edit' | null>(null);
  const [rawDraft, setRawDraft] = useState('');
  const [resumeDraft, setResumeDraft] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const { t } = i18n;
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
      setRawDraft('');
      setResumeDraft('');
      setCustomDraft('');
      setDraftDirty(false);
      setDraftError(null);
      return;
    }
    setRawDraft(selectedProfile.rawText);
    setResumeDraft(formatJson(selectedProfile.resume));
    setCustomDraft(formatJson(selectedProfile.custom));
    setDraftDirty(false);
    setDraftError(null);
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
    });
    ensureOnDeviceAvailability().then(setAvailability);
    void refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    const listener = () => {
      void refreshProfiles();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refreshProfiles]);

  const handleProviderChange = async (value: 'on-device' | 'openai') => {
    setSelectedProvider(value);
    if (value === 'on-device') {
      setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const fallback = settings?.autoFallback ?? 'skip';
      const next = buildSettings('on-device', '', OPENAI_DEFAULT_MODEL, OPENAI_DEFAULT_BASE_URL, adapters, fallback);
      setSettings(next);
      await saveSettings(next);
    } else {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      setApiBaseUrl(nextBase);
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const fallback = settings?.autoFallback ?? 'skip';
      const next = buildSettings('openai', apiKey, model, nextBase, adapters, fallback);
      setSettings(next);
      await saveSettings(next);
    }
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (selectedProvider === 'openai') {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const fallback = settings?.autoFallback ?? 'skip';
      const next = buildSettings('openai', value, model, nextBase, adapters, fallback);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleModelChange = (value: string) => {
    setModel(value);
    if (selectedProvider === 'openai') {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const fallback = settings?.autoFallback ?? 'skip';
      const next = buildSettings('openai', apiKey, value, nextBase, adapters, fallback);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleApiBaseUrlChange = (value: string) => {
    setApiBaseUrl(value);
    if (selectedProvider === 'openai') {
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const fallback = settings?.autoFallback ?? 'skip';
      const next = buildSettings('openai', apiKey, model, value, adapters, fallback);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleFileSelect = (nextFile: File | null) => {
    setFile(nextFile);
    setStatus({ phase: 'idle', message: '' });
    setErrorDetails(null);
  };

  const handleExtract = async () => {
    if (!file) {
      return;
    }
    setBusy(true);
    setBusyAction('extract');
    setErrorDetails(null);

    try {
      setStatus({ phase: 'extracting', message: t('onboarding.status.extracting') });
      const { text } = await extractTextFromPdf(file);

      if (!text.trim()) {
        throw new Error(t('onboarding.errors.noText'));
      }

      setStatus({ phase: 'saving', message: t('onboarding.status.savingExtraction') });
      const id = crypto.randomUUID();
      const fileRef = await storeFile(id, file);
      const profile: ProfileRecord = {
        id,
        createdAt: new Date().toISOString(),
        sourceFile: fileRef,
        rawText: text,
      };

      await saveProfile(profile);
      await refreshProfiles(id);

      const adapterIds = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const fallback = settings?.autoFallback ?? 'skip';
      const nextSettings = buildSettings(
        selectedProvider,
        apiKey,
        model,
        apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL,
        adapterIds,
        fallback,
      );
      setSettings(nextSettings);
      await saveSettings(nextSettings);

      setStatus({
        phase: 'complete',
        message: t('onboarding.status.extractionComplete'),
      });
      setFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ phase: 'error', message: t('onboarding.status.extractionFailed') });
      setErrorDetails(message);
      console.error(error);
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const handleParse = async () => {
    if (!selectedProfile) {
      return;
    }
    if (selectedProvider === 'openai' && !apiKey) {
      setStatus({ phase: 'error', message: t('onboarding.status.requireApiKey') });
      setErrorDetails(null);
      return;
    }
    if (draftDirty) {
      setStatus({ phase: 'error', message: t('onboarding.status.saveBeforeParse') });
      setErrorDetails(null);
      return;
    }
    setBusy(true);
    setBusyAction('parse');
    setErrorDetails(null);

    try {
      setStatus({ phase: 'parsing', message: t('onboarding.status.parsing') });
      const messages = buildResumePrompt(selectedProfile.rawText);

      const baseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const providerConfig: ProviderConfig =
        selectedProvider === 'openai'
          ? createOpenAIProvider(apiKey, model, baseUrl)
          : createOnDeviceProvider();

      const raw = await invokeWithProvider(providerConfig, messages, {
        responseSchema: OUTPUT_SCHEMA,
        temperature: 0,
      });

      const parsed = JSON.parse(raw) as ResumeExtractionResult;
      const result: ResumeExtractionResult = {
        resume: parsed.resume ?? {},
        custom: parsed.custom ?? {},
      };

      const providerSnapshot: ProviderSnapshot =
        providerConfig.kind === 'openai'
          ? { kind: 'openai', model: providerConfig.model, apiBaseUrl: providerConfig.apiBaseUrl }
          : { kind: 'on-device' };

      setStatus({ phase: 'saving', message: t('onboarding.status.savingParsing') });
      const validation = validateResume(result.resume);

      const profile: ProfileRecord = {
        ...selectedProfile,
        provider: providerSnapshot,
        parsedAt: new Date().toISOString(),
        resume: result.resume ?? {},
        custom: result.custom ?? {},
        validation: {
          valid: validation.valid,
          errors: validation.errors,
        },
      };

      await saveProfile(profile);
      await refreshProfiles(profile.id);

      const adapterIds = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const fallback = settings?.autoFallback ?? 'skip';
      const nextSettings = buildSettings(
        selectedProvider,
        apiKey,
        model,
        apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL,
        adapterIds,
        fallback,
      );
      setSettings(nextSettings);
      await saveSettings(nextSettings);

      setStatus({
        phase: 'complete',
        message: t('onboarding.status.parsingComplete'),
      });
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
        const statusMessage =
          error instanceof ProviderInvocationError ? error.message : t('onboarding.status.parsingFailed');
        setStatus({ phase: 'error', message: statusMessage });
        setErrorDetails(error instanceof ProviderInvocationError ? null : message);
      }
      console.error(error);
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const handleSelectProfile = (id: string) => {
    setSelectedProfileId(id);
  };

  const handleDeleteProfile = async (id: string) => {
    await deleteProfile(id);
    setStatus({ phase: 'complete', message: t('onboarding.status.profileDeleted') });
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
      custom: {},
    };
    await saveProfile(profile);
    setStatus({ phase: 'complete', message: t('onboarding.status.profileCreated') });
    setErrorDetails(null);
    await refreshProfiles(id);
  };

  const handleRawDraftChange = (value: string) => {
    setRawDraft(value);
    setDraftDirty(true);
  };

  const handleResumeDraftChange = (value: string) => {
    setResumeDraft(value);
    setDraftDirty(true);
  };

  const handleCustomDraftChange = (value: string) => {
    setCustomDraft(value);
    setDraftDirty(true);
  };

  const handleResetDrafts = () => {
    if (!selectedProfile) {
      return;
    }
    setRawDraft(selectedProfile.rawText);
    setResumeDraft(formatJson(selectedProfile.resume));
    setCustomDraft(formatJson(selectedProfile.custom));
    setDraftDirty(false);
    setDraftError(null);
  };

  const handleSaveDrafts = async () => {
    if (!selectedProfile) {
      return;
    }
    try {
      const nextResume = parseResumeDraft(resumeDraft);
      const nextCustom = parseCustomDraft(customDraft);
      setBusy(true);
      setBusyAction('edit');
      setStatus({ phase: 'saving', message: t('onboarding.status.savingEdits') });
      setDraftError(null);

      const validation = nextResume ? validateResume(nextResume) : selectedProfile.validation;
      const updated: ProfileRecord = {
        ...selectedProfile,
        rawText: rawDraft,
        resume: nextResume,
        custom: nextCustom,
        parsedAt: nextResume ? new Date().toISOString() : selectedProfile.parsedAt,
        validation: nextResume
          ? {
              valid: validation?.valid ?? true,
              errors: validation?.errors,
            }
          : selectedProfile.validation,
      };

      await saveProfile(updated);
      await refreshProfiles(updated.id);
      setDraftDirty(false);
      setStatus({ phase: 'complete', message: t('onboarding.status.savedEdits') });
      setErrorDetails(null);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setDraftError(t('onboarding.edit.invalidJson'));
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setDraftError(message);
      }
      setStatus({ phase: 'error', message: t('onboarding.status.editFailed') });
      setErrorDetails(null);
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
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

  const activeRawLength = selectedProfile ? selectedProfile.rawText.length.toLocaleString() : null;

  const profileCountLabel = profiles.length.toLocaleString();

  const profilesData: ProfilesCardProfile[] = profiles.map((profile) => ({
    id: profile.id,
    name: resolveProfileName(profile),
    summary: formatProfileSummary(profile),
    parsing: formatProfileParsing(profile),
    isActive: selectedProfile?.id === profile.id,
  }));

  const currentSummary =
    selectedProfile && activeRawLength
      ? t('onboarding.upload.current', [resolveProfileName(selectedProfile), activeRawLength])
      : null;

  const workingLabel = t('onboarding.buttons.working');
  const uploadWorking = busy && busyAction === 'extract';
  const parseWorking = busy && busyAction === 'parse';
  const editWorking = busy && busyAction === 'edit';

  const parseDisabled =
    busy || !selectedProfile || draftDirty || (selectedProvider === 'openai' && !apiKey);

  const parseWarning =
    selectedProfile && draftDirty ? t('onboarding.parse.needsSave') : null;
  const parseHint =
    selectedProfile && !draftDirty
      ? t('onboarding.parse.summary', [resolveProfileName(selectedProfile)])
      : null;
  const needProfileMessage = !selectedProfile ? t('onboarding.parse.needProfile') : null;

  const profilesErrorLabel = profilesState.error
    ? t('onboarding.manage.error', [profilesState.error])
    : undefined;

  const statusColor =
    status.phase === 'error'
      ? 'red'
      : status.phase === 'complete'
        ? 'green'
        : status.phase === 'idle'
          ? 'gray'
          : 'blue';

  return (
    <Container size="lg" py="xl" style={{ minHeight: '100vh' }}>
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={1}>{t('onboarding.title')}</Title>
          <Text c="dimmed">{t('onboarding.description')}</Text>
        </Stack>

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

        <UploadCard
          title={t('onboarding.upload.heading')}
          helper={t('onboarding.upload.helper')}
          buttonLabel={t('onboarding.upload.button')}
          workingLabel={workingLabel}
          isWorking={uploadWorking}
          currentSummary={currentSummary}
          file={file}
          busy={busy}
          onExtract={handleExtract}
          onFileSelect={handleFileSelect}
        />

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
          workingLabel={workingLabel}
          parseButtonLabel={t('onboarding.parse.button')}
          parseWarning={parseWarning}
          parseHint={parseHint}
          needProfileMessage={needProfileMessage}
          isWorking={parseWorking}
          disabled={parseDisabled}
          onProviderChange={handleProviderChange}
          onApiKeyChange={handleApiKeyChange}
          onModelChange={handleModelChange}
          onApiBaseUrlChange={handleApiBaseUrlChange}
          onParse={handleParse}
        />

        {selectedProfile && (
          <EditProfileCard
            title={t('onboarding.edit.heading', [resolveProfileName(selectedProfile)])}
            helper={t('onboarding.edit.helper', [activeRawLength ?? '0'])}
            rawLabel={t('onboarding.edit.rawLabel')}
            rawValue={rawDraft}
            rawSummary={t('onboarding.edit.rawSummary', [rawDraft.length.toLocaleString()])}
            resumeLabel={t('onboarding.edit.resumeLabel')}
            resumeValue={resumeDraft}
            resumeHelper={t('onboarding.edit.resumeHelper')}
            customLabel={t('onboarding.edit.customLabel')}
            customValue={customDraft}
            customHelper={t('onboarding.edit.customHelper')}
            saveLabel={t('onboarding.edit.save')}
            resetLabel={t('onboarding.edit.reset')}
            workingLabel={workingLabel}
            disabledSave={!draftDirty || busy}
            disabledReset={!draftDirty || busy}
            isWorking={editWorking}
            errorMessage={draftError}
            onSave={handleSaveDrafts}
            onReset={handleResetDrafts}
            onRawChange={handleRawDraftChange}
            onResumeChange={handleResumeDraftChange}
            onCustomChange={handleCustomDraftChange}
          />
        )}

        {status.message && (
          <Alert variant="light" color={statusColor}>
            <Stack gap={4}>
              <Text fw={600}>{status.message}</Text>
              {errorDetails && (
                <Text fz="sm" c="dimmed">
                  {errorDetails}
                </Text>
              )}
            </Stack>
          </Alert>
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
    </Container>
  );
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function parseResumeDraft(source: string): unknown {
  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }
  return JSON.parse(trimmed);
}

function parseCustomDraft(source: string): Record<string, unknown> | undefined {
  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = JSON.parse(trimmed);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new SyntaxError('Custom fields must be a JSON object');
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
