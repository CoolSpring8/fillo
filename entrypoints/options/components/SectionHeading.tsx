import { Group, Stack, Text, ThemeIcon } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';

export interface SectionHeadingProps {
  icon: LucideIcon;
  color: string;
  title: string;
  description?: string;
}

export function SectionHeading({ icon: Icon, color, title, description }: SectionHeadingProps) {
  return (
    <Stack gap={4}>
      <Group gap="xs" align="center">
        <ThemeIcon size={36} radius="xl" variant="light" color={color}>
          <Icon size={18} strokeWidth={2} />
        </ThemeIcon>
        <Text fw={600} fz="xl">
          {title}
        </Text>
      </Group>
      {description ? (
        <Text fz="sm" c="dimmed">
          {description}
        </Text>
      ) : null}
    </Stack>
  );
}
