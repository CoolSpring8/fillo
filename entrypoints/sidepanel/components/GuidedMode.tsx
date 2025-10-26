import type { JSX } from 'react';
import { Badge, Button, Card, Group, Stack, Text, Tooltip, ActionIcon } from '@mantine/core';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ListChecks,
  Play,
  RefreshCcw,
  RotateCcw,
  Target,
  Trash2,
} from 'lucide-react';

import type { ProfileRecord } from '../../../shared/types';
import type { FieldEntry, ViewState } from '../types';
import { ModePanel, StateAlert } from './ModeLayout';

type TranslateFn = (key: string, params?: unknown[]) => string;

type MemoryAssociation = { preferredSlot?: string; lastValue?: string };

interface MemoryEntry {
  key: string;
  association: MemoryAssociation;
}

interface GuidedModeProps {
  viewState: ViewState;
  selectedProfile: ProfileRecord | null;
  scanning: boolean;
  fields: FieldEntry[];
  guidedStarted: boolean;
  guidedIndex: number;
  guidedFilled: number;
  guidedSkipped: number;
  isFirst: boolean;
  isLast: boolean;
  memoryList: MemoryEntry[];
  onStart: () => void;
  onBack: () => void;
  onNext: () => void;
  onJumpToUnfilled: () => void;
  onRestart: () => void;
  onHighlight: (entry: FieldEntry | null) => void;
  onFinish: () => void;
  onRefreshMemory: () => void;
  onClearMemory: () => void;
  onRemoveMemory: (key: string) => void;
  renderGuidedControls: (entry: FieldEntry) => JSX.Element;
  truncate: (value: string, limit?: number) => string;
  t: TranslateFn;
}

export function GuidedMode({
  viewState,
  selectedProfile,
  scanning,
  fields,
  guidedStarted,
  guidedIndex,
  guidedFilled,
  guidedSkipped,
  isFirst,
  isLast,
  memoryList,
  onStart,
  onBack,
  onNext,
  onJumpToUnfilled,
  onRestart,
  onHighlight,
  onFinish,
  onRefreshMemory,
  onClearMemory,
  onRemoveMemory,
  renderGuidedControls,
  truncate,
  t,
}: GuidedModeProps): JSX.Element {
  if (viewState.loadingProfiles) {
    return <ModePanel><StateAlert message={t('sidepanel.states.loadingProfiles')} tone="brand" /></ModePanel>;
  }
  if (viewState.error) {
    return <ModePanel><StateAlert message={t('sidepanel.states.error', [viewState.error])} tone="red" /></ModePanel>;
  }
  if (!selectedProfile) {
    return <ModePanel><StateAlert message={t('sidepanel.states.noProfile')} /></ModePanel>;
  }
  if (scanning) {
    return <ModePanel><StateAlert message={t('sidepanel.toolbar.scanning')} tone="brand" /></ModePanel>;
  }
  if (fields.length === 0) {
    return <ModePanel><StateAlert message={t('sidepanel.states.noFields')} /></ModePanel>;
  }

  const guidedTotal = fields.length;
  const current = guidedStarted ? fields[guidedIndex] ?? null : null;
  const progressText = t('sidepanel.guided.progress', [
    String(guidedFilled),
    String(guidedTotal),
    String(guidedSkipped),
  ]);

  return (
    <ModePanel>
      <Stack gap="sm">
        <StateAlert message={t('sidepanel.guided.description')} tone="brand" />
        <Stack gap={4}>
          <Group gap="xs" wrap="wrap" align="center">
            {!guidedStarted ? (
              <Button size="sm" leftSection={<Play size={16} />} onClick={onStart}>
                {t('sidepanel.guided.start')}
              </Button>
            ) : (
              <>
                <Badge variant="light" color="gray">
                  {t('sidepanel.guided.paused', [
                    current?.field.label || t('sidepanel.field.noLabel'),
                    String(guidedIndex + 1),
                    String(guidedTotal),
                  ])}
                </Badge>
                <Group gap="xs" wrap="wrap" align="center">
                  <Tooltip label={t('sidepanel.guided.back')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.back')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={onBack}
                      disabled={isFirst}
                    >
                      <ArrowLeft size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.guided.next')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.next')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={onNext}
                      disabled={isLast}
                    >
                      <ArrowRight size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.guided.jumpToUnfilled')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.jumpToUnfilled')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={onJumpToUnfilled}
                    >
                      <ListChecks size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.guided.restart')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.restart')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={onRestart}
                    >
                      <RotateCcw size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.buttons.highlight')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.buttons.highlight')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={() => onHighlight(current)}
                      disabled={!current}
                    >
                      <Target size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Button
                    size="sm"
                    color="green"
                    leftSection={<CheckCircle2 size={16} />}
                    onClick={onFinish}
                  >
                    {t('sidepanel.guided.done')}
                  </Button>
                </Group>
              </>
            )}
          </Group>
          <Text fz="xs" c="dimmed">
            {progressText}
          </Text>
        </Stack>

        <Stack gap="sm">{guidedStarted && current && renderGuidedControls(current)}</Stack>

        <Card withBorder radius="md" shadow="sm">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>{t('sidepanel.guided.memory.heading')}</Text>
              <Tooltip label={t('sidepanel.guided.memory.refresh')} withArrow>
                <ActionIcon
                  aria-label={t('sidepanel.guided.memory.refresh')}
                  size="lg"
                  radius="md"
                  variant="light"
                  color="gray"
                  onClick={onRefreshMemory}
                >
                  <RefreshCcw size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            {memoryList.length === 0 ? (
              <Text fz="sm" c="dimmed">
                {t('sidepanel.guided.memory.empty')}
              </Text>
            ) : (
              <Stack gap={6}>
                {memoryList.map(({ key, association }) => (
                  <Group key={key} justify="space-between" align="center">
                    <Text fz="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                      {key} · {association.preferredSlot ?? ''}{' '}
                      {association.lastValue ? `· ${truncate(association.lastValue, 60)}` : ''}
                    </Text>
                    <Tooltip label={t('sidepanel.guided.memory.delete')} withArrow>
                      <ActionIcon
                        aria-label={t('sidepanel.guided.memory.delete')}
                        size="md"
                        radius="md"
                        variant="subtle"
                        color="red"
                        onClick={() => onRemoveMemory(key)}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ))}
                <Group justify="flex-end">
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    leftSection={<Trash2 size={14} />}
                    onClick={onClearMemory}
                  >
                    {t('sidepanel.guided.memory.clearAll')}
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        </Card>
      </Stack>
    </ModePanel>
  );
}
