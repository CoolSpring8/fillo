import { Alert, Button, Group, Paper, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';

interface EditProfileCardProps {
  title: string;
  helper: string;
  rawLabel: string;
  rawValue: string;
  rawSummary: string;
  resumeLabel: string;
  resumeValue: string;
  resumeHelper: string;
  saveLabel: string;
  resetLabel: string;
  workingLabel: string;
  disabledSave: boolean;
  disabledReset: boolean;
  isWorking: boolean;
  errorMessage?: string | null;
  onSave: () => void;
  onReset: () => void;
  onRawChange: (value: string) => void;
  onResumeChange: (value: string) => void;
}

export function EditProfileCard({
  title,
  helper,
  rawLabel,
  rawValue,
  rawSummary,
  resumeLabel,
  resumeValue,
  resumeHelper,
  saveLabel,
  resetLabel,
  workingLabel,
  disabledSave,
  disabledReset,
  isWorking,
  errorMessage,
  onSave,
  onReset,
  onRawChange,
  onResumeChange,
}: EditProfileCardProps) {
  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600} fz="lg">
              {title}
            </Text>
            <Text fz="sm" c="dimmed">
              {helper}
            </Text>
          </div>
          <Group gap="xs">
            <Button variant="light" color="gray" onClick={onReset} disabled={disabledReset}>
              {resetLabel}
            </Button>
            <Button onClick={onSave} disabled={disabledSave} radius="md">
              {isWorking ? workingLabel : saveLabel}
            </Button>
          </Group>
        </Group>

        {errorMessage && (
          <Alert variant="light" color="red">
            {errorMessage}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Textarea
            label={rawLabel}
            value={rawValue}
            onChange={(event) => onRawChange(event.currentTarget.value)}
            minRows={12}
            autosize
            description={rawSummary}
            spellCheck={false}
          />
          <Textarea
            label={resumeLabel}
            value={resumeValue}
            onChange={(event) => onResumeChange(event.currentTarget.value)}
            minRows={12}
            autosize
            description={resumeHelper}
            spellCheck={false}
          />
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}
