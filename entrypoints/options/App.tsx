import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Container, Loader, Stack, Text, Title } from '@mantine/core';
import {
  ensureOnDeviceAvailability,
  type LanguageModelAvailability,
} from '../../shared/llm/chromePrompt';
import {
  createOpenAIProvider,
  getSettings,
  saveSettings,
  OPENAI_DEFAULT_BASE_URL,
} from '../../shared/storage/settings';
import type { AppSettings } from '../../shared/types';
import { listAvailableAdapters } from '../../shared/apply/adapters';
import { ProviderCard } from './components/ProviderCard';
import { AdaptersCard, type AdapterItem } from './components/AdaptersCard';
import { AutofillCard } from './components/AutofillCard';

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

interface FeedbackState {
  kind: 'success' | 'error';
  message: string;
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<'on-device' | 'openai'>('on-device');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(OPENAI_DEFAULT_MODEL);
  const [apiBaseUrl, setApiBaseUrl] = useState(OPENAI_DEFAULT_BASE_URL);
  const [availability, setAvailability] = useState<LanguageModelAvailability>('unavailable');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busy, setBusy] = useState(false);
  const adapters = useMemo(() => listAvailableAdapters(), []);
  const [activeAdapters, setActiveAdapters] = useState<string[]>(adapters.map((adapter) => adapter.id));
  const [autoFallback, setAutoFallback] = useState<'skip' | 'pause'>('skip');
  const { t } = i18n;

  useEffect(() => {
    getSettings().then((settings) => {
      applySettings(settings);
      setLoaded(true);
    });
    ensureOnDeviceAvailability().then(setAvailability);
  }, []);

  const applySettings = (settings: AppSettings) => {
    if (settings.provider.kind === 'openai') {
      setProvider('openai');
      setApiKey(settings.provider.apiKey);
      setModel(settings.provider.model);
      setApiBaseUrl(settings.provider.apiBaseUrl);
    } else {
      setProvider('on-device');
      setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
    }
    setActiveAdapters(settings.adapters.length > 0 ? settings.adapters : adapters.map((adapter) => adapter.id));
    setAutoFallback(settings.autoFallback ?? 'skip');
  };

  const handleSave = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const baseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const selectedAdapters = activeAdapters.length > 0 ? activeAdapters : adapters.map((adapter) => adapter.id);
      const nextSettings: AppSettings =
        provider === 'openai'
          ? { provider: createOpenAIProvider(apiKey, model, baseUrl), adapters: selectedAdapters, autoFallback }
          : { provider: { kind: 'on-device' }, adapters: selectedAdapters, autoFallback };
      await saveSettings(nextSettings);
      setFeedback({ kind: 'success', message: t('options.feedback.saved') });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback({ kind: 'error', message });
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshAvailability = async () => {
    setAvailability(await ensureOnDeviceAvailability());
  };

  const handleSelectProvider = (value: 'on-device' | 'openai') => {
    setProvider(value);
    if (value === 'on-device') {
      setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
    } else if (!apiBaseUrl.trim().length) {
      setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
    }
  };

  const availabilityText = t('options.provider.availability', [availability]);

  const adapterItems = useMemo<AdapterItem[]>(
    () =>
      adapters.map((adapter) => ({
        id: adapter.id,
        name: t(adapter.nameKey),
        description: adapter.descriptionKey ? t(adapter.descriptionKey) : null,
        checked: activeAdapters.includes(adapter.id),
      })),
    [adapters, activeAdapters, t],
  );

  const handleToggleAdapter = (id: string, checked: boolean) => {
    setActiveAdapters((current) => {
      if (checked) {
        return Array.from(new Set([...current, id]));
      }
      return current.filter((item) => item !== id);
    });
  };

  const feedbackAlert = feedback ? (
    <Alert
      color={feedback.kind === 'success' ? 'green' : 'red'}
      variant="light"
      radius="lg"
      withCloseButton
      onClose={() => setFeedback(null)}
    >
      {feedback.message}
    </Alert>
  ) : null;

  const saveDisabled = provider === 'openai' && !apiKey;

  if (!loaded) {
    return (
      <Container size="sm" py="xl">
        <Stack align="center" gap="sm">
          <Loader size="sm" color="brand" />
          <Text fz="sm" c="dimmed">
            {t('options.loading')}
          </Text>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size="sm" py="xl">
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>{t('options.title')}</Title>
          <Text c="dimmed">{t('options.description')}</Text>
        </Stack>

        <ProviderCard
          title={t('options.provider.heading')}
          availabilityText={availabilityText}
          refreshLabel={t('options.provider.refresh')}
          providerLabelOnDevice={t('options.provider.onDevice')}
          providerLabelOpenAI={t('options.provider.openai')}
          provider={provider}
          apiKeyLabel={t('options.provider.apiKey')}
          modelLabel={t('options.provider.model')}
          baseUrlLabel={t('options.provider.apiBaseUrl')}
          apiKeyPlaceholder="sk-..."
          baseUrlPlaceholder="https://api.openai.com"
          apiKey={apiKey}
          model={model}
          apiBaseUrl={apiBaseUrl}
          onProviderChange={handleSelectProvider}
          onApiKeyChange={(value) => setApiKey(value)}
          onModelChange={(value) => setModel(value)}
          onApiBaseUrlChange={(value) => setApiBaseUrl(value)}
          onRefreshAvailability={handleRefreshAvailability}
        />

        <AdaptersCard
          title={t('options.adapters.heading')}
          description={t('options.adapters.description')}
          items={adapterItems}
          onToggle={handleToggleAdapter}
        />

        <AutofillCard
          title={t('options.autofill.heading')}
          description={t('options.autofill.description')}
          value={autoFallback}
          skipLabel={t('options.autofill.skip')}
          pauseLabel={t('options.autofill.pause')}
          onChange={setAutoFallback}
        />

        <Stack align="flex-end">
          <Button
            onClick={handleSave}
            disabled={saveDisabled}
            loading={busy}
            size="md"
            radius="md"
          >
            {busy ? t('options.actions.saving') : t('options.actions.save')}
          </Button>
        </Stack>

        {feedbackAlert}
      </Stack>
    </Container>
  );
}
