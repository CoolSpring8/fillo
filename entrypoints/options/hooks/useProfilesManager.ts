import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import type { UseFormReturn } from 'react-hook-form';
import { buildResumePrompt } from '../../../shared/llm/prompt';
import { invokeWithProvider } from '../../../shared/llm/runtime';
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../../../shared/llm/errors';
import { extractTextFromPdf } from '../../../shared/pdf/extractText';
import { deleteProfile, listProfiles, saveProfile, storeFile } from '../../../shared/storage/profiles';
import { getActiveProfileId, setActiveProfileId } from '../../../shared/storage/activeProfile';
import {
  createGeminiProvider,
  createOnDeviceProvider,
  createOpenAIProvider,
} from '../../../shared/storage/settings';
import resumeSchema from '../../../shared/schema/jsonresume-v1.llm.json';
import { validateResume } from '../../../shared/validate';
import type {
  ProviderConfig,
  ProviderSnapshot,
  ProfileRecord,
  ResumeExtractionResult,
} from '../../../shared/types';
import {
  createEmptyResumeFormValues,
  formValuesToResume,
  mergeResumeFormValues,
  resumeToFormValues,
  type ResumeFormValues,
} from '../components/ProfileForm';
import type { ProfilesCardProfile } from '../components/ProfilesCard';
import type { LanguageModelAvailability } from '../../../shared/llm/chromePrompt';
import type { GeminiConfigState, OpenAiConfigState, ProviderKind } from './useProviderSettings';
import {
  formatProfileParsing,
  formatProfileSummary,
  resolveProfileName,
} from './profileUtils';

export type StatusPhase = 'idle' | 'extracting' | 'parsing' | 'saving' | 'complete' | 'error';

export interface StatusState {
  phase: StatusPhase;
  message: string;
}

type BusyAction = 'upload' | 'parse' | 'save' | null;

interface ProfilesState {
  loading: boolean;
  error?: string;
}

interface UseProfilesManagerParams {
  form: UseFormReturn<ResumeFormValues>;
  selectedProvider: ProviderKind;
  openAiConfig: OpenAiConfigState;
  geminiConfig: GeminiConfigState;
  availability: LanguageModelAvailability;
  t: (key: string, substitutions?: unknown) => string;
  translate: (key: string, substitutions?: unknown) => string;
}

interface UseProfilesManagerResult {
  profiles: ProfileRecord[];
  profilesState: ProfilesState;
  profilesData: ProfilesCardProfile[];
  selectedProfile: ProfileRecord | null;
  validationErrors: string[];
  status: StatusState;
  errorDetails: string | null;
  busy: boolean;
  busyAction: BusyAction;
  rawText: string;
  filePromptOpen: boolean;
  parseAgainConfirmOpen: boolean;
  fileSummary: string | null;
  rawSummary: string | null;
  formSaving: boolean;
  canParseAgain: boolean;
  showCopyHelper: boolean;
  profilesErrorLabel?: string;
  handleSaveForm: (values: ResumeFormValues) => Promise<void>;
  handleResetForm: () => void;
  handleSelectProfile: (id: string) => void;
  handleDeleteProfile: (id: string) => Promise<void>;
  handleCreateProfile: () => Promise<void>;
  handleFileSelect: (file: File | null) => void;
  handleFileAction: (mode: 'parse' | 'store') => Promise<void>;
  closeFilePrompt: () => void;
  openParseAgainConfirm: () => void;
  closeParseAgainConfirm: () => void;
  handleParseAgain: () => Promise<void>;
}

export function useProfilesManager({
  form,
  selectedProvider,
  openAiConfig,
  geminiConfig,
  availability,
  t,
  translate,
}: UseProfilesManagerParams): UseProfilesManagerResult {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [profilesState, setProfilesState] = useState<ProfilesState>({ loading: true });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const selectedProfileIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ phase: 'idle', message: '' });
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [rawText, setRawText] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [filePromptOpen, setFilePromptOpen] = useState(false);
  const [parseAgainConfirmOpen, setParseAgainConfirmOpen] = useState(false);

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
  }, [selectedProfileId]);

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
          } catch (error: unknown) {
            console.warn('Unable to persist active profile', error);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilesState({ loading: false, error: message });
      }
    },
    [],
  );

  useEffect(() => {
    void refreshProfiles();
    const listener = () => {
      void refreshProfiles();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refreshProfiles]);

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

  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!selectedProfile || !file) {
        return;
      }
      setPendingFile(file);
      setFilePromptOpen(true);
    },
    [selectedProfile],
  );

  const closeFilePrompt = useCallback(() => {
    setFilePromptOpen(false);
    setPendingFile(null);
  }, []);

  const processFile = useCallback(
    async (file: File, mode: 'parse' | 'store') => {
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
            } catch (error: unknown) {
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({ phase: 'error', message: t('options.profileForm.status.uploadFailed') });
        setErrorDetails(message);
        console.error(error);
      } finally {
        setBusy(false);
        setBusyAction(null);
      }
    },
    [
      availability,
      form,
      geminiConfig,
      openAiConfig,
      refreshProfiles,
      selectedProfile,
      selectedProvider,
      t,
    ],
  );

  const handleFileAction = useCallback(
    async (mode: 'parse' | 'store') => {
      if (!pendingFile) {
        return;
      }
      await processFile(pendingFile, mode);
      closeFilePrompt();
    },
    [closeFilePrompt, pendingFile, processFile],
  );

  const openParseAgainConfirm = useCallback(() => {
    setParseAgainConfirmOpen(true);
  }, []);

  const closeParseAgainConfirm = useCallback(() => {
    setParseAgainConfirmOpen(false);
  }, []);

  const handleParseAgain = useCallback(async () => {
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
    } catch (error: unknown) {
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
  }, [
    availability,
    busy,
    closeParseAgainConfirm,
    form,
    geminiConfig,
    openAiConfig,
    rawText,
    refreshProfiles,
    selectedProfile,
    selectedProvider,
    t,
  ]);

  const handleSaveForm = useCallback(
    async (values: ResumeFormValues) => {
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
        setStatus({ phase: 'complete', message: t('options.profileForm.status.saved') });
        setErrorDetails(null);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({ phase: 'error', message: t('options.profileForm.status.saveFailed') });
        setErrorDetails(message);
        console.error(error);
      } finally {
        setBusy(false);
        setBusyAction(null);
      }
    },
    [refreshProfiles, selectedProfile, t],
  );

  const handleResetForm = useCallback(() => {
    if (!selectedProfile) {
      const empty = createEmptyResumeFormValues();
      form.reset(empty);
      return;
    }
    const values = resumeToFormValues(selectedProfile.resume);
    form.reset(values);
  }, [form, selectedProfile]);

  const handleSelectProfile = useCallback(
    (id: string) => {
      setSelectedProfileId(id);
      void setActiveProfileId(id).catch((error) => {
        console.warn('Unable to persist active profile', error);
      });
    },
    [],
  );

  const handleDeleteProfile = useCallback(
    async (id: string) => {
      if (busy) {
        return;
      }
      setBusy(true);
      setBusyAction(null);
      try {
        await deleteProfile(id);
        await refreshProfiles();
      } catch (error: unknown) {
        console.error(error);
        notifications.show({
          color: 'red',
          title: t('onboarding.manage.deleteFailed'),
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, refreshProfiles, t],
  );

  const handleCreateProfile = useCallback(async () => {
    const id = crypto.randomUUID();
    const profile: ProfileRecord = {
      id,
      createdAt: new Date().toISOString(),
      resume: {},
      rawText: '',
      sourceFile: undefined,
    };
    await saveProfile(profile);
    try {
      await setActiveProfileId(id);
    } catch (error: unknown) {
      console.warn('Unable to set active profile after creation', error);
    }
    setStatus({ phase: 'complete', message: t('options.profileForm.status.profileCreated') });
    setErrorDetails(null);
    await refreshProfiles(id);
  }, [refreshProfiles, t]);

  const profilesData = useMemo<ProfilesCardProfile[]>(
    () =>
      profiles.map((profile: ProfileRecord) => ({
        id: profile.id,
        name: resolveProfileName(profile, t),
        summary: formatProfileSummary(profile, t),
        parsing: formatProfileParsing(profile, t),
        isActive: selectedProfile?.id === profile.id,
      })),
    [profiles, selectedProfile?.id, t],
  );

  const fileSummary = useMemo(
    () =>
      selectedProfile?.sourceFile
        ? t('options.profileForm.upload.currentFile', [
            selectedProfile.sourceFile.name,
            selectedProfile.sourceFile.size.toLocaleString(),
          ])
        : null,
    [selectedProfile, t],
  );

  const rawSummary = useMemo(
    () =>
      selectedProfile && rawText.trim().length > 0
        ? t('options.profileForm.upload.rawSummary', [rawText.length.toLocaleString()])
        : null,
    [rawText, selectedProfile, t],
  );

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

  return {
    profiles,
    profilesState,
    profilesData,
    selectedProfile,
    validationErrors,
    status,
    errorDetails,
    busy,
    busyAction,
    rawText,
    filePromptOpen,
    parseAgainConfirmOpen,
    fileSummary,
    rawSummary,
    formSaving,
    canParseAgain,
    showCopyHelper,
    profilesErrorLabel,
    handleSaveForm,
    handleResetForm,
    handleSelectProfile,
    handleDeleteProfile,
    handleCreateProfile,
    handleFileSelect,
    handleFileAction,
    closeFilePrompt,
    openParseAgainConfirm,
    closeParseAgainConfirm,
    handleParseAgain,
  };
}
