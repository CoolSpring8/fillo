import {
  Badge,
  Button,
  Paper,
  PasswordInput,
  Radio,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';

interface ProviderCardProps {
  title: string;
  availabilityText: string;
  refreshLabel: string;
  providerLabelOnDevice: string;
  providerLabelOpenAI: string;
  provider: 'on-device' | 'openai';
  apiKeyLabel: string;
  modelLabel: string;
  baseUrlLabel: string;
  apiKeyPlaceholder: string;
  baseUrlPlaceholder: string;
  apiKey: string;
  model: string;
  apiBaseUrl: string;
  onProviderChange: (provider: 'on-device' | 'openai') => void;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiBaseUrlChange: (value: string) => void;
  onRefreshAvailability: () => void;
}

export function ProviderCard({
  title,
  availabilityText,
  refreshLabel,
  providerLabelOnDevice,
  providerLabelOpenAI,
  provider,
  apiKeyLabel,
  modelLabel,
  baseUrlLabel,
  apiKeyPlaceholder,
  baseUrlPlaceholder,
  apiKey,
  model,
  apiBaseUrl,
  onProviderChange,
  onApiKeyChange,
  onModelChange,
  onApiBaseUrlChange,
  onRefreshAvailability,
}: ProviderCardProps) {
  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      <Stack gap="md">
        <Stack gap={4}>
          <Text fw={600} fz="lg">
            {title}
          </Text>
          <Stack gap={4}>
            <Badge variant="light" color="blue" size="sm" w="fit-content">
              {availabilityText}
            </Badge>
            <Button
              onClick={onRefreshAvailability}
              variant="subtle"
              color="blue"
              size="xs"
              w="fit-content"
            >
              {refreshLabel}
            </Button>
          </Stack>
        </Stack>

        <Radio.Group
          value={provider}
          onChange={(value) => onProviderChange(value as 'on-device' | 'openai')}
        >
          <Stack gap="xs">
            <Radio value="on-device" label={providerLabelOnDevice} />
            <Radio value="openai" label={providerLabelOpenAI} />
          </Stack>
        </Radio.Group>

        {provider === 'openai' && (
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
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
