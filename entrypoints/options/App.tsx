import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Flex,
  Grid,
  Group,
  List,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { useForm } from 'react-hook-form';
import { Cpu, IdCard, SlidersHorizontal, Sparkles, WandSparkles } from 'lucide-react';
import { notifications } from '@mantine/notifications';
import { ProfilesCard } from './components/ProfilesCard';
import { ProviderCard } from './components/ProviderCard';
import { AdaptersCard } from './components/AdaptersCard';
import { AutofillCard } from './components/AutofillCard';
import { OverlayCard } from './components/OverlayCard';
import { MemoryCard } from './components/MemoryCard';
import { SectionHeading } from './components/SectionHeading';
import { OptionsNavigationCard, type TocNavLink } from './components/OptionsNavigationCard';
import { GettingStartedSection, type SetupChecklistItem } from './components/GettingStartedSection';
import { FileUploadModal } from './components/FileUploadModal';
import { ParseAgainModal } from './components/ParseAgainModal';
import { CopyHelperAffix } from './components/CopyHelperAffix';
import { CelebrationOverlay } from './components/CelebrationOverlay';
import { ResumePreviewPane } from './components/ResumePreviewPane';
import './App.css';
import {
  ProfileForm,
  createEmptyResumeFormValues,
  type ResumeFormValues,
} from './components/ProfileForm';
import { useProviderSettings } from './hooks/useProviderSettings';
import { useMemoryStore } from './hooks/useMemoryStore';
import { useProfilesManager } from './hooks/useProfilesManager';

export default function App() {
  const form = useForm<ResumeFormValues>({
    defaultValues: createEmptyResumeFormValues(),
  });
  const uploadInputId = 'profile-form-upload';
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [celebrationVersion, setCelebrationVersion] = useState(0);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
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
  const {
    selectedProvider,
    openAiConfig,
    geminiConfig,
    autoFallback,
    highlightOverlay,
    availability,
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
  } = useProviderSettings({ t, translate });
  const {
    profiles,
    profilesState,
    profilesData,
    selectedProfile,
    validationErrors,
    status,
    errorDetails,
    busy,
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
  } = useProfilesManager({
    form,
    selectedProvider,
    openAiConfig,
    geminiConfig,
    availability,
    t,
    translate,
  });
  const { memoryItems, memoryState, refreshMemory, clearMemory, deleteMemory, formatMemoryEntry } =
    useMemoryStore({ t });
  useEffect(() => {
    if (!selectedProfile) {
      setWorkspaceOpen(false);
    }
  }, [selectedProfile]);
  const handleOpenWorkspace = useCallback(() => {
    if (!selectedProfile) {
      return;
    }
    setWorkspaceOpen(true);
  }, [selectedProfile]);
  const handleCloseWorkspace = useCallback(() => {
    setWorkspaceOpen(false);
  }, []);
  const profileFormProps = useMemo(
    () => ({
      form,
      onSubmit: handleSaveForm,
      onReset: handleResetForm,
      disabled: busy,
      saving: formSaving,
      onFileSelect: handleFileSelect,
      onParseAgain: canParseAgain ? openParseAgainConfirm : undefined,
      parseAgainDisabled: !canParseAgain,
      fileSummary,
      rawSummary,
      uploadInputId,
    }),
    [
      form,
      handleSaveForm,
      handleResetForm,
      busy,
      formSaving,
      handleFileSelect,
      canParseAgain,
      openParseAgainConfirm,
      fileSummary,
      rawSummary,
      uploadInputId,
    ],
  );

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
  const profileCountLabel = profiles.length.toLocaleString();
  const hasProfiles = profiles.length > 0;
  const setupChecklist = useMemo<SetupChecklistItem[]>(
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
        icon: Sparkles,
        color: 'orange',
      },
      {
        id: 'section-provider',
        label: t('options.sections.provider'),
        icon: Cpu,
        color: 'brand',
      },
      {
        id: 'section-profiles',
        label: t('options.sections.profiles'),
        icon: IdCard,
        color: 'indigo',
      },
      {
        id: 'section-autofill',
        label: t('options.sections.autofill'),
        icon: WandSparkles,
        color: 'teal',
      },
      {
        id: 'section-advanced',
        label: t('options.sections.advanced'),
        icon: SlidersHorizontal,
        color: 'gray',
      },
    ],
    [t],
  );

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

  const sectionClassName = useCallback(
    (id: string) =>
      highlightedSection === id
        ? 'fillo-options__section fillo-options__section--highlighted'
        : 'fillo-options__section',
    [highlightedSection],
  );

  return (
    <>
      <Container size="xl" py="xl" className="fillo-options__container">
        <Stack gap="xl">
          <Group align="flex-start" justify="space-between" gap="xl" wrap="wrap">
            <Stack gap={4} className="fillo-options__intro">
              <Title order={1}>{t('options.title')}</Title>
              <Text c="dimmed">{t('options.description')}</Text>
            </Stack>

          </Group>

          <Flex gap="xl" align="flex-start" direction={{ base: 'column', md: 'row' }}>
          <OptionsNavigationCard
            className="fillo-options__toc fillo-options__toc-sticky"
            title={t('options.toc.title')}
            helper={t('options.toc.helper')}
            links={navLinks}
            onNavigate={handleScrollTo}
          />

          <Stack flex={1} gap="xl">
            <Box
              id="section-getting-started"
              ref={setupSectionRef}
              className={sectionClassName('section-getting-started')}
            >
              <GettingStartedSection
                headingIcon={Sparkles}
                headingColor="orange"
                headingTitle={t('options.sections.gettingStarted')}
                headingDescription={t('options.gettingStarted.helper')}
                checklist={setupChecklist}
                openSectionLabel={t('options.checklist.openSection')}
                tip={t('options.gettingStarted.tip')}
                onNavigate={handleScrollTo}
              />
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
                        workspaceOpen ? null : (
                          <Grid gutter="md" align="stretch">
                            <Grid.Col span={{ base: 12, md: 7, xl: 8 }}>
                              <ProfileForm {...profileFormProps} />
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, md: 5, xl: 4 }}>
                              <ResumePreviewPane
                                profileId={selectedProfile.id}
                                file={selectedProfile.sourceFile}
                                fileSummary={fileSummary}
                                rawSummary={rawSummary}
                                rawText={rawText}
                                uploadInputId={uploadInputId}
                                onOpenWorkspace={handleOpenWorkspace}
                              />
                            </Grid.Col>
                          </Grid>
                        )
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
                    void refreshMemory();
                  }}
                  onClearAll={() => {
                    void clearMemory();
                  }}
                  onDelete={(key) => {
                    void deleteMemory(key);
                  }}
                  formatEntry={formatMemoryEntry}
                />
              </Stack>
            </Box>
          </Stack>
        </Flex>
      </Stack>

      <FileUploadModal
        opened={filePromptOpen}
        onClose={closeFilePrompt}
        title={t('options.profileForm.upload.modalTitle')}
        description={t('options.profileForm.upload.modalDescription')}
        parseLabel={t('options.profileForm.upload.parseAction')}
        storeLabel={t('options.profileForm.upload.storeAction')}
        busy={busy}
        onParse={() => handleFileAction('parse')}
        onStore={() => handleFileAction('store')}
      />

      <ParseAgainModal
        opened={parseAgainConfirmOpen}
        onClose={closeParseAgainConfirm}
        title={translate('options.profileForm.upload.parseAgainConfirmTitle')}
        description={translate('options.profileForm.upload.parseAgainConfirmDescription')}
        cancelLabel={translate('options.profileForm.upload.parseAgainConfirmCancel')}
        confirmLabel={translate('options.profileForm.upload.parseAgainConfirmConfirm')}
        busy={busy}
        onConfirm={handleParseAgain}
      />

      <CopyHelperAffix
        visible={showCopyHelper}
        rawText={rawText}
        heading={t('options.profileForm.copyHelper.heading')}
        description={t('options.profileForm.copyHelper.description')}
        copyLabel={t('options.profileForm.copyHelper.copy')}
        copiedLabel={t('options.profileForm.copyHelper.copied')}
      />

      <Modal
        opened={workspaceOpen}
        onClose={handleCloseWorkspace}
        title={t('options.profileForm.preview.workspaceTitle')}
        fullScreen
        radius={0}
        padding={0}
        styles={{
          content: {
            padding: 0,
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
          },
          header: {
            padding: 'var(--mantine-spacing-md) var(--mantine-spacing-xl)',
            flexShrink: 0,
          },
          body: {
            padding: 'var(--mantine-spacing-xl)',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        }}
      >
        {workspaceOpen && selectedProfile ? (
          <Box className="fillo-workspace">
            <Box className="fillo-workspace__layout">
              <Box className="fillo-workspace__form">
                <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
                  <ProfileForm {...profileFormProps} />
                </ScrollArea>
              </Box>
              <Box className="fillo-workspace__preview">
                <ResumePreviewPane
                  profileId={selectedProfile.id}
                  file={selectedProfile.sourceFile}
                  fileSummary={fileSummary}
                  rawSummary={rawSummary}
                  rawText={rawText}
                  uploadInputId={uploadInputId}
                  variant="modal"
                />
              </Box>
            </Box>
          </Box>
        ) : (
          <Stack gap="sm">
            <Text fw={600}>{t('options.profileForm.preview.noProfile')}</Text>
            <Text fz="sm" c="dimmed">
              {t('options.profileForm.preview.workspaceDescription')}
            </Text>
            <Button variant="light" onClick={handleCloseWorkspace}>
              {t('options.profileForm.preview.close')}
            </Button>
          </Stack>
        )}
      </Modal>
    </Container>
      <CelebrationOverlay
        open={celebrationOpen}
        version={celebrationVersion}
        title={t('options.celebration.title')}
        message={t('options.celebration.message')}
        ctaLabel={t('options.celebration.cta')}
        onClose={() => setCelebrationOpen(false)}
        onCta={() => {
          setCelebrationOpen(false);
          handleScrollTo('section-autofill');
        }}
      />
    </>
  );
}
