import type { JSX } from 'react';
import { ActionIcon, Card, Group, Paper, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { Copy } from 'lucide-react';

import type { ProfileRecord } from '../../../shared/types';
import type { ManualValueNode } from '../manualValues';
import type { ViewState } from '../types';
import { ModePanel, StateAlert } from './ModeLayout';
import { ManualTreeView } from './ManualTreeView';

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
      </Stack>
    </ModePanel>
  );
}
