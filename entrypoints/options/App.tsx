import { useEffect, useMemo, useState } from 'react';
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

  if (!loaded) {
    return (
      <div className="options-container">
        <p>{t('options.loading')}</p>
      </div>
    );
  }

  return (
    <div className="options-container">
      <header>
        <h1>{t('options.title')}</h1>
        <p>{t('options.description')}</p>
      </header>

      <section className="card">
        <h2>{t('options.provider.heading')}</h2>
        <label>
          <input
            type="radio"
            name="provider"
            value="on-device"
            checked={provider === 'on-device'}
            onChange={() => {
              setProvider('on-device');
              setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
            }}
          />
          {t('options.provider.onDevice')}
        </label>
        <div className="availability">
          <span>{t('options.provider.availability', [availability])}</span>
          <button type="button" onClick={handleRefreshAvailability}>
            {t('options.provider.refresh')}
          </button>
        </div>

        <label>
          <input
            type="radio"
            name="provider"
            value="openai"
            checked={provider === 'openai'}
            onChange={() => {
              setProvider('openai');
              if (!apiBaseUrl.trim().length) {
                setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
              }
            }}
          />
          {t('options.provider.openai')}
        </label>

        {provider === 'openai' && (
          <div className="openai-fields">
            <label className="field">
              {t('options.provider.apiKey')}
              <input
                type="password"
                value={apiKey}
                placeholder="sk-..."
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="field">
              {t('options.provider.model')}
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label className="field">
              {t('options.provider.apiBaseUrl')}
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder="https://api.openai.com"
              />
            </label>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t('options.adapters.heading')}</h2>
        <p>{t('options.adapters.description')}</p>
        <div className="adapter-list">
          {adapters.map((adapter) => {
            const checked = activeAdapters.includes(adapter.id);
            const name = t(adapter.nameKey);
            const description = adapter.descriptionKey ? t(adapter.descriptionKey) : null;
            return (
              <label key={adapter.id} className="field checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setActiveAdapters((current) => {
                      if (event.target.checked) {
                        return Array.from(new Set([...current, adapter.id]));
                      }
                      return current.filter((id) => id !== adapter.id);
                    });
                  }}
                />
                <span>
                  <strong>{name}</strong>
                  {description && <span className="caption"> — {description}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>{t('options.autofill.heading')}</h2>
        <p>{t('options.autofill.description')}</p>
        <label className="field radio">
          <input
            type="radio"
            name="auto-fallback"
            value="skip"
            checked={autoFallback === 'skip'}
            onChange={() => setAutoFallback('skip')}
          />
          <span>{t('options.autofill.skip')}</span>
        </label>
        <label className="field radio">
          <input
            type="radio"
            name="auto-fallback"
            value="pause"
            checked={autoFallback === 'pause'}
            onChange={() => setAutoFallback('pause')}
          />
          <span>{t('options.autofill.pause')}</span>
        </label>
      </section>

      <div className="actions">
        <button type="button" onClick={handleSave} disabled={busy || (provider === 'openai' && !apiKey)}>
          {busy ? t('options.actions.saving') : t('options.actions.save')}
        </button>
      </div>

      {feedback && (
        <section className={`status ${feedback.kind === 'success' ? 'complete' : 'error'}`}>
          {feedback.message}
        </section>
      )}
    </div>
  );
}
