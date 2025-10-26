import type { JSX, ReactNode } from 'react';
import { Alert, ScrollArea, Stack } from '@mantine/core';

interface StateAlertProps {
  message: string;
  tone?: 'gray' | 'red' | 'brand';
}

export function StateAlert({ message, tone = 'gray' }: StateAlertProps): JSX.Element {
  return (
    <Alert color={tone} variant="light" radius="lg">
      {message}
    </Alert>
  );
}

interface ModePanelProps {
  children: ReactNode;
}

export function ModePanel({ children }: ModePanelProps): JSX.Element {
  return (
    <ScrollArea style={{ flex: 1, height: '100%' }} px="md" py="md">
      <Stack gap="md">{children}</Stack>
    </ScrollArea>
  );
}
