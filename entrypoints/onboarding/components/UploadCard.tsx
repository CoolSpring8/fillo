import { Button, FileInput, Paper, Stack, Text } from '@mantine/core';

interface UploadCardProps {
  title: string;
  helper: string;
  buttonLabel: string;
  workingLabel: string;
  isWorking: boolean;
  currentSummary?: string | null;
  file: File | null;
  busy: boolean;
  onExtract: () => void;
  onFileSelect: (file: File | null) => void;
}

export function UploadCard({
  title,
  helper,
  buttonLabel,
  workingLabel,
  isWorking,
  currentSummary,
  file,
  busy,
  onExtract,
  onFileSelect,
}: UploadCardProps) {
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

        <FileInput
          radius="md"
          size="md"
          value={file}
          onChange={onFileSelect}
          accept="application/pdf"
          clearable
        />

        <Button
          onClick={onExtract}
          disabled={busy || !file}
          radius="md"
          size="md"
        >
          {isWorking ? workingLabel : buttonLabel}
        </Button>

        {currentSummary && (
          <Text fz="sm" c="dimmed">
            {currentSummary}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
