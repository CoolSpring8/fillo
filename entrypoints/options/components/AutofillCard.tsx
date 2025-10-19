import { Paper, Radio, Stack, Text } from '@mantine/core';

interface AutofillCardProps {
  title: string;
  description: string;
  value: 'skip' | 'pause';
  skipLabel: string;
  pauseLabel: string;
  onChange: (value: 'skip' | 'pause') => void;
}

export function AutofillCard({
  title,
  description,
  value,
  skipLabel,
  pauseLabel,
  onChange,
}: AutofillCardProps) {
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
        <Radio.Group value={value} onChange={(next) => onChange(next as 'skip' | 'pause')}>
          <Stack gap="xs">
            <Radio value="skip" label={skipLabel} />
            <Radio value="pause" label={pauseLabel} />
          </Stack>
        </Radio.Group>
      </Stack>
    </Paper>
  );
}
