import { Checkbox, Paper, Stack, Text } from '@mantine/core';

export interface AdapterItem {
  id: string;
  name: string;
  description?: string | null;
  checked: boolean;
}

interface AdaptersCardProps {
  title: string;
  description: string;
  items: AdapterItem[];
  onToggle: (id: string, checked: boolean) => void;
}

export function AdaptersCard({ title, description, items, onToggle }: AdaptersCardProps) {
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
        <Stack gap="sm">
          {items.map((item) => (
            <Checkbox
              key={item.id}
              label={
                <span>
                  <Text component="span" fw={600} fz="sm">
                    {item.name}
                  </Text>
                  {item.description && (
                    <Text component="span" fz="sm" c="dimmed">
                      {' — '}
                      {item.description}
                    </Text>
                  )}
                </span>
              }
              checked={item.checked}
              onChange={(event) => onToggle(item.id, event.currentTarget.checked)}
            />
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}
