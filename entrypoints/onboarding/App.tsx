import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  ensureOnDeviceAvailability,
  promptOnDevice,
  type LanguageModelAvailability,
} from '../../shared/llm/chromePrompt';
import { promptOpenAI } from '../../shared/llm/openai';
import { buildResumePrompt } from '../../shared/llm/prompt';
import { extractTextFromPdf } from '../../shared/pdf/extractText';
import { deleteProfile, listProfiles, saveProfile, storeFile } from '../../shared/storage/profiles';
import {
  createOpenAIProvider,
  getSettings,
  saveSettings,
  OPENAI_DEFAULT_BASE_URL,
} from '../../shared/storage/settings';
import { getAllAdapterIds } from '../../shared/apply/slots';
import { validateResume } from '../../shared/validate';
import type {
  AppSettings,
  ProviderConfig,
  ProviderSnapshot,
  ProfileRecord,
  ResumeExtractionResult,
} from '../../shared/types';

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  const handleProviderChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value as 'on-device' | 'openai';
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setStatus({ phase: 'idle', message: '' });
    setErrorDetails(null);
  };

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setFile(null);
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
      resetFileInput();
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

      let result: ResumeExtractionResult;
      let providerSnapshot: ProviderSnapshot;
      if (selectedProvider === 'on-device') {
        result = await promptOnDevice(messages);
        providerSnapshot = { kind: 'on-device' };
      } else {
        const openAiBaseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
        result = await promptOpenAI(
          { apiKey, model, apiBaseUrl: openAiBaseUrl },
          messages,
        );
        providerSnapshot = { kind: 'openai', model, apiBaseUrl: openAiBaseUrl };
      }

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
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ phase: 'error', message: t('onboarding.status.parsingFailed') });
      setErrorDetails(message);
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

  return (
    <div className="onboarding-container">
      <header>
        <h1>{t('onboarding.title')}</h1>
        <p>{t('onboarding.description')}</p>
      </header>

      <section className="card">
        <div className="card-heading">
          <div>
            <h2>{t('onboarding.manage.heading')}</h2>
            <p className="helper-text">
              {t('onboarding.manage.count', [profileCountLabel])}
            </p>
          </div>
          <button type="button" className="ghost" onClick={handleCreateProfile} disabled={busy}>
            {t('onboarding.manage.addProfile')}
          </button>
        </div>
        {profilesState.loading && <p className="helper-text">{t('onboarding.manage.loading')}</p>}
        {profilesState.error && (
          <p className="error-text">{t('onboarding.manage.error', [profilesState.error])}</p>
        )}
        {!profilesState.loading && profiles.length === 0 && (
          <p className="helper-text">{t('onboarding.manage.empty')}</p>
        )}
        {profiles.length > 0 && (
          <div className="profile-list">
            {profiles.map((profile) => {
              const isActive = selectedProfile?.id === profile.id;
              return (
                <div key={profile.id} className={`profile-row ${isActive ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="profile-select"
                    onClick={() => handleSelectProfile(profile.id)}
                    aria-pressed={isActive}
                  >
                    <span className="profile-title">{resolveProfileName(profile)}</span>
                    <span className="profile-meta">{formatProfileSummary(profile)}</span>
                    <span className="profile-meta">{formatProfileParsing(profile)}</span>
                  </button>
                  <button
                    type="button"
                    className="danger-link"
                    disabled={busy}
                    onClick={() => handleDeleteProfile(profile.id)}
                  >
                    {t('onboarding.manage.delete')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t('onboarding.upload.heading')}</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
        />
        <button type="button" disabled={busy || !file} onClick={handleExtract}>
          {busy && busyAction === 'extract' ? t('onboarding.buttons.working') : t('onboarding.upload.button')}
        </button>
        <p className="helper-text">{t('onboarding.upload.helper')}</p>
        {selectedProfile && activeRawLength && (
          <p className="helper-text">
            {t('onboarding.upload.current', [resolveProfileName(selectedProfile), activeRawLength])}
          </p>
        )}
      </section>

      <section className="card">
        <h2>{t('onboarding.parse.heading')}</h2>
        <p className="helper-text">{t('onboarding.parse.helper')}</p>
        <div className="provider-options">
          <label className={!canUseOnDevice ? 'disabled' : ''}>
            <input
              type="radio"
              name="provider"
              value="on-device"
              checked={selectedProvider === 'on-device'}
              onChange={handleProviderChange}
              disabled={!canUseOnDevice}
            />
            {providerLabels['on-device']}
          </label>
          {onDeviceNote && <p className="helper-text">{onDeviceNote}</p>}

          <label>
            <input
              type="radio"
              name="provider"
              value="openai"
              checked={selectedProvider === 'openai'}
              onChange={handleProviderChange}
            />
            {providerLabels.openai}
          </label>
          {selectedProvider === 'openai' && (
            <div className="openai-fields">
              <label className="field">
                {t('onboarding.openai.apiKey')}
                <input
                  type="password"
                  value={apiKey}
                  placeholder={t('onboarding.openai.apiKeyPlaceholder')}
                  onChange={(event) => handleApiKeyChange(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                {t('onboarding.openai.model')}
                <input
                  type="text"
                  value={model}
                  onChange={(event) => handleModelChange(event.target.value)}
                />
              </label>
              <label className="field">
                {t('onboarding.openai.baseUrl')}
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(event) => handleApiBaseUrlChange(event.target.value)}
                  placeholder={t('onboarding.openai.baseUrlPlaceholder')}
                />
              </label>
              <p className="helper-text">{t('onboarding.openai.helper')}</p>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={
            busy ||
            !selectedProfile ||
            draftDirty ||
            (selectedProvider === 'openai' && !apiKey)
          }
          onClick={handleParse}
        >
          {busy && busyAction === 'parse' ? t('onboarding.buttons.working') : t('onboarding.parse.button')}
        </button>
        {!selectedProfile && (
          <p className="helper-text">{t('onboarding.parse.needProfile')}</p>
        )}
        {selectedProfile && draftDirty && (
          <p className="helper-text warning">{t('onboarding.parse.needsSave')}</p>
        )}
        {selectedProfile && !draftDirty && (
          <p className="helper-text">
            {t('onboarding.parse.summary', [resolveProfileName(selectedProfile)])}
          </p>
        )}
      </section>

      {selectedProfile && (
        <section className="card edit-card">
          <div className="card-heading">
            <div>
              <h2>{t('onboarding.edit.heading', [resolveProfileName(selectedProfile)])}</h2>
              <p className="helper-text">
                {t('onboarding.edit.helper', [activeRawLength ?? '0'])}
              </p>
            </div>
            <div className="heading-actions">
              <button type="button" className="ghost" onClick={handleResetDrafts} disabled={!draftDirty || busy}>
                {t('onboarding.edit.reset')}
              </button>
              <button
                type="button"
                onClick={handleSaveDrafts}
                disabled={!draftDirty || busy}
              >
                {busy && busyAction === 'edit' ? t('onboarding.buttons.working') : t('onboarding.edit.save')}
              </button>
            </div>
          </div>
          {draftError && <p className="error-text">{draftError}</p>}
          <div className="edit-grid">
            <label className="field">
              {t('onboarding.edit.rawLabel')}
              <textarea
                value={rawDraft}
                onChange={(event) => handleRawDraftChange(event.target.value)}
                rows={10}
              />
              <span className="helper-text">{t('onboarding.edit.rawSummary', [rawDraft.length.toLocaleString()])}</span>
            </label>
            <label className="field">
              {t('onboarding.edit.resumeLabel')}
              <textarea
                value={resumeDraft}
                onChange={(event) => handleResumeDraftChange(event.target.value)}
                rows={10}
              />
              <span className="helper-text">{t('onboarding.edit.resumeHelper')}</span>
            </label>
            <label className="field">
              {t('onboarding.edit.customLabel')}
              <textarea
                value={customDraft}
                onChange={(event) => handleCustomDraftChange(event.target.value)}
                rows={10}
              />
              <span className="helper-text">{t('onboarding.edit.customHelper')}</span>
            </label>
          </div>
        </section>
      )}

      {status.message && (
        <section className={`status ${status.phase}`}>
          <strong>{status.message}</strong>
          {errorDetails && <p>{errorDetails}</p>}
        </section>
      )}

      {validationErrors.length > 0 && (
        <section className="status warning">
          <strong>{t('onboarding.validation.heading')}</strong>
          <ul>
            {validationErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
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
