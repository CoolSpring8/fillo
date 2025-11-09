import { Button, Group, Paper, PasswordInput, Progress, Radio, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';

interface OnDeviceSupportProps {
  note?: string | null;
  actionLabel?: string;
  actionDisabled?: boolean;
  progress?: number;
  onAction?: () => void | Promise<void>;
}

interface ProviderCardProps {
  title: string;
  helper: string;
  headingIcon?: LucideIcon;
  headingIconColor?: string;
  providerLabels: Record<'on-device' | 'openai' | 'gemini', string>;
  selectedProvider: 'on-device' | 'openai' | 'gemini';
  canUseOnDevice: boolean;
  onDeviceSupport?: OnDeviceSupportProps;
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
  headingIcon,
  headingIconColor = 'brand',
  providerLabels,
  selectedProvider,
  canUseOnDevice,
  onDeviceSupport,
  openAi,
  gemini,
  onProviderChange,
}: ProviderCardProps) {
  const showOnDeviceSupport =
    !!onDeviceSupport &&
    (Boolean(onDeviceSupport.note) ||
      typeof onDeviceSupport.progress === 'number' ||
      Boolean(onDeviceSupport.actionLabel));
  const HeadingIcon = headingIcon;

  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      <Stack gap="md">
        <div>
          <Group gap="xs" align="center">
            {HeadingIcon ? (
              <ThemeIcon size={32} radius="xl" variant="light" color={headingIconColor}>
                <HeadingIcon size={18} strokeWidth={2} />
              </ThemeIcon>
            ) : null}
            <Text fw={600} fz="lg">
              {title}
            </Text>
          </Group>
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
            {showOnDeviceSupport && onDeviceSupport && (
              <Stack gap={6} pl="sm">
                {onDeviceSupport.note && (
                  <Text fz="sm" c="dimmed">
                    {onDeviceSupport.note}
                  </Text>
                )}
                {typeof onDeviceSupport.progress === 'number' && (
                  <Progress value={onDeviceSupport.progress} size="sm" />
                )}
                {onDeviceSupport.actionLabel && (
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      if (onDeviceSupport.onAction) {
                        void onDeviceSupport.onAction();
                      }
                    }}
                    disabled={onDeviceSupport.actionDisabled || !onDeviceSupport.onAction}
                  >
                    {onDeviceSupport.actionLabel}
                  </Button>
                )}
              </Stack>
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
