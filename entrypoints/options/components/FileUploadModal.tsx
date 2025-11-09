import { Button, Modal, Stack, Text } from '@mantine/core';

interface FileUploadModalProps {
  opened: boolean;
  busy: boolean;
  title: string;
  description: string;
  parseLabel: string;
  storeLabel: string;
  onClose: () => void;
  onParse: () => void;
  onStore: () => void;
}

export function FileUploadModal({
  opened,
  busy,
  title,
  description,
  parseLabel,
  storeLabel,
  onClose,
  onParse,
  onStore,
}: FileUploadModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Stack gap="md">
        <Text>{description}</Text>
        <Stack gap="sm">
          <Button onClick={onParse} disabled={busy}>
            {parseLabel}
          </Button>
          <Button variant="default" onClick={onStore} disabled={busy}>
            {storeLabel}
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
