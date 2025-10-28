import type { JSX } from 'react';
import { ActionIcon, Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { RefreshCcw, Trash2 } from 'lucide-react';
import type { MemoryAssociation } from '../../../shared/memory/types';

export interface MemoryEntry {
  key: string;
  association: MemoryAssociation;
}

interface MemoryCardProps {
  title: string;
  description: string;
  refreshLabel: string;
  clearLabel: string;
  deleteLabel: string;
  emptyLabel: string;
  loadingLabel: string;
  error?: string;
  items: MemoryEntry[];
  loading: boolean;
  onRefresh: () => void;
  onClearAll: () => void;
  onDelete: (key: string) => void;
  formatEntry?: (entry: MemoryEntry) => string;
}

const truncate = (value: string, limit = 80): string => {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
};

export function MemoryCard({
  title,
  description,
  refreshLabel,
  clearLabel,
  deleteLabel,
  emptyLabel,
  loadingLabel,
  error,
  items,
  loading,
  onRefresh,
  onClearAll,
  onDelete,
  formatEntry,
}: MemoryCardProps): JSX.Element {
  const renderEntry = (entry: MemoryEntry): string => {
    if (formatEntry) {
      return formatEntry(entry);
    }
    const { key, association } = entry;
    const parts: string[] = [key];
    if (association.preferredSlot) {
      parts.push(`slot: ${association.preferredSlot}`);
    }
    if (association.lastValue) {
      parts.push(`value: ${truncate(association.lastValue, 60)}`);
    }
    return parts.join(' · ');
  };

  return (
    <Card withBorder radius="lg" shadow="sm" padding="lg">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Text fw={600}>{title}</Text>
            <Text fz="sm" c="dimmed">
              {description}
            </Text>
          </Stack>
          <Tooltip label={refreshLabel} withArrow>
            <ActionIcon
              aria-label={refreshLabel}
              size="lg"
              radius="md"
              variant="light"
              color="gray"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCcw size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {error ? (
          <Text fz="sm" c="red">
            {error}
          </Text>
        ) : null}

        {loading ? (
          <Text fz="sm" c="dimmed">
            {loadingLabel}
          </Text>
        ) : items.length === 0 ? (
          <Text fz="sm" c="dimmed">
            {emptyLabel}
          </Text>
        ) : (
          <Stack gap={6}>
            {items.map((entry) => (
              <Group key={entry.key} justify="space-between" align="center">
                <Text fz="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                  {renderEntry(entry)}
                </Text>
                <Tooltip label={deleteLabel} withArrow>
                  <ActionIcon
                    aria-label={deleteLabel}
                    size="md"
                    radius="md"
                    variant="subtle"
                    color="red"
                    onClick={() => onDelete(entry.key)}
                    disabled={loading}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
            <Group justify="flex-end">
              <Button
                size="xs"
                color="red"
                variant="light"
                leftSection={<Trash2 size={14} />}
                onClick={onClearAll}
                disabled={loading || items.length === 0}
              >
                {clearLabel}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
