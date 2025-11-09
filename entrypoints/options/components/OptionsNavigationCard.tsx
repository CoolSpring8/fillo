import { type CSSProperties } from 'react';
import { Group, NavLink, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { Compass } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface TocNavLink {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

interface OptionsNavigationCardProps {
  title: string;
  helper: string;
  links: TocNavLink[];
  onNavigate: (id: string) => void;
  className?: string;
  style?: CSSProperties;
}

export function OptionsNavigationCard({
  title,
  helper,
  links,
  onNavigate,
  className,
  style,
}: OptionsNavigationCardProps) {
  return (
    <Paper
      withBorder
      radius="lg"
      shadow="sm"
      p="md"
      w={{ base: '100%', md: 260 }}
      className={className}
      style={style}
    >
      <Stack gap="md" className="fillo-options__toc-content">
        <Stack gap={4}>
          <Group gap="xs" align="center">
            <ThemeIcon size={32} radius="xl" variant="light" color="brand">
              <Compass size={18} strokeWidth={2} />
            </ThemeIcon>
            <Text fw={600}>{title}</Text>
          </Group>
          <Text fz="xs" c="dimmed">
            {helper}
          </Text>
        </Stack>
        <Stack gap="xs">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.id}
                label={link.label}
                component="button"
                type="button"
                onClick={() => onNavigate(link.id)}
                style={{ textAlign: 'left' }}
                className="fillo-options__toc-link"
                leftSection={
                  <ThemeIcon size={30} radius="lg" variant="light" color={link.color}>
                    <Icon size={16} strokeWidth={2} />
                  </ThemeIcon>
                }
              />
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
}
