import { Affix, Button, CopyButton, Paper, Stack, Text, Textarea } from '@mantine/core';

interface CopyHelperAffixProps {
  visible: boolean;
  rawText: string;
  heading: string;
  description: string;
  copyLabel: string;
  copiedLabel: string;
}

export function CopyHelperAffix({
  visible,
  rawText,
  heading,
  description,
  copyLabel,
  copiedLabel,
}: CopyHelperAffixProps) {
  if (!visible) {
    return null;
  }

  return (
    <Affix position={{ bottom: 24, right: 24 }}>
      <Paper shadow="lg" radius="md" p="md" style={{ width: 280 }}>
        <Stack gap="sm">
          <Text fw={600}>{heading}</Text>
          <Text fz="sm" c="dimmed">
            {description}
          </Text>
          <Textarea value={rawText} readOnly autosize minRows={6} maxRows={12} spellCheck={false} />
          <CopyButton value={rawText}>
            {({ copied, copy }) => (
              <Button
                onClick={copy}
                fullWidth
                variant={copied ? 'light' : 'filled'}
                color={copied ? 'green' : 'brand'}
              >
                {copied ? copiedLabel : copyLabel}
              </Button>
            )}
          </CopyButton>
        </Stack>
      </Paper>
    </Affix>
  );
}
