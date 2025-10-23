import { Alert, Button, Group, Paper, Stack, Text } from '@mantine/core';

interface ParseCardProps {
  title: string;
  helper: string;
  providerSummary: string;
  providerNote?: string | null;
  settingsButtonLabel: string;
  parseButtonLabel: string;
  workingLabel: string;
  isWorking: boolean;
  disabled: boolean;
  parseWarning?: string | null;
  parseHint?: string | null;
  needProfileMessage?: string | null;
  onParse: () => void;
  onOpenSettings?: () => void;
}

export function ParseCard({
  title,
  helper,
  providerSummary,
  providerNote,
  settingsButtonLabel,
  parseButtonLabel,
  workingLabel,
  isWorking,
  disabled,
  parseWarning,
  parseHint,
  needProfileMessage,
  onParse,
  onOpenSettings,
}: ParseCardProps) {
  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      <Stack gap="md">
        <div>
          <Text fw={600} fz="lg">
            {title}
          </Text>
          <Text fz="sm" c="dimmed">
            {helper}
          </Text>
        </div>

        <Stack gap={4}>
          <Text fz="sm" fw={600}>
            {providerSummary}
          </Text>
          {providerNote && (
            <Alert variant="light" color="gray">
              {providerNote}
            </Alert>
          )}
        </Stack>

        <Group gap="sm">
          <Button onClick={onParse} disabled={disabled} radius="md" size="md">
            {isWorking ? workingLabel : parseButtonLabel}
          </Button>
          {onOpenSettings && (
            <Button variant="default" radius="md" size="md" onClick={onOpenSettings}>
              {settingsButtonLabel}
            </Button>
          )}
        </Group>

        {parseWarning && (
          <Alert variant="light" color="yellow">
            {parseWarning}
          </Alert>
        )}

        {needProfileMessage && (
          <Alert variant="light" color="gray">
            {needProfileMessage}
          </Alert>
        )}

        {parseHint && (
          <Alert variant="light" color="brand">
            {parseHint}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
