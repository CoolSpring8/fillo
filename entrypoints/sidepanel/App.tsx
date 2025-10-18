import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { listProfiles } from '../../shared/storage/profiles';
import type { ProfileRecord } from '../../shared/types';
import type { FillResultMessage, ScannedField } from '../../shared/apply/types';
import type { FieldSlot } from '../../shared/apply/slotTypes';
import {
  getAllAdapterIds,
  resolveSlotFromAutocomplete,
  resolveSlotFromLabel,
  resolveSlotFromText,
} from '../../shared/apply/slots';
import { buildSlotValues, type SlotValueMap } from '../../shared/apply/profile';
import { classifyFieldDescriptors, type FieldDescriptor } from './classifySlots';
import { getSettings } from '../../shared/storage/settings';

type PanelMode = 'dom' | 'manual';

type FieldStatus = 'idle' | 'pending' | 'filled' | 'skipped' | 'failed';

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

interface FieldEntry {
  field: ScannedField;
  slot: FieldSlot | null;
  suggestion?: string;
  status: FieldStatus;
  reason?: string;
  slotSource: 'heuristic' | 'model' | 'unset';
  slotNote?: string;
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
  'address',
  'website',
  'linkedin',
  'github',
  'city',
  'country',
  'state',
  'postalCode',
  'birthDate',
  'gender',
  'currentCompany',
  'currentTitle',
  'currentLocation',
  'currentStartDate',
  'currentEndDate',
  'educationSchool',
  'educationDegree',
  'educationField',
  'educationStartDate',
  'educationEndDate',
  'educationGpa',
  'expectedSalary',
  'preferredLocation',
  'availabilityDate',
  'jobType',
  'skills',
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
  const [classifying, setClassifying] = useState(false);
  const defaultAdapterIds = useMemo(() => getAllAdapterIds(), []);
  const [activeAdapterIds, setActiveAdapterIds] = useState<string[]>(defaultAdapterIds);
  const { t } = i18n;

  const portRef = useRef<RuntimePort | null>(null);
  const slotValuesRef = useRef<SlotValueMap>({});
  const scanRequestIdRef = useRef<string | null>(null);
  const descriptorsRef = useRef<FieldDescriptor[]>([]);
  const adapterIdsRef = useRef<string[]>(defaultAdapterIds);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const slotValues = useMemo(() => buildSlotValues(selectedProfile), [selectedProfile]);

  useEffect(() => {
    slotValuesRef.current = slotValues;
  }, [slotValues]);

  useEffect(() => {
    adapterIdsRef.current = activeAdapterIds.length > 0 ? activeAdapterIds : defaultAdapterIds;
  }, [activeAdapterIds, defaultAdapterIds]);

  const formatFillReason = (reason: string): string => {
    const map: Record<string, string> = {
      'frame-unavailable': t('sidepanel.reason.frameUnavailable'),
      'missing-frame': t('sidepanel.reason.missingFrame'),
      'no-active-tab': t('sidepanel.reason.noActiveTab'),
      'missing-field': t('sidepanel.reason.missingField'),
      'missing-element': t('sidepanel.reason.missingElement'),
      'fill-failed': t('sidepanel.reason.fillFailed'),
      'click-failed': t('sidepanel.reason.clickFailed'),
      'no-selection': t('sidepanel.reason.noSelection'),
      'empty-value': t('sidepanel.reason.emptyValue'),
    };
    return map[reason] ?? reason;
  };

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
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const settings = await getSettings();
        if (cancelled) {
          return;
        }
        setActiveAdapterIds(settings.adapters.length > 0 ? settings.adapters : defaultAdapterIds);
      } catch (error) {
        console.warn('Failed to load settings', error);
      }
    };

    loadSettings().catch(console.error);

    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') {
        return;
      }
      if ('settings:app' in changes) {
        loadSettings().catch(console.error);
      }
    };

    browser.storage.onChanged.addListener(listener);

    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(listener);
    };
  }, [defaultAdapterIds]);

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
        setFields(buildFieldEntries(parsed.fields, slotValuesRef.current, adapterIdsRef.current));
        setScanning(false);
        const descriptors: FieldDescriptor[] = parsed.fields.map((field) => ({
          id: field.id,
          label: field.label,
          type: field.kind,
          autocomplete: field.autocomplete ?? null,
          required: field.required,
        }));
        descriptorsRef.current = descriptors;
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

  const sendMessage = useCallback((payload: Record<string, unknown>) => {
    const port = portRef.current;
    if (!port) {
      return;
    }
    port.postMessage(payload);
  }, []);

  const handleAutoFill = useCallback(() => {
    const targets = fields.filter(
      (entry) =>
        entry.field.kind !== 'file' &&
        entry.suggestion &&
        entry.suggestion.trim().length > 0 &&
        entry.status !== 'pending' &&
        entry.status !== 'filled',
    );
    if (targets.length === 0) {
      setFeedback(t('sidepanel.feedback.noMapped'));
      return;
    }
    const pendingIds = new Set<string>();
    for (const target of targets) {
      const requestId = crypto.randomUUID();
      pendingIds.add(target.field.id);
      sendMessage({
        kind: 'PROMPT_FILL',
        requestId,
        fieldId: target.field.id,
        frameId: target.field.frameId,
        label: target.field.label,
        mode: 'auto',
        value: target.suggestion ?? '',
      });
    }
    setFields((current) =>
      current.map((entry) =>
        pendingIds.has(entry.field.id)
          ? {
              ...entry,
              status: 'pending',
              reason: undefined,
            }
          : entry,
      ),
    );
    setFeedback(t('sidepanel.feedback.autofill', targets.length, [String(targets.length)]));
  }, [fields, sendMessage, t]);

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
    const options =
      entry.field.kind === 'file'
        ? []
        : MANUAL_SLOTS.map((slot) => {
            const value = slotValuesRef.current[slot];
            if (!value || !value.trim()) {
              return null;
            }
            return { slot, label: formatSlotLabel(slot), value: value.trim() };
          }).filter((entry): entry is { slot: FieldSlot; label: string; value: string } => Boolean(entry));

    if (entry.field.kind !== 'file' && options.length === 0) {
      setFeedback(t('sidepanel.feedback.noValues'));
      return;
    }

    const defaultSlot =
      entry.field.kind === 'file'
        ? null
        : entry.slot && options.some((opt) => opt.slot === entry.slot)
        ? entry.slot
        : options[0]?.slot ?? null;
    const defaultValue =
      entry.field.kind === 'file'
        ? ''
        : defaultSlot
        ? options.find((opt) => opt.slot === defaultSlot)?.value ?? ''
        : '';
    const requestId = crypto.randomUUID();
    sendMessage({
      kind: 'PROMPT_FILL',
      requestId,
      fieldId: entry.field.id,
      frameId: entry.field.frameId,
      label: entry.field.label,
      mode: entry.field.kind === 'file' ? 'click' : 'fill',
      value: entry.field.kind === 'file' ? '' : defaultValue,
      preview:
        entry.field.kind === 'file'
          ? t('sidepanel.preview.file')
          : defaultValue || entry.suggestion || t('sidepanel.preview.select'),
      options: entry.field.kind === 'file' ? undefined : options,
      defaultSlot,
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

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(t('sidepanel.feedback.copied', [label]));
    } catch (error) {
      console.error('Failed to copy', error);
      setFeedback(t('sidepanel.feedback.noClipboard'));
    }
  };

  const manualValues = useMemo(
    () =>
      MANUAL_SLOTS.map((slot) => ({ slot, value: slotValues[slot] ?? '' })).filter(
        (entry) => entry.value.trim().length > 0,
      ),
    [slotValues],
  );

  const slotOptions = useMemo(
    () =>
      MANUAL_SLOTS.map((slot) => {
        const value = slotValues[slot];
        if (!value || !value.trim()) {
          return null;
        }
        return { slot, value: value.trim() };
      }).filter((entry): entry is { slot: FieldSlot; value: string } => Boolean(entry)),
    [slotValues],
  );

  const classifyAndApply = useCallback(async (descriptors: FieldDescriptor[]) => {
    if (descriptors.length === 0) {
      return;
    }
    try {
      const map = await classifyFieldDescriptors(descriptors);
      if (map.size === 0) {
        return;
      }
      setFields((current) =>
        current.map((entry) => {
          const match = map.get(entry.field.id);
          if (!match?.slot) {
            return entry;
          }
          const suggestion = slotValuesRef.current[match.slot] ?? entry.suggestion;
          return {
            ...entry,
            slot: match.slot,
            suggestion,
            slotSource: 'model',
            slotNote: match.reason,
          };
        }),
      );
    } catch (error) {
      console.warn('Field classification failed', error);
    }
  }, []);

  const handleClassify = useCallback(async () => {
    if (classifying) {
      return;
    }
    const descriptors = descriptorsRef.current;
    if (descriptors.length === 0) {
      return;
    }
    setClassifying(true);
    try {
      await classifyAndApply(descriptors);
      setFeedback(t('sidepanel.feedback.classificationUpdated'));
    } finally {
      setClassifying(false);
    }
  }, [classifying, classifyAndApply]);

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
        <h1>{t('sidepanel.title')}</h1>
        <p>{t('sidepanel.subtitle')}</p>
      </header>
      <div className="panel-body">
        <div className="toolbar">
          <select
            value={selectedProfileId ?? ''}
            onChange={(event) => setSelectedProfileId(event.target.value || null)}
          >
            {profiles.length === 0 && <option value="">{t('sidepanel.states.noProfilesOption')}</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {formatProfileLabel(profile)}
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={requestScan} disabled={scanning}>
            {scanning ? t('sidepanel.toolbar.scanning') : t('sidepanel.toolbar.rescan')}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleClassify}
            disabled={classifying || fields.length === 0}
          >
            {classifying ? t('sidepanel.toolbar.classifying') : t('sidepanel.toolbar.classify')}
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleAutoFill}
            disabled={
              fields.every(
                (entry) =>
                  entry.field.kind === 'file' ||
                  !entry.suggestion ||
                  entry.suggestion.trim().length === 0 ||
                  entry.status === 'pending' ||
                  entry.status === 'filled',
              ) || fields.length === 0
            }
          >
            {t('sidepanel.toolbar.fillMapped')}
          </button>
          <button type="button" className="secondary" onClick={() => sendMessage({ kind: 'CLEAR_OVERLAY' })}>
            {t('sidepanel.toolbar.clearOverlay')}
          </button>
          <button type="button" className="secondary" onClick={openProfilesPage}>
            {t('sidepanel.toolbar.manageProfiles')}
          </button>
        </div>
        <div className="mode-tabs">
          <div
            className={`mode-tab ${mode === 'dom' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setMode('dom')}
          >
            {t('sidepanel.tabs.dom')}
          </div>
          <div
            className={`mode-tab ${mode === 'manual' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setMode('manual')}
          >
            {t('sidepanel.tabs.manual')}
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
      return <div className="info-state">{t('sidepanel.states.loadingProfiles')}</div>;
    }
    if (viewState.error) {
      return <div className="error-state">{t('sidepanel.states.error', [viewState.error])}</div>;
    }
    if (!selectedProfile) {
      return <div className="empty-state">{t('sidepanel.states.noProfile')}</div>;
    }
    if (scanning) {
      return <div className="info-state">{t('sidepanel.toolbar.scanning')}</div>;
    }
    if (fields.length === 0) {
      return <div className="empty-state">{t('sidepanel.states.noFields')}</div>;
    }
    return fields.map((entry) => {
      const hasOptions = slotOptions.length > 0;
      const suggestedValue = entry.slot ? slotValues[entry.slot] : undefined;
      const baseSlotLabel = entry.slot ? formatSlotLabel(entry.slot) : t('sidepanel.field.unmapped');
      const slotLabel =
        entry.slot && entry.slotSource === 'model'
          ? `${baseSlotLabel}${t('sidepanel.field.aiSuffix')}`
          : baseSlotLabel;
      const summary =
        entry.field.kind === 'file'
          ? t('sidepanel.field.fileSummary')
          : suggestedValue
          ? entry.slotSource === 'model'
            ? t('sidepanel.field.suggestedAI', [truncate(suggestedValue)])
            : t('sidepanel.field.suggestedProfile', [truncate(suggestedValue)])
          : hasOptions
          ? t('sidepanel.field.chooseValue')
          : t('sidepanel.field.noValues');

      const disabled = entry.field.kind !== 'file' && !hasOptions;

      return (
        <article key={entry.field.id} className={`field-card ${entry.status !== 'idle' ? entry.status : ''}`}>
          <header>
            <div>
              <div className="field-title">
                {entry.field.label || t('sidepanel.field.noLabel')}
                {entry.field.required && ' *'}
              </div>
              <div className="field-meta">
                {t('sidepanel.field.meta', [
                  t(`sidepanel.fieldKind.${entry.field.kind}`),
                  slotLabel,
                  String(entry.field.frameId),
                ])}
              </div>
            </div>
            {entry.status !== 'idle' && (
              <span className={`status-tag status-${entry.status}`}>
                {t(`sidepanel.status.${entry.status}`)}
              </span>
            )}
          </header>
          <div className="field-suggestion">{summary}</div>
          {entry.slotNote && <div className="field-meta">{t('sidepanel.field.aiNote', [entry.slotNote])}</div>}
          {entry.reason && <div className="field-meta">{formatFillReason(entry.reason)}</div>}
          <div className="field-actions">
            <button
              type="button"
              className="primary"
              disabled={disabled}
              onClick={() => handleReview(entry)}
            >
              {entry.field.kind === 'file' ? t('sidepanel.buttons.openPicker') : t('sidepanel.buttons.review')}
            </button>
          </div>
        </article>
      );
    });
  }

  function renderManualMode() {
    if (viewState.loadingProfiles) {
      return <div className="info-state">{t('sidepanel.states.loadingProfiles')}</div>;
    }
    if (viewState.error) {
      return <div className="error-state">{t('sidepanel.states.error', [viewState.error])}</div>;
    }
    if (!selectedProfile) {
      return <div className="empty-state">{t('sidepanel.states.noProfileManual')}</div>;
    }
    return (
      <div className="manual-grid">
        {manualValues.length === 0 && (
          <div className="info-state">{t('sidepanel.states.noManualValues')}</div>
        )}
        {manualValues.map((entry) => (
          <section key={entry.slot} className="manual-item">
            <header>
              <span>{formatSlotLabel(entry.slot)}</span>
              <button type="button" onClick={() => handleCopy(formatSlotLabel(entry.slot), entry.value)}>
                {t('sidepanel.buttons.copy')}
              </button>
            </header>
            <div className="manual-text">{entry.value}</div>
          </section>
        ))}
        <section className="manual-item">
          <header>
            <span>{t('sidepanel.manual.rawLabel')}</span>
            <button type="button" onClick={() => handleCopy(t('sidepanel.manual.rawLabel'), selectedProfile.rawText)}>
              {t('sidepanel.buttons.copyAll')}
            </button>
          </header>
          <pre className="raw-text">{selectedProfile.rawText}</pre>
        </section>
      </div>
    );
  }
}

function buildFieldEntries(fields: ScannedField[], slots: SlotValueMap, adapters: string[]): FieldEntry[] {
  return fields.map((field) => {
    const slot = resolveSlot(field);
    const suggestion = slot ? slots[slot] : undefined;
    return {
      field,
      slot,
      suggestion,
      status: 'idle',
      reason: undefined,
      slotSource: slot ? 'heuristic' : 'unset',
      slotNote: undefined,
    };
  });

  function resolveSlot(field: ScannedField): FieldSlot | null {
    const context = (field.context ?? '').toLowerCase();
    const label = field.label.toLowerCase();
    const hasContext = (token: string | string[]) => {
      const tokens = Array.isArray(token) ? token : [token];
      return tokens.some((entry) => context.includes(entry));
    };
    const hasLabel = (token: string | string[]) => {
      const tokens = Array.isArray(token) ? token : [token];
      return tokens.some((entry) => label.includes(entry));
    };
    const contextIncludesAll = (tokens: string[]) => tokens.every((entry) => context.includes(entry));

    const byAutocomplete = resolveSlotFromAutocomplete(field.autocomplete);
    if (byAutocomplete) {
      return byAutocomplete;
    }
    const byLabel = resolveSlotFromLabel(field.label, adapters);
    if (byLabel) {
      return byLabel;
    }
    const byAdaptersContext = resolveSlotFromText(field.context, adapters);
    if (byAdaptersContext) {
      return byAdaptersContext;
    }
    if (hasContext(['email', 'e-mail'])) return 'email';
    if (hasContext(['phone', 'mobile', 'telephone'])) return 'phone';
    if (hasContext(['address', 'street address'])) return 'address';
    if (hasContext(['postal code', 'zip'])) return 'postalCode';
    if (hasContext(['state', 'province', 'region'])) return 'state';
    if (hasContext(['date of birth', 'birth date', 'dob', 'birthday'])) return 'birthDate';
    if (hasContext(['gender', 'sex'])) return 'gender';
    if (hasContext(['current company', 'employer']) || hasLabel(['current company', 'employer'])) return 'currentCompany';
    if (hasContext(['current title', 'job title', 'position']) || hasLabel(['job title', 'position'])) return 'currentTitle';
    if (hasContext(['current location', 'work location'])) return 'currentLocation';
    if (contextIncludesAll(['employment', 'start']) || hasContext(['employment start', 'work start'])) return 'currentStartDate';
    if (contextIncludesAll(['employment', 'end']) || hasContext(['employment end', 'work end', 'last day'])) return 'currentEndDate';
    if (hasContext(['school', 'university', 'college', 'institution'])) return 'educationSchool';
    if (hasContext(['degree', 'qualification', 'study type'])) return 'educationDegree';
    if (hasContext(['major', 'field of study', 'discipline'])) return 'educationField';
    if (hasContext(['enrollment', 'education start'])) return 'educationStartDate';
    if (hasContext(['graduation', 'completion'])) return 'educationEndDate';
    if (hasContext(['gpa', 'grade point', 'grade'])) return 'educationGpa';
    if (hasContext(['expected salary', 'desired salary', 'salary expectation'])) return 'expectedSalary';
    if (hasContext(['preferred location', 'desired location', 'target location'])) return 'preferredLocation';
    if (hasContext(['availability', 'available from', 'available date'])) return 'availabilityDate';
    if (hasContext(['employment type', 'job type'])) return 'jobType';
    if (hasContext(['skill'])) return 'skills';

    if (field.kind === 'email') return 'email';
    if (field.kind === 'tel') return 'phone';
    if (field.kind === 'textarea') return 'summary';
    if (field.kind === 'text' && (hasLabel('linkedin') || hasContext('linkedin'))) return 'linkedin';
    if (field.kind === 'text' && (hasLabel('github') || hasContext('github'))) return 'github';
    if (field.kind === 'text' && (hasLabel(['website', 'portfolio']) || hasContext(['website', 'portfolio']))) return 'website';
    if (hasContext(['linkedin'])) return 'linkedin';
    if (hasContext(['github'])) return 'github';
    if (hasContext(['website', 'portfolio'])) return 'website';
    if (hasContext(['summary', 'about', 'bio'])) return 'summary';
    if (hasContext(['headline', 'current role', 'title'])) return 'headline';
    if (hasContext(['city', 'town'])) return 'city';
    if (hasContext(['country'])) return 'country';
    if (hasContext(['first name', 'given name'])) return 'firstName';
    if (hasContext(['last name', 'family name', 'surname'])) return 'lastName';
    if (hasContext(['full name', 'name'])) return 'name';

    return null;
  }
}

function formatProfileLabel(profile: ProfileRecord): string {
  const basics = extractBasics(profile.resume);
  const name =
    typeof basics.name === 'string' && basics.name.trim()
      ? basics.name.trim()
      : i18n.t('sidepanel.profile.unnamed');
  const created = new Date(profile.createdAt).toLocaleDateString();
  return i18n.t('sidepanel.profile.label', [name, created]);
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
      return i18n.t('slots.firstName');
    case 'lastName':
      return i18n.t('slots.lastName');
    case 'email':
      return i18n.t('slots.email');
    case 'phone':
      return i18n.t('slots.phone');
    case 'address':
      return i18n.t('slots.address');
    case 'website':
      return i18n.t('slots.website');
    case 'linkedin':
      return i18n.t('slots.linkedin');
    case 'github':
      return i18n.t('slots.github');
    case 'city':
      return i18n.t('slots.city');
    case 'country':
      return i18n.t('slots.country');
    case 'state':
      return i18n.t('slots.state');
    case 'postalCode':
      return i18n.t('slots.postalCode');
    case 'birthDate':
      return i18n.t('slots.birthDate');
    case 'gender':
      return i18n.t('slots.gender');
    case 'currentCompany':
      return i18n.t('slots.currentCompany');
    case 'currentTitle':
      return i18n.t('slots.currentTitle');
    case 'currentLocation':
      return i18n.t('slots.currentLocation');
    case 'currentStartDate':
      return i18n.t('slots.currentStartDate');
    case 'currentEndDate':
      return i18n.t('slots.currentEndDate');
    case 'educationSchool':
      return i18n.t('slots.educationSchool');
    case 'educationDegree':
      return i18n.t('slots.educationDegree');
    case 'educationField':
      return i18n.t('slots.educationField');
    case 'educationStartDate':
      return i18n.t('slots.educationStartDate');
    case 'educationEndDate':
      return i18n.t('slots.educationEndDate');
    case 'educationGpa':
      return i18n.t('slots.educationGpa');
    case 'expectedSalary':
      return i18n.t('slots.expectedSalary');
    case 'preferredLocation':
      return i18n.t('slots.preferredLocation');
    case 'availabilityDate':
      return i18n.t('slots.availabilityDate');
    case 'jobType':
      return i18n.t('slots.jobType');
    case 'skills':
      return i18n.t('slots.skills');
    case 'summary':
      return i18n.t('slots.summary');
    case 'headline':
      return i18n.t('slots.headline');
    default:
      return i18n.t('slots.name');
  }
}

function truncate(value: string, limit = 120): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
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
