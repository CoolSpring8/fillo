import { Paper, PasswordInput, Radio, Stack, Text, TextInput } from '@mantine/core';

interface ProviderCardProps {
  title: string;
  helper: string;
  providerLabels: Record<'on-device' | 'openai' | 'gemini', string>;
  selectedProvider: 'on-device' | 'openai' | 'gemini';
  canUseOnDevice: boolean;
  onDeviceNote?: string | null;
  openAi: {
    apiKeyLabel: string;
    apiKeyPlaceholder: string;
    modelLabel: string;
    baseUrlLabel: string;
    baseUrlPlaceholder: string;
    helper: string;
    apiKey: string;
    model: string;
    apiBaseUrl: string;
    onApiKeyChange: (value: string) => void;
    onModelChange: (value: string) => void;
    onApiBaseUrlChange: (value: string) => void;
  };
  gemini: {
    apiKeyLabel: string;
    apiKeyPlaceholder: string;
    modelLabel: string;
    helper: string;
    apiKey: string;
    model: string;
    onApiKeyChange: (value: string) => void;
    onModelChange: (value: string) => void;
  };
  onProviderChange: (value: 'on-device' | 'openai' | 'gemini') => void | Promise<void>;
}

export function ProviderCard({
  title,
  helper,
  providerLabels,
  selectedProvider,
  canUseOnDevice,
  onDeviceNote,
  openAi,
  gemini,
  onProviderChange,
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
          onChange={(value) => onProviderChange(value as 'on-device' | 'openai' | 'gemini')}
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
            <Radio value="gemini" label={providerLabels.gemini} />
          </Stack>
        </Radio.Group>

        {selectedProvider === 'openai' && (
          <Stack gap="sm">
            <PasswordInput
              label={openAi.apiKeyLabel}
              placeholder={openAi.apiKeyPlaceholder}
              value={openAi.apiKey}
              onChange={(event) => openAi.onApiKeyChange(event.currentTarget.value)}
              autoComplete="off"
            />
            <TextInput
              label={openAi.modelLabel}
              value={openAi.model}
              onChange={(event) => openAi.onModelChange(event.currentTarget.value)}
            />
            <TextInput
              label={openAi.baseUrlLabel}
              placeholder={openAi.baseUrlPlaceholder}
              value={openAi.apiBaseUrl}
              onChange={(event) => openAi.onApiBaseUrlChange(event.currentTarget.value)}
            />
            <Text fz="sm" c="dimmed">
              {openAi.helper}
            </Text>
          </Stack>
        )}

        {selectedProvider === 'gemini' && (
          <Stack gap="sm">
            <PasswordInput
              label={gemini.apiKeyLabel}
              placeholder={gemini.apiKeyPlaceholder}
              value={gemini.apiKey}
              onChange={(event) => gemini.onApiKeyChange(event.currentTarget.value)}
              autoComplete="off"
            />
            <TextInput
              label={gemini.modelLabel}
              value={gemini.model}
              onChange={(event) => gemini.onModelChange(event.currentTarget.value)}
            />
            <Text fz="sm" c="dimmed">
              {gemini.helper}
            </Text>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
