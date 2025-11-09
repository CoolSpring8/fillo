import { Alert, Button, Group, Paper, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';

export interface ProfilesCardProfile {
  id: string;
  name: string;
  summary: string;
  parsing: string;
  isActive: boolean;
}

interface ProfilesCardProps {
  title: string;
  countLabel: string;
  addLabel: string;
  loadingLabel: string;
  emptyLabel: string;
  deleteLabel: string;
  errorLabel?: string;
  headingIcon?: LucideIcon;
  headingIconColor?: string;
  profiles: ProfilesCardProfile[];
  isLoading: boolean;
  busy: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ProfilesCard({
  title,
  countLabel,
  addLabel,
  loadingLabel,
  emptyLabel,
  deleteLabel,
  errorLabel,
  headingIcon,
  headingIconColor = 'indigo',
  profiles,
  isLoading,
  busy,
  onCreate,
  onSelect,
  onDelete,
}: ProfilesCardProps) {
  const HeadingIcon = headingIcon;
  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs" align="center">
            {HeadingIcon ? (
              <ThemeIcon size={32} radius="xl" variant="light" color={headingIconColor}>
                <HeadingIcon size={18} strokeWidth={2} />
              </ThemeIcon>
            ) : null}
            <Text fw={600} fz="lg">
              {title}
            </Text>
          </Group>
          <Text fz="sm" c="dimmed">
            {countLabel}
          </Text>
        </div>
        <Button variant="light" onClick={onCreate} disabled={busy}>
          {addLabel}
        </Button>
      </Group>

      {isLoading && profiles.length === 0 && (
        <Alert mt="md" variant="light" color="brand">
          {loadingLabel}
        </Alert>
      )}

      {errorLabel && (
        <Alert mt="md" variant="light" color="red">
          {errorLabel}
        </Alert>
      )}

      {!isLoading && profiles.length === 0 && (
        <Text mt="md" fz="sm" c="dimmed">
          {emptyLabel}
        </Text>
      )}

      {profiles.length > 0 && (
        <Stack mt="md" gap="sm">
          {profiles.map((profile) => {
            const background = profile.isActive
              ? 'var(--mantine-color-brand-0)'
              : 'var(--mantine-color-body)';
            const borderColor = profile.isActive ? 'var(--mantine-color-brand-4)' : undefined;

            return (
              <Paper
                key={profile.id}
                radius="md"
                withBorder
                shadow={profile.isActive ? 'md' : 'xs'}
                bg={background}
                style={borderColor ? { borderColor } : undefined}
                p="md"
              >
                <Group align="flex-start" justify="space-between" wrap="nowrap">
                  <UnstyledButton
                    onClick={() => onSelect(profile.id)}
                    aria-pressed={profile.isActive}
                    style={{ flex: 1, textAlign: 'left' }}
                  >
                    <Stack gap={4}>
                      <Text fw={600}>{profile.name}</Text>
                      <Text fz="sm" c="dimmed">
                        {profile.summary}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {profile.parsing}
                      </Text>
                    </Stack>
                  </UnstyledButton>
                  <Button
                    variant="subtle"
                    color="red"
                    onClick={() => onDelete(profile.id)}
                    disabled={busy}
                  >
                    {deleteLabel}
                  </Button>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
