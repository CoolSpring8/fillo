import { Button, Group, Modal, Stack, Text } from '@mantine/core';

interface ParseAgainModalProps {
  opened: boolean;
  busy: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ParseAgainModal({
  opened,
  busy,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onClose,
  onConfirm,
}: ParseAgainModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack gap="md">
        <Text>{description}</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
