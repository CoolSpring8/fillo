import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Container, Loader, ScrollArea, Stack, Switch, Text, Title } from '@mantine/core';
import { deleteProfile, listProfiles } from '../../shared/storage/profiles';
import { OPENAI_DEFAULT_BASE_URL } from '../../shared/storage/settings';
import type { ProfileRecord } from '../../shared/types';
import { ProfileAccordion, type ProfileAccordionItem } from './components/ProfileAccordion';

interface ViewState {
  loading: boolean;
  error?: string;
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ loading: true });
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [overlayAvailable, setOverlayAvailable] = useState(true);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const { t } = i18n;
  const tLoose = i18n.t as unknown as (key: string, params?: unknown[]) => string;

  const refresh = async () => {
    setViewState({ loading: true });
    try {
      const result = await listProfiles();
      setProfiles(result);
      setViewState({ loading: false });
      if (result.length === 0) {
        setExpandedId(null);
      } else if (expandedId && !result.some((profile) => profile.id === expandedId)) {
        setExpandedId(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setViewState({ loading: false, error: message });
    }
  };

  useEffect(() => {
    void refresh();
    const listener = () => {
      void refresh();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async (id: string) => {
    await deleteProfile(id);
    await refresh();
  };

  const openSidePanel = async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return;
      }
      await browser.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
      await browser.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      console.error('Unable to open side panel', error);
    }
  };

  const openWorkspace = () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  };

  const refreshOverlayStatus = useCallback(async () => {
    setOverlayLoading(true);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id ?? null;
      setActiveTabId(tabId);
      if (!tabId) {
        setOverlayAvailable(false);
        setOverlayEnabled(false);
        return;
      }
      setOverlayAvailable(true);
      const response = (await browser.runtime.sendMessage({
        kind: 'POPUP_PROMPT_OVERLAY_GET',
        tabId,
      })) as { status?: string; enabled?: boolean } | undefined;
      setOverlayEnabled(Boolean(response?.enabled));
    } catch (error) {
      console.warn('Unable to fetch prompt overlay status', error);
      setOverlayAvailable(false);
      setOverlayEnabled(false);
    } finally {
      setOverlayLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverlayStatus();
  }, [refreshOverlayStatus]);

  const handleOverlayToggle = useCallback(
    async (nextValue: boolean) => {
      if (!activeTabId) {
        return;
      }
      const previousValue = overlayEnabled;
      setOverlayEnabled(nextValue);
      setOverlayLoading(true);
      try {
        const response = (await browser.runtime.sendMessage({
          kind: 'POPUP_PROMPT_OVERLAY_SET',
          tabId: activeTabId,
          enabled: nextValue,
        })) as { status?: string; enabled?: boolean; error?: string } | undefined;
        if (!response || response.status !== 'ok') {
          throw new Error(response?.error || 'toggle-failed');
        }
        if (typeof response.enabled === 'boolean') {
          setOverlayEnabled(response.enabled);
        }
      } catch (error) {
        console.warn('Unable to toggle prompt overlay', error);
        setOverlayEnabled(previousValue);
      } finally {
        setOverlayLoading(false);
      }
    },
    [activeTabId, overlayEnabled],
  );

  const profileItems = useMemo<ProfileAccordionItem[]>(() => {
    return profiles.map((profile) => {
      const createdAt = new Date(profile.createdAt).toLocaleString();
      const basics = (profile.resume as Record<string, unknown> | undefined)?.basics;
      const resolvedName =
        basics && typeof basics === 'object' && basics !== null
          ? (() => {
              const name = (basics as Record<string, unknown>).name;
              return typeof name === 'string' && name.trim().length > 0
                ? name.trim()
                : t('popup.profile.unnamed');
            })()
          : t('popup.profile.unnamed');
      const parsedAt = profile.parsedAt ? new Date(profile.parsedAt).toLocaleString() : null;
      const providerLabel = profile.provider
        ? profile.provider.kind === 'openai'
          ? profile.provider.apiBaseUrl && profile.provider.apiBaseUrl !== OPENAI_DEFAULT_BASE_URL
            ? t('popup.provider.openaiModelWithBase', [
                profile.provider.model,
                profile.provider.apiBaseUrl,
              ])
            : t('popup.provider.openaiModel', [profile.provider.model])
          : t('popup.provider.onDevice')
        : null;
      const parsedLabel = parsedAt ? t('popup.provider.parsed', [parsedAt]) : null;
      const parsingSummary = providerLabel
        ? parsedLabel
          ? `${providerLabel} · ${parsedLabel}`
          : providerLabel
        : t('popup.provider.notParsed');
      const fileSummary = profile.sourceFile
        ? t('popup.profile.fileInfo', [
            profile.sourceFile.name,
            profile.sourceFile.size.toLocaleString(),
            profile.rawText.length.toLocaleString(),
          ])
        : t('popup.profile.manualInfo', [profile.rawText.length.toLocaleString()]);

      const hasValidationWarning = Boolean(profile.validation && !profile.validation.valid);

      return {
        id: profile.id,
        title: resolvedName,
        importedAtLabel: t('popup.profile.importedAt', [createdAt]),
        parsingSummary,
        fileSummary,
        hasValidationWarning,
        validationLabel: hasValidationWarning ? t('popup.profile.validationWarning') : null,
        validationErrors: profile.validation?.errors ?? [],
        resumeJson: formatJson(profile.resume ?? {}),
        hasResumeData: Boolean(profile.provider),
        resumeEmptyLabel: t('popup.info.noStructured'),
        rawText: profile.rawText,
        rawLabel: t('popup.sections.rawText'),
        resumeLabel: t('popup.sections.jsonResume'),
        validationHeading: t('popup.sections.validationWarnings'),
      } satisfies ProfileAccordionItem;
    });
  }, [profiles, t]);

  return (
    <Box
      bg="var(--mantine-color-gray-0)"
      style={{
        minWidth: 360,
        maxWidth: 420,
        padding: 16,
      }}
    >
      <ScrollArea.Autosize mah={580} type="auto">
        <Container size="sm" px={0}>
          <Stack gap="lg">
            <Stack gap={4}>
              <Title order={2}>{t('popup.title')}</Title>
              <Text c="dimmed">{t('popup.description')}</Text>
            </Stack>

            {viewState.loading && (
              <Stack align="center" py="md">
                <Loader size="sm" color="brand" />
                <Text fz="sm" c="dimmed">
                  {t('popup.loading')}
                </Text>
              </Stack>
            )}

            {viewState.error && (
              <Alert color="red" variant="light">
                {t('popup.error', [viewState.error])}
              </Alert>
            )}

            {!viewState.loading && profiles.length === 0 && (
              <Alert color="gray" variant="light">
                {t('popup.empty')}
              </Alert>
            )}

            {profiles.length > 0 && (
              <ProfileAccordion
                items={profileItems}
                expandedId={expandedId}
                onExpandedChange={setExpandedId}
                onDelete={handleDelete}
                deleteLabel={t('popup.buttons.delete')}
              />
            )}

            <Stack gap={4}>
              <Switch
                checked={overlayEnabled}
                onChange={(event) => void handleOverlayToggle(event.currentTarget.checked)}
                disabled={overlayLoading || !overlayAvailable || viewState.loading}
                label={tLoose('popup.overlay.toggleLabel')}
              />
              <Text fz="xs" c="dimmed">
                {overlayAvailable
                  ? tLoose('popup.overlay.toggleDescription')
                  : tLoose('popup.overlay.toggleUnavailable')}
              </Text>
            </Stack>

            <Stack gap="xs">
              <Button variant="light" fullWidth onClick={openWorkspace}>
                {t('popup.buttons.openWorkspace')}
              </Button>
              <Button fullWidth onClick={() => openSidePanel()}>
                {t('popup.buttons.openSidePanel')}
              </Button>
            </Stack>
          </Stack>
        </Container>
      </ScrollArea.Autosize>
    </Box>
  );
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) {
    return '{}';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}
