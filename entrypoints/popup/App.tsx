import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Box,
  Card,
  Container,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { FolderOpen, PanelRightOpen } from 'lucide-react';
import { listProfiles } from '../../shared/storage/profiles';
import type { ProfileRecord } from '../../shared/types';

interface ViewState {
  loading: boolean;
  error?: string;
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [viewState, setViewState] = useState<ViewState>({ loading: true });
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileUpdating, setProfileUpdating] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [overlayAvailable, setOverlayAvailable] = useState(true);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const { t } = i18n;
  const tLoose = i18n.t as unknown as (key: string, params?: unknown[]) => string;

  const syncActiveProfile = useCallback(async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        kind: 'POPUP_ACTIVE_PROFILE_GET',
      })) as { status?: string; profileId?: string | null } | undefined;
      if (response?.status === 'ok') {
        setActiveProfileId(response.profileId ?? null);
      } else {
        setActiveProfileId(null);
      }
    } catch (error) {
      console.warn('Unable to fetch active profile', error);
      setActiveProfileId(null);
    }
  }, []);

  const handleProfileSelect = useCallback(
    async (profileId: string | null) => {
      const normalized = profileId && profileId.trim().length > 0 ? profileId.trim() : null;
      if (normalized === activeProfileId) {
        return;
      }
      const previous = activeProfileId;
      setActiveProfileId(normalized);
      setProfileUpdating(true);
      try {
        const response = (await browser.runtime.sendMessage({
          kind: 'POPUP_ACTIVE_PROFILE_SET',
          profileId: normalized,
        })) as { status?: string; profileId?: string | null; error?: string } | undefined;
        if (!response || response.status !== 'ok') {
          throw new Error(response?.error || 'profile-set-failed');
        }
        setActiveProfileId(response.profileId ?? normalized ?? null);
      } catch (error) {
        console.warn('Unable to set active profile', error);
        setActiveProfileId(previous);
      } finally {
        setProfileUpdating(false);
      }
    },
    [activeProfileId],
  );

  const refresh = useCallback(async () => {
    setViewState({ loading: true });
    try {
      const result = await listProfiles();
      setProfiles(result);
      setViewState({ loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setViewState({ loading: false, error: message });
    }
  }, []);

  useEffect(() => {
    void refresh();
    void syncActiveProfile();
    const listener = () => {
      void refresh();
      void syncActiveProfile();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refresh, syncActiveProfile]);

  useEffect(() => {
    if (!activeProfileId) {
      return;
    }
    if (!profiles.some((profile) => profile.id === activeProfileId)) {
      void handleProfileSelect(null);
    }
  }, [activeProfileId, profiles, handleProfileSelect]);

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

  const profileSelectOptions = useMemo(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: resolveProfileName(profile, t('popup.profile.unnamed')),
      })),
    [profiles, t],
  );

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
            <Card withBorder p="md" radius="md">
              <Group gap="md" justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={4} style={{ flex: 1 }}>
                  <Text fw={600} fz="sm">
                    {tLoose('popup.overlay.toggleLabel')}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {overlayAvailable
                      ? tLoose('popup.overlay.toggleDescription')
                      : tLoose('popup.overlay.toggleUnavailable')}
                  </Text>
                </Stack>
                <Switch
                  size="md"
                  checked={overlayEnabled}
                  onChange={(event) => void handleOverlayToggle(event.currentTarget.checked)}
                  disabled={overlayLoading || !overlayAvailable || viewState.loading}
                  aria-label={tLoose('popup.overlay.toggleLabel')}
                  data-loading={overlayLoading ? true : undefined}
                />
              </Group>
            </Card>

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

            <Stack gap="sm">
              <Select
                data={profileSelectOptions}
                value={activeProfileId ?? null}
                onChange={(value) => void handleProfileSelect(value)}
                clearable
                disabled={profiles.length === 0 || profileUpdating}
                label={tLoose('popup.overlay.profileSelectLabel')}
                placeholder={tLoose('popup.overlay.profileSelectPlaceholder')}
                description={
                  profiles.length > 0
                    ? tLoose('popup.overlay.profileSelectDescription')
                    : tLoose('popup.overlay.profileSelectEmpty')
                }
                size="sm"
              />

              {viewState.loading && (
                <Stack align="center" py="md">
                  <Loader size="sm" color="brand" />
                  <Text fz="sm" c="dimmed">
                    {t('popup.loading')}
                  </Text>
                </Stack>
              )}
            </Stack>

            <Group justify="flex-end" gap="sm">
              <Tooltip label={t('popup.buttons.openWorkspace')} position="bottom" withArrow>
                <ActionIcon
                  size="lg"
                  variant="light"
                  radius="md"
                  aria-label={t('popup.buttons.openWorkspace')}
                  onClick={openWorkspace}
                >
                  <FolderOpen size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('popup.buttons.openSidePanel')} position="bottom" withArrow>
                <ActionIcon
                  size="lg"
                  variant="filled"
                  radius="md"
                  aria-label={t('popup.buttons.openSidePanel')}
                  onClick={() => openSidePanel()}
                >
                  <PanelRightOpen size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Stack>
        </Container>
      </ScrollArea.Autosize>
    </Box>
  );
}

function resolveProfileName(profile: ProfileRecord, fallback: string): string {
  const resume = profile.resume;
  if (resume && typeof resume === 'object') {
    const basics = (resume as Record<string, unknown>).basics;
    if (basics && typeof basics === 'object' && basics !== null) {
      const name = (basics as Record<string, unknown>).name;
      if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }
  return fallback;
}
