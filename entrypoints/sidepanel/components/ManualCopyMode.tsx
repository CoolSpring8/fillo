import type { JSX } from 'react';
import { ActionIcon, Card, Center, Group, Loader, Paper, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { Copy, MoveUpRight } from 'lucide-react';

import type { ProfileRecord } from '../../../shared/types';
import type { ManualValueNode } from '../../../shared/apply/manualValues';
import type { ViewState } from '../types';
import { ModePanel, StateAlert } from './ModeLayout';
import { ManualTreeView } from './ManualTreeView';
import { useProfilePreview } from '@/shared/hooks/useProfilePreview';

type TranslateFn = (key: string, params?: unknown[]) => string;

interface ManualCopyModeProps {
  viewState: ViewState;
  selectedProfile: ProfileRecord | null;
  manualTree: ManualValueNode[];
  onCopy: (label: string, value: string) => void;
  t: TranslateFn;
}

export function ManualCopyMode({
  viewState,
  selectedProfile,
  manualTree,
  onCopy,
  t,
}: ManualCopyModeProps): JSX.Element {
  if (viewState.loadingProfiles) {
    return <ModePanel><StateAlert message={t('sidepanel.states.loadingProfiles')} tone="brand" /></ModePanel>;
  }
  if (viewState.error) {
    return <ModePanel><StateAlert message={t('sidepanel.states.error', [viewState.error])} tone="red" /></ModePanel>;
  }
  if (!selectedProfile) {
    return <ModePanel><StateAlert message={t('sidepanel.states.noProfileManual')} /></ModePanel>;
  }

  const { status: previewStatus, previewUrl } = useProfilePreview({
    profileId: selectedProfile.id,
    file: selectedProfile.sourceFile,
  });
  const canOpenPreview = previewStatus === 'ready' && Boolean(previewUrl);

  const handleOpenPreviewTab = () => {
    if (!previewUrl || typeof window === 'undefined') {
      return;
    }
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  };

  const renderPreviewBody = () => {
    if (!selectedProfile.sourceFile) {
      return (
        <Center h={220}>
          <Text fz="sm" c="dimmed" ta="center">
            {t('sidepanel.manual.preview.noFile')}
          </Text>
        </Center>
      );
    }
    if (previewStatus === 'loading') {
      return (
        <Center h={220}>
          <Loader size="sm" />
        </Center>
      );
    }
    if (previewStatus === 'error' || !previewUrl) {
      return (
        <Center h={220}>
          <Text fz="sm" c="dimmed" ta="center">
            {t('sidepanel.manual.preview.error')}
          </Text>
        </Center>
      );
    }
    return (
      <iframe
        src={previewUrl}
        title={t('sidepanel.manual.preview.iframeTitle')}
        style={{
          width: '100%',
          height: 260,
          border: 'none',
          borderRadius: 12,
          backgroundColor: 'var(--mantine-color-gray-0)',
        }}
      />
    );
  };

  return (
    <ModePanel>
      <Stack gap="md">
        {manualTree.length === 0 && <StateAlert message={t('sidepanel.states.noManualValues')} />}
        {manualTree.length > 0 && (
          <ManualTreeView
            nodes={manualTree}
            tooltipLabel={t('sidepanel.manual.copyHint')}
            branchCopyLabel={t('sidepanel.manual.copyBranch')}
            valueCopyLabel={t('sidepanel.manual.copyValue')}
            searchPlaceholder={t('sidepanel.manual.searchPlaceholder')}
            searchAriaLabel={t('sidepanel.manual.searchAria')}
            previousMatchLabel={t('sidepanel.manual.searchPrevious')}
            nextMatchLabel={t('sidepanel.manual.searchNext')}
            onCopy={onCopy}
          />
        )}
        <Card withBorder radius="md" shadow="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Text fw={600}>{t('sidepanel.manual.rawLabel')}</Text>
              <Tooltip label={t('sidepanel.buttons.copyAll')} withArrow>
                <ActionIcon
                  aria-label={t('sidepanel.buttons.copyAll')}
                  size="lg"
                  radius="md"
                  variant="light"
                  color="gray"
                  onClick={() => onCopy(t('sidepanel.manual.rawLabel'), selectedProfile.rawText)}
                >
                  <Copy size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Paper withBorder radius="md" p="sm">
              <ScrollArea h={220}>
                <Text
                  component="pre"
                  fz="sm"
                  style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {selectedProfile.rawText}
                </Text>
              </ScrollArea>
            </Paper>
          </Stack>
        </Card>
        <Card withBorder radius="md" shadow="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Text fw={600}>{t('sidepanel.manual.preview.heading')}</Text>
              <Tooltip label={t('sidepanel.manual.preview.openTab')} withArrow>
                <ActionIcon
                  aria-label={t('sidepanel.manual.preview.openTab')}
                  size="lg"
                  radius="md"
                  variant="light"
                  color="gray"
                  disabled={!canOpenPreview}
                  onClick={handleOpenPreviewTab}
                >
                  <MoveUpRight size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Paper withBorder radius="md" p="sm" style={{ minHeight: 220 }}>
              {renderPreviewBody()}
            </Paper>
            {previewStatus === 'ready' && previewUrl && (
              <Text fz="xs" c="dimmed">
                {t('sidepanel.manual.preview.inlineHint')}
              </Text>
            )}
          </Stack>
        </Card>
      </Stack>
    </ModePanel>
  );
}
