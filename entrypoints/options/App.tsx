import { useEffect, useState } from 'react';
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
  };

  const handleSave = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const baseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const nextSettings: AppSettings =
        provider === 'openai'
          ? { provider: createOpenAIProvider(apiKey, model, baseUrl) }
          : { provider: { kind: 'on-device' } };
      await saveSettings(nextSettings);
      setFeedback({ kind: 'success', message: 'Settings saved.' });
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
        <p>Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="options-container">
      <header>
        <h1>Resume Importer Settings</h1>
        <p>Update your preferred provider and credentials. All values are stored locally via browser.storage.</p>
      </header>

      <section className="card">
        <h2>Provider</h2>
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
          Chrome on-device (Prompt API)
        </label>
        <div className="availability">
          <span>Availability: {availability}</span>
          <button type="button" onClick={handleRefreshAvailability}>
            Refresh
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
          OpenAI
        </label>

        {provider === 'openai' && (
          <div className="openai-fields">
            <label className="field">
              API key
              <input
                type="password"
                value={apiKey}
                placeholder="sk-..."
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="field">
              Model
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label className="field">
              API base URL
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

      <div className="actions">
        <button type="button" onClick={handleSave} disabled={busy || (provider === 'openai' && !apiKey)}>
          {busy ? 'Saving…' : 'Save settings'}
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
