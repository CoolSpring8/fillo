import { Paper, Stack, Switch, Text } from '@mantine/core';

interface OverlayCardProps {
  title: string;
  description: string;
  toggleLabel: string;
  enabledHint: string;
  disabledHint: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function OverlayCard({
  title,
  description,
  toggleLabel,
  enabledHint,
  disabledHint,
  value,
  onChange,
}: OverlayCardProps) {
  const hint = value ? enabledHint : disabledHint;

  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      <Stack gap="md">
        <Stack gap={4}>
          <Text fw={600} fz="lg">
            {title}
          </Text>
          <Text fz="sm" c="dimmed">
            {description}
          </Text>
        </Stack>
        <Stack gap={4}>
          <Switch
            checked={value}
            onChange={(event) => onChange(event.currentTarget.checked)}
            label={toggleLabel}
            size="md"
          />
          <Text fz="sm" c="dimmed">
            {hint}
          </Text>
        </Stack>
      </Stack>
    </Paper>
  );
}
