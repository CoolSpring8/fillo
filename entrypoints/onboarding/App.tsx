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
import {
  createOpenAIProvider,
  getSettings,
  saveSettings,
  OPENAI_DEFAULT_BASE_URL,
} from '../../shared/storage/settings';
import { getAllAdapterIds } from '../../shared/apply/slots';
import { validateResume } from '../../shared/validate';
import type {
  AppSettings,
  ProviderConfig,
  ProviderSnapshot,
  ProfileRecord,
  ResumeExtractionResult,
} from '../../shared/types';

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

type StatusPhase = 'idle' | 'extracting' | 'parsing' | 'saving' | 'complete' | 'error';

interface StatusState {
  phase: StatusPhase;
  message: string;
}

function buildOpenAIProvider(apiKey: string, model: string, apiBaseUrl: string): ProviderConfig {
  return createOpenAIProvider(apiKey, model, apiBaseUrl);
}

function buildSettings(
  kind: 'on-device' | 'openai',
  apiKey: string,
  model: string,
  apiBaseUrl: string,
  adapters: string[],
): AppSettings {
  if (kind === 'openai') {
    return { provider: buildOpenAIProvider(apiKey, model, apiBaseUrl), adapters };
  }
  return { provider: { kind: 'on-device' }, adapters };
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
  const [apiBaseUrl, setApiBaseUrl] = useState(OPENAI_DEFAULT_BASE_URL);
  const [file, setFile] = useState<File | null>(null);
  const [currentProfile, setCurrentProfile] = useState<ProfileRecord | null>(null);
  const [status, setStatus] = useState<StatusState>({ phase: 'idle', message: '' });
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<'extract' | 'parse' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getSettings().then((loaded) => {
      setSettings(loaded);
      if (loaded.provider.kind === 'openai') {
        setSelectedProvider('openai');
        setApiKey(loaded.provider.apiKey);
        setModel(loaded.provider.model);
        setApiBaseUrl(loaded.provider.apiBaseUrl);
      } else {
        setSelectedProvider('on-device');
        setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
      }
    });
    ensureOnDeviceAvailability().then(setAvailability);
  }, []);

  const handleProviderChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value as 'on-device' | 'openai';
    setSelectedProvider(value);
    if (value === 'on-device') {
      setApiBaseUrl(OPENAI_DEFAULT_BASE_URL);
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const next = buildSettings('on-device', '', OPENAI_DEFAULT_MODEL, OPENAI_DEFAULT_BASE_URL, adapters);
      setSettings(next);
      await saveSettings(next);
    } else {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      setApiBaseUrl(nextBase);
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const next = buildSettings('openai', apiKey, model, nextBase, adapters);
      setSettings(next);
      await saveSettings(next);
    }
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (selectedProvider === 'openai') {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const next = buildSettings('openai', value, model, nextBase, adapters);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleModelChange = (value: string) => {
    setModel(value);
    if (selectedProvider === 'openai') {
      const nextBase = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const next = buildSettings('openai', apiKey, value, nextBase, adapters);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleApiBaseUrlChange = (value: string) => {
    setApiBaseUrl(value);
    if (selectedProvider === 'openai') {
      const adapters = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const next = buildSettings('openai', apiKey, model, value, adapters);
      setSettings(next);
      void saveSettings(next);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setCurrentProfile(null);
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

  const handleExtract = async () => {
    if (!file) {
      return;
    }
    setBusy(true);
    setBusyAction('extract');
    setErrorDetails(null);
    setValidationErrors([]);

    try {
      setStatus({ phase: 'extracting', message: 'Extracting PDF text…' });
      const { text } = await extractTextFromPdf(file);

      if (!text.trim()) {
        throw new Error('No extractable text found in the PDF. Is it a scanned document?');
      }

      setStatus({ phase: 'saving', message: 'Saving extracted text locally…' });
      const id = crypto.randomUUID();
      const fileRef = await storeFile(id, file);
      const profile: ProfileRecord = {
        id,
        createdAt: new Date().toISOString(),
        sourceFile: fileRef,
        rawText: text,
      };

      await saveProfile(profile);
      setCurrentProfile(profile);

      const adapterIds = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const nextSettings = buildSettings(
        selectedProvider,
        apiKey,
        model,
        apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL,
        adapterIds,
      );
      setSettings(nextSettings);
      await saveSettings(nextSettings);

      setStatus({
        phase: 'complete',
        message: 'Extraction complete! Profile saved with raw text. You can optionally parse it below.',
      });
      resetFileInput();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ phase: 'error', message: 'Extraction failed.' });
      setErrorDetails(message);
      console.error(error);
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const handleParse = async () => {
    if (!currentProfile) {
      return;
    }
    if (selectedProvider === 'openai' && !apiKey) {
      setStatus({ phase: 'error', message: 'Please provide an OpenAI API key before parsing.' });
      setErrorDetails(null);
      return;
    }
    setBusy(true);
    setBusyAction('parse');
    setErrorDetails(null);
    setValidationErrors([]);

    try {
      setStatus({ phase: 'parsing', message: 'Parsing resume text with AI…' });
      const messages = buildResumePrompt(currentProfile.rawText);

      let result: ResumeExtractionResult;
      let providerSnapshot: ProviderSnapshot;
      if (selectedProvider === 'on-device') {
        result = await promptOnDevice(messages);
        providerSnapshot = { kind: 'on-device' };
      } else {
        const openAiBaseUrl = apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL;
        result = await promptOpenAI(
          { apiKey, model, apiBaseUrl: openAiBaseUrl },
          messages,
        );
        providerSnapshot = { kind: 'openai', model, apiBaseUrl: openAiBaseUrl };
      }

      setStatus({ phase: 'saving', message: 'Saving structured resume data…' });
      const validation = validateResume(result.resume);
      if (!validation.valid) {
        setValidationErrors(validation.errors ?? []);
      }

      const profile: ProfileRecord = {
        ...currentProfile,
        provider: providerSnapshot,
        parsedAt: new Date().toISOString(),
        resume: result.resume ?? {},
        custom: result.custom ?? {},
        validation: {
          valid: validation.valid,
          errors: validation.errors,
        },
      };

      await saveProfile(profile);
      setCurrentProfile(profile);

      const adapterIds = settings?.adapters?.length ? settings.adapters : getAllAdapterIds();
      const nextSettings = buildSettings(
        selectedProvider,
        apiKey,
        model,
        apiBaseUrl.trim().length ? apiBaseUrl : OPENAI_DEFAULT_BASE_URL,
        adapterIds,
      );
      setSettings(nextSettings);
      await saveSettings(nextSettings);

      setStatus({
        phase: 'complete',
        message: 'Parsing complete! Open the popup to review structured profile data.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ phase: 'error', message: 'Parsing failed.' });
      setErrorDetails(message);
      console.error(error);
    } finally {
      setBusy(false);
      setBusyAction(null);
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
        <p>Upload a PDF to extract resume text locally. You can optionally parse it with AI for structured data.</p>
      </header>

      <section className="card">
        <h2>1. Upload Resume PDF</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
        />
        <button
          type="button"
          disabled={busy || !file}
          onClick={handleExtract}
        >
          {busy && busyAction === 'extract' ? 'Working…' : 'Extract text'}
        </button>
        <p className="helper-text">
          All processing happens in this browser session. Scanned PDFs without selectable text are not supported.
        </p>
        {currentProfile && (
          <p className="helper-text">
            Latest extraction captured {currentProfile.rawText.length.toLocaleString()} characters of resume text.
          </p>
        )}
      </section>

      <section className="card">
        <h2>2. (Optional) Parse With AI</h2>
        <p className="helper-text">
          Improve structured data using on-device or OpenAI providers. You can revisit this step anytime.
        </p>
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
              <label className="field">
                API base URL
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(event) => handleApiBaseUrlChange(event.target.value)}
                  placeholder="https://api.openai.com"
                />
              </label>
              <p className="helper-text">
                We send requests directly to OpenAI from your browser. Keep API keys private; they are stored locally.
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={
            busy ||
            !currentProfile ||
            (selectedProvider === 'openai' && !apiKey)
          }
          onClick={handleParse}
        >
          {busy && busyAction === 'parse' ? 'Working…' : 'Parse resume'}
        </button>
        {!currentProfile && (
          <p className="helper-text">Upload a resume above to enable parsing.</p>
        )}
        {currentProfile && (
          <p className="helper-text">
            Parsing updates the stored profile with JSON Resume data for autofill workflows.
          </p>
        )}
      </section>

      {currentProfile && (
        <section className="card">
          <h2>3. Preview Stored Data</h2>
          <div className="preview-section">
            <div className="preview-block">
              <h3>Extracted text</h3>
              <pre className="preview-pre preview-text">{currentProfile.rawText}</pre>
            </div>
            <div className="preview-block">
              <h3>Parsed JSON Resume</h3>
              {currentProfile.provider ? (
                <pre className="preview-pre">{JSON.stringify(currentProfile.resume ?? {}, null, 2)}</pre>
              ) : (
                <p className="helper-text">
                  Run parsing to populate structured resume data. This stays empty until you complete the optional step.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

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
