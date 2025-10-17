import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { listProfiles } from '../../shared/storage/profiles';
import type { ProfileRecord } from '../../shared/types';
import type { FillResultMessage, ScannedField } from '../../shared/apply/types';
import type { FieldSlot } from '../../shared/apply/slots';
import { resolveSlotFromAutocomplete, resolveSlotFromLabel } from '../../shared/apply/slots';
import { buildSlotValues, type SlotValueMap } from '../../shared/apply/profile';

type PanelMode = 'dom' | 'manual';

type FieldStatus = 'idle' | 'pending' | 'filled' | 'skipped' | 'failed';

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

interface FieldEntry {
  field: ScannedField;
  slot: FieldSlot | null;
  suggestion?: string;
  status: FieldStatus;
  reason?: string;
}

interface ViewState {
  loadingProfiles: boolean;
  error?: string;
}

const MANUAL_SLOTS: FieldSlot[] = [
  'name',
  'firstName',
  'lastName',
  'headline',
  'summary',
  'email',
  'phone',
  'website',
  'linkedin',
  'github',
  'city',
  'country',
];

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [mode, setMode] = useState<PanelMode>('dom');
  const [fields, setFields] = useState<FieldEntry[]>([]);
  const [scanRequestId, setScanRequestId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ loadingProfiles: true });
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const portRef = useRef<RuntimePort | null>(null);
  const slotValuesRef = useRef<SlotValueMap>({});
  const scanRequestIdRef = useRef<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const slotValues = useMemo(() => buildSlotValues(selectedProfile), [selectedProfile]);

  useEffect(() => {
    slotValuesRef.current = slotValues;
  }, [slotValues]);

  useEffect(() => {
    let cancelled = false;

    const loadProfiles = async () => {
      setViewState((state) => ({ ...state, loadingProfiles: true, error: undefined }));
      try {
        const result = await listProfiles();
        if (cancelled) {
          return;
        }
        setProfiles(result);
        setViewState({ loadingProfiles: false });
        if (result.length > 0) {
          setSelectedProfileId((current) => current ?? result[0].id);
        } else {
          setSelectedProfileId(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setViewState({ loadingProfiles: false, error: message });
        }
      }
    };

    loadProfiles().catch(console.error);

    const listener = () => {
      loadProfiles().catch(console.error);
    };

    browser.storage.onChanged.addListener(listener);

    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    const port = browser.runtime.connect({ name: 'sidepanel' });
    portRef.current = port;

    const handleMessage = (message: unknown) => {
      if (!isRecord(message)) {
        return;
      }

      if (message.kind === 'FIELDS') {
        const parsed = parseFieldsResponse(message);
        if (!parsed) {
          return;
        }
        if (scanRequestIdRef.current && parsed.requestId !== scanRequestIdRef.current) {
          return;
        }
        setFields(buildFieldEntries(parsed.fields, slotValuesRef.current));
        setScanning(false);
        return;
      }

      if (message.kind === 'FILL_RESULT') {
        const result = parseFillResultMessage(message);
        if (result) {
          handleFillResult(result);
        }
      }
    };

    port.onMessage.addListener(handleMessage);

    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });

    return () => {
      port.onMessage.removeListener(handleMessage);
      port.disconnect();
      portRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!portRef.current) {
      return;
    }
    requestScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId]);

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timeout = setTimeout(() => setFeedback(null), 2000);
    return () => clearTimeout(timeout);
  }, [feedback]);

  const sendMessage = (payload: Record<string, unknown>) => {
    const port = portRef.current;
    if (!port) {
      return;
    }
    port.postMessage(payload);
  };

  const requestScan = () => {
    if (!portRef.current) {
      return;
    }
    const requestId = crypto.randomUUID();
    setScanRequestId(requestId);
    scanRequestIdRef.current = requestId;
    setScanning(true);
    setFields([]);
    sendMessage({ kind: 'SCAN_FIELDS', requestId });
  };

  const handleFillResult = (message: FillResultMessage) => {
    setFields((current) =>
      current.map((entry) => {
        if (entry.field.id !== message.fieldId) {
          return entry;
        }
        const statusMap: Record<string, FieldStatus> = {
          filled: 'filled',
          skipped: 'skipped',
          failed: 'failed',
        };
        const status = statusMap[message.status] ?? 'idle';
        return {
          ...entry,
          status,
          reason: message.reason,
        };
      }),
    );
  };

  const handleReview = (entry: FieldEntry) => {
    if (!entry.suggestion && entry.field.kind !== 'file') {
      return;
    }
    const requestId = crypto.randomUUID();
    sendMessage({
      kind: 'PROMPT_FILL',
      requestId,
      fieldId: entry.field.id,
      frameId: entry.field.frameId,
      value: entry.suggestion ?? '',
      preview: entry.suggestion ?? 'No stored value. Use manual mode or enter manually.',
      label: entry.field.label,
      mode: entry.field.kind === 'file' ? 'click' : 'fill',
    });
    setFields((current) =>
      current.map((item) =>
        item.field.id === entry.field.id
          ? {
              ...item,
              status: 'pending',
              reason: undefined,
            }
          : item,
      ),
    );
  };

  const handleHighlight = (entry: FieldEntry) => {
    sendMessage({
      kind: 'HIGHLIGHT_FIELD',
      fieldId: entry.field.id,
      frameId: entry.field.frameId,
      label: entry.field.label,
    });
  };

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(`Copied ${label}`);
    } catch (error) {
      console.error('Failed to copy', error);
      setFeedback('Unable to copy to clipboard');
    }
  };

  const manualValues = useMemo(() =>
    MANUAL_SLOTS.map((slot) => ({ slot, value: slotValues[slot] ?? '' })).filter((entry) => entry.value.trim().length > 0),
  [slotValues]);

  const openProfilesPage = () => {
    browser.tabs
      .create({ url: browser.runtime.getURL('/popup.html') })
      .catch((error: unknown) => {
        console.warn('Unable to open profile manager.', error);
      });
  };

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>Resume Helper</h1>
        <p>Select a profile and review each field before filling.</p>
      </header>
      <div className="panel-body">
        <div className="toolbar">
          <select
            value={selectedProfileId ?? ''}
            onChange={(event) => setSelectedProfileId(event.target.value || null)}
          >
            {profiles.length === 0 && <option value="">No profiles available</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {formatProfileLabel(profile)}
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={requestScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Rescan page'}
          </button>
          <button type="button" className="secondary" onClick={() => sendMessage({ kind: 'CLEAR_OVERLAY' })}>
            Clear overlay
          </button>
          <button type="button" className="secondary" onClick={openProfilesPage}>
            Manage profiles
          </button>
        </div>
        <div className="mode-tabs">
          <div
            className={`mode-tab ${mode === 'dom' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setMode('dom')}
          >
            Field Review
          </div>
          <div
            className={`mode-tab ${mode === 'manual' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setMode('manual')}
          >
            Manual Copy
          </div>
        </div>
        <div className="content">
          {feedback && <div className="info-state">{feedback}</div>}
          {mode === 'dom' && renderDomMode()}
          {mode === 'manual' && renderManualMode()}
        </div>
      </div>
    </div>
  );

  function renderDomMode() {
    if (viewState.loadingProfiles) {
      return <div className="info-state">Loading profiles…</div>;
    }
    if (viewState.error) {
      return <div className="error-state">{viewState.error}</div>;
    }
    if (!selectedProfile) {
      return <div className="empty-state">Import a resume in onboarding to populate autofill data.</div>;
    }
    if (scanning) {
      return <div className="info-state">Scanning page fields…</div>;
    }
    if (fields.length === 0) {
      return <div className="empty-state">No fillable fields detected on this page.</div>;
    }
    return fields.map((entry) => (
      <article
        key={entry.field.id}
        className={`field-card ${entry.status !== 'idle' ? entry.status : ''}`}
      >
        <header>
          <div>
            <div className="field-title">
              {entry.field.label || '(No label)'}
              {entry.field.required && ' *'}
            </div>
            <div className="field-meta">
              {entry.field.kind} · {entry.slot ?? 'unmapped'} · frame {entry.field.frameId}
            </div>
          </div>
          {entry.status !== 'idle' && (
            <span className={`status-tag status-${entry.status}`}>
              {entry.status}
            </span>
          )}
        </header>
        <div className="field-suggestion">
          {entry.field.kind === 'file' && 'Open the file picker to upload your resume.'}
          {entry.field.kind !== 'file' && (entry.suggestion?.length ? entry.suggestion : 'No stored value. Use manual mode.')}
        </div>
        {entry.reason && <div className="field-meta">{entry.reason}</div>}
        <div className="field-actions">
          <button type="button" onClick={() => handleHighlight(entry)}>
            Highlight
          </button>
          <button
            type="button"
            className="primary"
            disabled={!entry.suggestion && entry.field.kind !== 'file'}
            onClick={() => handleReview(entry)}
          >
            {entry.field.kind === 'file' ? 'Open picker' : 'Review & fill'}
          </button>
        </div>
      </article>
    ));
  }

  function renderManualMode() {
    if (viewState.loadingProfiles) {
      return <div className="info-state">Loading profiles…</div>;
    }
    if (viewState.error) {
      return <div className="error-state">{viewState.error}</div>;
    }
    if (!selectedProfile) {
      return <div className="empty-state">Import a resume to access manual copy helpers.</div>;
    }
    return (
      <div className="manual-grid">
        {manualValues.length === 0 && (
          <div className="info-state">No structured fields available. Copy from raw text below.</div>
        )}
        {manualValues.map((entry) => (
          <section key={entry.slot} className="manual-item">
            <header>
              <span>{formatSlotLabel(entry.slot)}</span>
              <button type="button" onClick={() => handleCopy(formatSlotLabel(entry.slot), entry.value)}>
                Copy
              </button>
            </header>
            <div className="manual-text">{entry.value}</div>
          </section>
        ))}
        <section className="manual-item">
          <header>
            <span>Raw resume text</span>
            <button type="button" onClick={() => handleCopy('Raw text', selectedProfile.rawText)}>
              Copy all
            </button>
          </header>
          <pre className="raw-text">{selectedProfile.rawText}</pre>
        </section>
      </div>
    );
  }
}

function buildFieldEntries(fields: ScannedField[], slots: SlotValueMap): FieldEntry[] {
  return fields.map((field) => {
    const slot = resolveSlot(field);
    const suggestion = slot ? slots[slot] : undefined;
    return {
      field,
      slot,
      suggestion,
      status: 'idle',
    };
  });

  function resolveSlot(field: ScannedField): FieldSlot | null {
    const byAutocomplete = resolveSlotFromAutocomplete(field.autocomplete);
    if (byAutocomplete) {
      return byAutocomplete;
    }
    const byLabel = resolveSlotFromLabel(field.label);
    if (byLabel) {
      return byLabel;
    }
    if (field.kind === 'email') return 'email';
    if (field.kind === 'tel') return 'phone';
    if (field.kind === 'textarea') return 'summary';
    if (field.kind === 'text' && field.label.toLowerCase().includes('linkedin')) return 'linkedin';
    if (field.kind === 'text' && field.label.toLowerCase().includes('github')) return 'github';
    if (field.kind === 'text' && field.label.toLowerCase().includes('website')) return 'website';
    return null;
  }
}

function formatProfileLabel(profile: ProfileRecord): string {
  const basics = extractBasics(profile.resume);
  const name = typeof basics.name === 'string' && basics.name.trim() ? basics.name.trim() : 'Unnamed profile';
  const created = new Date(profile.createdAt).toLocaleDateString();
  return `${name} · ${created}`;
}

function extractBasics(resume: unknown): Record<string, unknown> {
  if (resume && typeof resume === 'object' && !Array.isArray(resume)) {
    const value = resume as Record<string, unknown>;
    const basics = value.basics;
    if (basics && typeof basics === 'object' && !Array.isArray(basics)) {
      return basics as Record<string, unknown>;
    }
  }
  return {};
}

function formatSlotLabel(slot: FieldSlot): string {
  switch (slot) {
    case 'firstName':
      return 'First name';
    case 'lastName':
      return 'Last name';
    case 'email':
      return 'Email';
    case 'phone':
      return 'Phone';
    case 'website':
      return 'Website';
    case 'linkedin':
      return 'LinkedIn';
    case 'github':
      return 'GitHub';
    case 'city':
      return 'City';
    case 'country':
      return 'Country';
    case 'summary':
      return 'Summary';
    case 'headline':
      return 'Headline';
    default:
      return 'Full name';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function parseFieldsResponse(value: Record<string, unknown>): { requestId: string; fields: ScannedField[] } | null {
  if (typeof value.requestId !== 'string' || !Array.isArray(value.fields)) {
    return null;
  }
  return {
    requestId: value.requestId,
    fields: value.fields as ScannedField[],
  };
}

function parseFillResultMessage(value: Record<string, unknown>): FillResultMessage | null {
  if (
    typeof value.requestId !== 'string' ||
    typeof value.fieldId !== 'string' ||
    typeof value.frameId !== 'number' ||
    !isFillResultStatus(value.status)
  ) {
    return null;
  }
  return {
    requestId: value.requestId,
    fieldId: value.fieldId,
    frameId: value.frameId,
    status: value.status,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
  };
}

function isFillResultStatus(value: unknown): value is FillResultMessage['status'] {
  return value === 'filled' || value === 'skipped' || value === 'failed';
}
/// <reference types="wxt/browser" />
