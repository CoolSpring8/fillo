import { Paper, PasswordInput, Radio, Stack, Text, TextInput } from '@mantine/core';

interface ProviderCardProps {
  title: string;
  helper: string;
  providerLabels: Record<'on-device' | 'openai', string>;
  selectedProvider: 'on-device' | 'openai';
  canUseOnDevice: boolean;
  onDeviceNote?: string | null;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  modelLabel: string;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  openAiHelper: string;
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  onProviderChange: (value: 'on-device' | 'openai') => void | Promise<void>;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiBaseUrlChange: (value: string) => void;
}

export function ProviderCard({
  title,
  helper,
  providerLabels,
  selectedProvider,
  canUseOnDevice,
  onDeviceNote,
  apiKeyLabel,
  apiKeyPlaceholder,
  modelLabel,
  baseUrlLabel,
  baseUrlPlaceholder,
  openAiHelper,
  apiKey,
  model,
  apiBaseUrl,
  onProviderChange,
  onApiKeyChange,
  onModelChange,
  onApiBaseUrlChange,
}: ProviderCardProps) {
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

        <Radio.Group
          value={selectedProvider}
          onChange={(value) => onProviderChange(value as 'on-device' | 'openai')}
        >
          <Stack gap={6}>
            <Radio
              value="on-device"
              label={providerLabels['on-device']}
              disabled={!canUseOnDevice}
            />
            {onDeviceNote && (
              <Text fz="sm" c="dimmed" pl="sm">
                {onDeviceNote}
              </Text>
            )}
            <Radio value="openai" label={providerLabels.openai} />
          </Stack>
        </Radio.Group>

        {selectedProvider === 'openai' && (
          <Stack gap="sm">
            <PasswordInput
              label={apiKeyLabel}
              placeholder={apiKeyPlaceholder}
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.currentTarget.value)}
              autoComplete="off"
            />
            <TextInput
              label={modelLabel}
              value={model}
              onChange={(event) => onModelChange(event.currentTarget.value)}
            />
            <TextInput
              label={baseUrlLabel}
              placeholder={baseUrlPlaceholder}
              value={apiBaseUrl}
              onChange={(event) => onApiBaseUrlChange(event.currentTarget.value)}
            />
            <Text fz="sm" c="dimmed">
              {openAiHelper}
            </Text>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
