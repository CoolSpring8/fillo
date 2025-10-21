import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  List,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';

export interface ProfileAccordionItem {
  id: string;
  title: string;
  importedAtLabel: string;
  parsingSummary: string;
  fileSummary: string;
  hasValidationWarning: boolean;
  validationLabel?: string | null;
  validationErrors: string[];
  resumeJson: string;
  hasResumeData: boolean;
  resumeEmptyLabel: string;
  rawText: string;
  rawLabel: string;
  resumeLabel: string;
  validationHeading: string;
}

interface ProfileAccordionProps {
  items: ProfileAccordionItem[];
  expandedId: string | null;
  onExpandedChange: (value: string | null) => void;
  onDelete: (id: string) => void;
  deleteLabel: string;
}

export function ProfileAccordion({
  items,
  expandedId,
  onExpandedChange,
  onDelete,
  deleteLabel,
}: ProfileAccordionProps) {
  return (
    <Accordion
      value={expandedId ?? undefined}
      onChange={(value) => onExpandedChange(value as string | null)}
      multiple={false}
      radius="lg"
      variant="separated"
    >
      {items.map((item) => (
        <Accordion.Item key={item.id} value={item.id}>
          <Accordion.Control>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={4} flex={1}>
                <Group gap="xs">
                  <Text fw={600}>{item.title}</Text>
                  {item.hasValidationWarning && item.validationLabel && (
                    <Badge color="yellow" variant="light">
                      {item.validationLabel}
                    </Badge>
                  )}
                </Group>
                <Text c="dimmed" fz="sm">
                  {item.importedAtLabel}
                </Text>
                <Text c="dimmed" fz="sm">
                  {item.parsingSummary}
                </Text>
                <Text c="dimmed" fz="sm">
                  {item.fileSummary}
                </Text>
              </Stack>
              <Button
                variant="subtle"
                color="red"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.id);
                }}
              >
                {deleteLabel}
              </Button>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
              <Stack gap="xs">
                <Text fw={600} fz="sm">
                  {item.resumeLabel}
                </Text>
                {item.hasResumeData ? (
                  <Paper withBorder radius="md" p="sm">
                    <ScrollArea h={180} type="hover">
                      <Text
                        component="pre"
                        fz="sm"
                        style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      >
                        {item.resumeJson}
                      </Text>
                    </ScrollArea>
                  </Paper>
                ) : (
                  <Alert variant="light" color="gray">
                    {item.resumeEmptyLabel}
                  </Alert>
                )}
              </Stack>

              <Stack gap="xs">
                <Text fw={600} fz="sm">
                  {item.rawLabel}
                </Text>
                <Paper withBorder radius="md" p="sm">
                  <ScrollArea h={220} type="hover">
                    <Text
                      component="pre"
                      fz="sm"
                      style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    >
                      {item.rawText}
                    </Text>
                  </ScrollArea>
                </Paper>
              </Stack>

              {item.validationErrors.length > 0 && (
                <Stack gap="xs">
                  <Text fw={600} fz="sm">
                    {item.validationHeading}
                  </Text>
                  <Alert variant="light" color="yellow">
                    <List spacing={4} size="sm">
                      {item.validationErrors.map((error) => (
                        <List.Item key={error}>{error}</List.Item>
                      ))}
                    </List>
                  </Alert>
                </Stack>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
