import type { JSX, ReactNode } from 'react';
import { Paper, Stack } from '@mantine/core';

import type { ProfileRecord } from '../../../shared/types';
import type { FieldEntry, ViewState } from '../types';
import { ModePanel, StateAlert } from './ModeLayout';

type TranslateFn = (key: string, params?: unknown[]) => string;

interface FieldReviewModeProps {
  viewState: ViewState;
  selectedProfile: ProfileRecord | null;
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
  scanning,
  fields,
  selectedFieldId,
  toolbar,
  footer,
  renderFieldCard,
  t,
}: FieldReviewModeProps): JSX.Element {
  const content = (() => {
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
      <Paper
        px="md"
        py="sm"
        withBorder
        shadow="xs"
        style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
      >
        {toolbar}
      </Paper>
      <ModePanel>{content}</ModePanel>
      <Paper
        px="md"
        py="sm"
        withBorder
        shadow="sm"
        style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
      >
        {footer}
      </Paper>
    </Stack>
  );
}
