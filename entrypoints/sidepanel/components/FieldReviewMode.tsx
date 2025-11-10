import type { JSX, ReactNode } from 'react';
import { Button, Paper, Stack, Text, Title } from '@mantine/core';
import { CheckCircle2 } from 'lucide-react';

import type { ProfileRecord } from '../../../shared/types';
import type { FieldEntry, ViewState } from '../types';
import { ModePanel, StateAlert } from './ModeLayout';

type TranslateFn = (key: string, params?: unknown[]) => string;

interface FieldReviewModeProps {
  viewState: ViewState;
  selectedProfile: ProfileRecord | null;
  permissionGranted: boolean;
  onAllowPermission: () => void;
  scanning: boolean;
  fields: FieldEntry[];
  selectedFieldId: string | null;
  toolbar: ReactNode;
  footer: ReactNode;
  renderFieldCard: (entry: FieldEntry, options?: { isSelected?: boolean }) => JSX.Element;
  t: TranslateFn;
}

export function FieldReviewMode({
  viewState,
  selectedProfile,
  permissionGranted,
  onAllowPermission,
  scanning,
  fields,
  selectedFieldId,
  toolbar,
  footer,
  renderFieldCard,
  t,
}: FieldReviewModeProps): JSX.Element {
  const content = (() => {
    if (!permissionGranted) {
      return (
        <Stack align="center" justify="center" style={{ minHeight: 280 }}>
          <Paper radius={0} withBorder={false} p="xl" style={{ width: '100%', maxWidth: 460 }}>
            <Stack gap="md" align="center">
              <Title order={3} ta="center">
                {t('sidepanel.permission.title')}
              </Title>
              <Text ta="center" c="dimmed">
                {t('sidepanel.permission.body')}
              </Text>
              <Paper px="md" py="sm" radius="lg" withBorder style={{ width: '100%' }}>
                <Text fz="sm" ta="center">
                  {t('sidepanel.permission.note')}
                </Text>
              </Paper>
              <Button
                size="md"
                radius="lg"
                leftSection={<CheckCircle2 size={16} />}
                onClick={onAllowPermission}
              >
                {t('sidepanel.permission.allow')}
              </Button>
            </Stack>
          </Paper>
        </Stack>
      );
    }
    if (viewState.loadingProfiles) {
      return <StateAlert message={t('sidepanel.states.loadingProfiles')} tone="brand" />;
    }
    if (viewState.error) {
      return <StateAlert message={t('sidepanel.states.error', [viewState.error])} tone="red" />;
    }
    if (!selectedProfile) {
      return <StateAlert message={t('sidepanel.states.noProfile')} />;
    }
    if (scanning) {
      return <StateAlert message={t('sidepanel.toolbar.scanning')} tone="brand" />;
    }
    if (fields.length === 0) {
      return <StateAlert message={t('sidepanel.states.noFields')} />;
    }
    return (
      <Stack gap="sm">
        {fields.map((entry) =>
          renderFieldCard(entry, { isSelected: entry.field.id === selectedFieldId }),
        )}
      </Stack>
    );
  })();

  return (
    <Stack gap={0} style={{ height: '100%', overflow: 'hidden' }}>
      {permissionGranted && (
        <Paper
          px="md"
          py="sm"
          withBorder
          shadow="xs"
          style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
        >
          {toolbar}
        </Paper>
      )}
      <ModePanel>{content}</ModePanel>
      {permissionGranted && (
        <Paper
          px="md"
          py="sm"
          withBorder
          shadow="sm"
          style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
        >
          {footer}
        </Paper>
      )}
    </Stack>
  );
}
