import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  ensureOnDeviceAvailability,
  promptOnDevice,
  type LanguageModelAvailability,
} from '../../shared/llm/chromePrompt';
import { promptOpenAI } from '../../shared/llm/openai';
import { buildResumePrompt } from '../../shared/llm/prompt';
import { extractTextFromPdf } from '../../shared/pdf/extractText';
import { saveProfile, storeFile } from '../../shared/storage/profiles';
import { getSettings, saveSettings } from '../../shared/storage/settings';
import { validateResume } from '../../shared/validate';
import type {
  AppSettings,
  ProviderConfig,
  ProviderSnapshot,
  ProfileRecord,
  ResumeExtractionResult,
} from '../../shared/types';

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

type StatusPhase = 'idle' | 'extracting' | 'generating' | 'saving' | 'complete' | 'error';

interface StatusState {
  phase: StatusPhase;
  message: string;
}

function toSnapshot(config: ProviderConfig): ProviderSnapshot {
  if (config.kind === 'openai') {
    return { kind: 'openai', model: config.model };
  }
  return { kind: 'on-device' };
}

function buildSettings(kind: 'on-device' | 'openai', apiKey: string, model: string): AppSettings {
  if (kind === 'openai') {
    return { provider: { kind: 'openai', apiKey, model } };
  }
  return { provider: { kind: 'on-device' } };
}

const providerLabels: Record<'on-device' | 'openai', string> = {
  'on-device': 'Chrome on-device (Prompt API)',
  openai: 'OpenAI',
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'on-device' | 'openai'>('on-device');
  const [availability, setAvailability] = useState<LanguageModelAvailability>('unavailable');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(OPENAI_DEFAULT_MODEL);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusState>({ phase: 'idle', message: '' });
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getSettings().then((loaded) => {
      setSettings(loaded);
      if (loaded.provider.kind === 'openai') {
        setSelectedProvider('openai');
        setApiKey(loaded.provider.apiKey);
        setModel(loaded.provider.model);
      } else {
        setSelectedProvider('on-device');
      }
    });
    ensureOnDeviceAvailability().then(setAvailability);
  }, []);

  const handleProviderChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value as 'on-device' | 'openai';
    setSelectedProvider(value);
    if (value === 'on-device') {
      const next = buildSettings('on-device', '', OPENAI_DEFAULT_MODEL);
      setSettings(next);
      await saveSettings(next);
    } else {
      const next = buildSettings('openai', apiKey, model);
      setSettings(next);
      await saveSettings(next);
    }
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (selectedProvider === 'openai') {
      const next = buildSettings('openai', value, model);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleModelChange = (value: string) => {
    setModel(value);
    if (selectedProvider === 'openai') {
      const next = buildSettings('openai', apiKey, value);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setStatus({ phase: 'idle', message: '' });
    setErrorDetails(null);
    setValidationErrors([]);
  };

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setFile(null);
  };

  const handleImport = async () => {
    if (!file) {
      return;
    }
    if (selectedProvider === 'openai' && !apiKey) {
      setStatus({ phase: 'error', message: 'Please provide an OpenAI API key.' });
      setErrorDetails(null);
      return;
    }
    setBusy(true);
    setErrorDetails(null);
    setValidationErrors([]);

    try {
      setStatus({ phase: 'extracting', message: 'Extracting PDF text…' });
      const { text } = await extractTextFromPdf(file);

      if (!text.trim()) {
        throw new Error('No extractable text found in the PDF. Is it a scanned document?');
      }

      const messages = buildResumePrompt(text);

      setStatus({ phase: 'generating', message: 'Generating structured resume data…' });
      let result: ResumeExtractionResult;
      let providerSnapshot: ProviderSnapshot;
      if (selectedProvider === 'on-device') {
        result = await promptOnDevice(messages);
        providerSnapshot = { kind: 'on-device' };
      } else {
        result = await promptOpenAI(
          { apiKey, model },
          messages,
        );
        providerSnapshot = { kind: 'openai', model };
      }

      setStatus({ phase: 'saving', message: 'Saving profile locally…' });
      const id = crypto.randomUUID();
      const fileRef = await storeFile(id, file);
      const validation = validateResume(result.resume);
      if (!validation.valid) {
        setValidationErrors(validation.errors ?? []);
      }

      const profile: ProfileRecord = {
        id,
        createdAt: new Date().toISOString(),
        provider: providerSnapshot,
        sourceFile: fileRef,
        rawText: text,
        resume: result.resume,
        custom: result.custom ?? {},
        validation: {
          valid: validation.valid,
          errors: validation.errors,
        },
      };

      await saveProfile(profile);

      const nextSettings = buildSettings(selectedProvider, apiKey, model);
      setSettings(nextSettings);
      await saveSettings(nextSettings);

      setStatus({ phase: 'complete', message: 'Import complete! Open the popup to review profiles.' });
      resetFileInput();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ phase: 'error', message: 'Import failed.' });
      setErrorDetails(message);
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  const canUseOnDevice = availability !== 'unavailable';
  const onDeviceNote =
    availability === 'downloadable'
      ? 'Available after model download (requires a user gesture).'
      : availability === 'downloading'
        ? 'Model download in progress. Keep this tab open.'
        : availability === 'unavailable'
          ? 'Not available in this profile or Chrome version.'
          : null;

  return (
    <div className="onboarding-container">
      <header>
        <h1>Resume Importer</h1>
        <p>Choose your AI provider, upload a PDF resume, and we&apos;ll extract JSON Resume data locally.</p>
      </header>

      <section className="card">
        <h2>1. Pick Provider</h2>
        <div className="provider-options">
          <label className={!canUseOnDevice ? 'disabled' : ''}>
            <input
              type="radio"
              name="provider"
              value="on-device"
              checked={selectedProvider === 'on-device'}
              onChange={handleProviderChange}
              disabled={!canUseOnDevice}
            />
            {providerLabels['on-device']}
          </label>
          {onDeviceNote && <p className="helper-text">{onDeviceNote}</p>}

          <label>
            <input
              type="radio"
              name="provider"
              value="openai"
              checked={selectedProvider === 'openai'}
              onChange={handleProviderChange}
            />
            {providerLabels.openai}
          </label>
          {selectedProvider === 'openai' && (
            <div className="openai-fields">
              <label className="field">
                API key
                <input
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(event) => handleApiKeyChange(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                Model
                <input
                  type="text"
                  value={model}
                  onChange={(event) => handleModelChange(event.target.value)}
                />
              </label>
              <p className="helper-text">
                We send requests directly to OpenAI from your browser. Keep API keys private; they are stored locally.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2>2. Upload Resume PDF</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
        />
        <button
          type="button"
          disabled={
            busy ||
            !file ||
            (selectedProvider === 'openai' && !apiKey)
          }
          onClick={handleImport}
        >
          {busy ? 'Working…' : 'Import'}
        </button>
        <p className="helper-text">
          All processing happens in this browser session. Scanned PDFs without selectable text are not supported.
        </p>
      </section>

      {status.message && (
        <section className={`status ${status.phase}`}>
          <strong>{status.message}</strong>
          {errorDetails && <p>{errorDetails}</p>}
        </section>
      )}

      {validationErrors.length > 0 && (
        <section className="status warning">
          <strong>JSON Resume validation warnings</strong>
          <ul>
            {validationErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
