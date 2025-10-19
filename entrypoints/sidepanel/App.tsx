import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { listProfiles } from '../../shared/storage/profiles';
import type { ProfileRecord } from '../../shared/types';
import type { FillResultMessage, PromptOption, PromptOptionSlot, ScannedField } from '../../shared/apply/types';
import type { FieldSlot } from '../../shared/apply/slotTypes';
import { buildManualValueTree, flattenManualLeaves, type ManualValueNode } from './manualValues';
import {
  getAllAdapterIds,
  resolveSlotFromAutocomplete,
  resolveSlotFromLabel,
  resolveSlotFromText,
} from '../../shared/apply/slots';
import { buildSlotValues, type SlotValueMap } from '../../shared/apply/profile';
import { classifyFieldDescriptors, type FieldDescriptor } from './classifySlots';
import { getSettings } from '../../shared/storage/settings';
import { judgeAutoFill, hasAutoFillModel, type AutoFillKey } from './autoFillJudge';

type PanelMode = 'dom' | 'auto' | 'manual';

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
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoSummary, setAutoSummary] = useState<string | null>(null);
  const defaultAdapterIds = useMemo(() => getAllAdapterIds(), []);
  const [activeAdapterIds, setActiveAdapterIds] = useState<string[]>(defaultAdapterIds);
  const { t } = i18n;

  const portRef = useRef<RuntimePort | null>(null);
  const slotValuesRef = useRef<SlotValueMap>({});
  const scanRequestIdRef = useRef<string | null>(null);
  const descriptorsRef = useRef<FieldDescriptor[]>([]);
  const adapterIdsRef = useRef<string[]>(defaultAdapterIds);
  const fillResolversRef = useRef<Map<string, (result: FillResultMessage) => void>>(new Map());
  const fieldsRef = useRef<FieldEntry[]>([]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const slotValues = useMemo(() => buildSlotValues(selectedProfile), [selectedProfile]);

  useEffect(() => {
    slotValuesRef.current = slotValues;
  }, [slotValues]);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

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
      'auto-no-model': t('sidepanel.reason.autoNoModel'),
      'auto-no-keys': t('sidepanel.reason.autoNoKeys'),
      'auto-no-decision': t('sidepanel.reason.autoNoDecision'),
      'auto-invalid-key': t('sidepanel.reason.autoInvalidKey'),
      'auto-missing-value': t('sidepanel.reason.autoMissingValue'),
      'auto-non-empty': t('sidepanel.reason.autoNonEmpty'),
      'auto-unsupported': t('sidepanel.reason.autoUnsupported'),
      'auto-timeout': t('sidepanel.reason.autoTimeout'),
      'auto-error': t('sidepanel.reason.autoError'),
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

  const setFieldStatus = useCallback((fieldId: string, status: FieldStatus, reason?: string) => {
    setFields((current) =>
      current.map((entry) =>
        entry.field.id === fieldId
          ? {
              ...entry,
              status,
              reason,
            }
          : entry,
      ),
    );
  }, []);

  const waitForFillCompletion = useCallback((requestId: string, timeoutMs = 5000) => {
    return new Promise<FillResultMessage | null>((resolve) => {
      const timeout = window.setTimeout(() => {
        fillResolversRef.current.delete(requestId);
        resolve(null);
      }, timeoutMs);
      fillResolversRef.current.set(requestId, (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
  }, []);

  const buildAutoFillKeys = useCallback((): AutoFillKey[] => {
    const entries = Object.entries(slotValuesRef.current) as Array<[
      FieldSlot,
      string | undefined
    ]>;
    return entries
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
      .map(([slot]) => ({
        key: slot,
        label: formatSlotLabel(slot),
      }));
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

  const handleAutoModeRun = useCallback(async () => {
    if (autoRunning) {
      return;
    }

    if (!hasAutoFillModel()) {
      setAutoSummary(t('sidepanel.auto.noModel'));
      setFeedback(t('sidepanel.auto.noModel'));
      return;
    }

    const availableKeys = buildAutoFillKeys();
    if (availableKeys.length === 0) {
      setAutoSummary(t('sidepanel.auto.noKeys'));
      return;
    }

    if (fieldsRef.current.length === 0) {
      setAutoSummary(t('sidepanel.states.noFields'));
      return;
    }

    const supportedKinds: Set<ScannedField['kind']> = new Set([
      'text',
      'email',
      'tel',
      'number',
      'date',
      'select',
      'textarea',
    ]);

    setAutoRunning(true);
    setAutoSummary(null);

    const usedKeys = new Set<string>();
    const snapshot = [...fieldsRef.current];
    let attempted = 0;
    let filled = 0;

    try {
      for (const entry of snapshot) {
        if (entry.status === 'filled') {
          continue;
        }
        if (!supportedKinds.has(entry.field.kind)) {
          setFieldStatus(entry.field.id, 'skipped', 'auto-unsupported');
          continue;
        }
        if (entry.field.hasValue) {
          setFieldStatus(entry.field.id, 'skipped', 'auto-non-empty');
          continue;
        }

        attempted += 1;

        const available = availableKeys.filter((key) => !usedKeys.has(key.key));
        if (available.length === 0) {
          setFieldStatus(entry.field.id, 'skipped', 'auto-no-keys');
          continue;
        }

        let decision = null;
        for (let round = 1; round <= 3; round += 1) {
          const result = await judgeAutoFill({
            field: entry.field,
            keys: available,
            usedKeys: Array.from(usedKeys),
            round,
          });
          if (result) {
            decision = result;
            break;
          }
        }

        if (!decision || decision.decision !== 'fill' || !decision.key) {
          setFieldStatus(entry.field.id, 'skipped', 'auto-no-decision');
          continue;
        }

        const slotValue = slotValuesRef.current[decision.key as FieldSlot];
        if (!slotValue) {
          setFieldStatus(entry.field.id, 'skipped', 'auto-invalid-key');
          continue;
        }
        const value = slotValue.trim();
        if (!value) {
          setFieldStatus(entry.field.id, 'skipped', 'auto-missing-value');
          continue;
        }

        const requestId = crypto.randomUUID();
        setFieldStatus(entry.field.id, 'pending');
        sendMessage({
          kind: 'PROMPT_FILL',
          requestId,
          fieldId: entry.field.id,
          frameId: entry.field.frameId,
          label: entry.field.label,
          mode: 'auto',
          value,
        });

        const result = await waitForFillCompletion(requestId);
        if (!result) {
          setFieldStatus(entry.field.id, 'failed', 'auto-timeout');
          continue;
        }

        if (result.status === 'filled') {
          filled += 1;
          usedKeys.add(decision.key);
        } else if (result.status === 'skipped') {
          setFieldStatus(entry.field.id, 'skipped', result.reason ?? 'auto-no-decision');
        } else {
          setFieldStatus(entry.field.id, 'failed', result.reason ?? 'auto-error');
        }
      }
    } finally {
      setAutoRunning(false);
      if (attempted > 0) {
        setAutoSummary(t('sidepanel.auto.summary', [String(filled), String(attempted)]));
      }
    }
  }, [autoRunning, buildAutoFillKeys, fieldsRef, sendMessage, setFieldStatus, slotValuesRef, t, waitForFillCompletion]);

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

    const resolver = fillResolversRef.current.get(message.requestId);
    if (resolver) {
      fillResolversRef.current.delete(message.requestId);
      resolver(message);
    }
  };

  const handleReview = (entry: FieldEntry) => {
    const options = entry.field.kind === 'file' ? [] : manualOptions;

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

  const manualTree = useMemo<ManualValueNode[]>(
    () =>
      buildManualValueTree(selectedProfile, {
        resumeLabel: t('sidepanel.manual.resumeRoot'),
        customLabel: t('sidepanel.manual.customRoot'),
      }),
    [selectedProfile, t],
  );

  const manualLeaves = useMemo(() => flattenManualLeaves(manualTree), [manualTree]);

  const manualOptions = useMemo<PromptOption[]>(
    () => {
      const seen = new Set<string>();
      const options: Array<{ slot: PromptOptionSlot; label: string; value: string }> = [];

      const addOption = (slot: PromptOptionSlot, label: string, rawValue: string | undefined) => {
        if (!rawValue) {
          return;
        }
        const normalized = rawValue.trim();
        if (!normalized || seen.has(slot)) {
          return;
        }
        seen.add(slot);
        options.push({ slot, label, value: normalized });
      };

      (Object.entries(slotValues) as Array<[FieldSlot, string | undefined]>).forEach(([slot, value]) => {
        addOption(slot, formatSlotLabel(slot), value);
      });

      manualLeaves.forEach((leaf) => {
        addOption(leaf.slotKey, leaf.displayPath, leaf.value);
      });

      return options;
    },
    [slotValues, manualLeaves],
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
            className={`mode-tab ${mode === 'auto' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setMode('auto')}
          >
            {t('sidepanel.tabs.auto')}
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
          {mode === 'auto' && renderAutoMode()}
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
    return fields.map((entry) => renderFieldCard(entry, { showReviewButton: true }));
  }

  function renderAutoMode() {
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

    return (
      <div className="auto-mode">
        <p className="info-state">{t('sidepanel.auto.description')}</p>
        <div className="auto-controls">
          <button
            type="button"
            className="primary"
            disabled={autoRunning || scanning}
            onClick={handleAutoModeRun}
          >
            {autoRunning ? t('sidepanel.auto.running') : t('sidepanel.auto.start')}
          </button>
        </div>
        {autoSummary && <div className="info-state">{autoSummary}</div>}
        {fields.map((entry) => renderFieldCard(entry))}
      </div>
    );
  }

  function renderFieldCard(entry: FieldEntry, options: { showReviewButton?: boolean } = {}) {
    const hasOptions = manualOptions.length > 0;
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
    const showReview = options.showReviewButton ?? false;

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
        {showReview && (
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
        )}
      </article>
    );
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
        {manualTree.length === 0 && (
          <div className="info-state">{t('sidepanel.states.noManualValues')}</div>
        )}
        {manualTree.length > 0 && (
          <ManualTreeView nodes={manualTree} copyLabel={t('sidepanel.buttons.copy')} onCopy={handleCopy} />
        )}
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

interface ManualTreeViewProps {
  nodes: ManualValueNode[];
  copyLabel: string;
  onCopy: (label: string, value: string) => void;
}

interface ManualNodeProps {
  node: ManualValueNode;
  depth: number;
  copyLabel: string;
  onCopy: (label: string, value: string) => void;
}

function ManualTreeView({ nodes, copyLabel, onCopy }: ManualTreeViewProps) {
  if (nodes.length === 0) {
    return null;
  }
  return (
    <div className="manual-tree">
      {nodes.map((node) => (
        <section key={node.id} className="manual-item manual-group">
          <ManualNode node={node} depth={0} copyLabel={copyLabel} onCopy={onCopy} />
        </section>
      ))}
    </div>
  );
}

function ManualNode({ node, depth, copyLabel, onCopy }: ManualNodeProps): JSX.Element {
  const hasChildren = node.children && node.children.length > 0;
  const offset = depth > 0 ? { marginLeft: `${Math.min(depth, 6) * 12}px` } : undefined;

  if (!hasChildren && typeof node.value === 'string') {
    const value = node.value;
    return (
      <div className="manual-leaf" style={offset}>
        <div className="manual-leaf-header">
          <div className="manual-leaf-info">
            <span className="manual-leaf-label">{node.label}</span>
            <span className="manual-leaf-path">{node.displayPath}</span>
          </div>
          <button type="button" onClick={() => onCopy(node.displayPath, value)}>
            {copyLabel}
          </button>
        </div>
        <div className="manual-text">{value}</div>
      </div>
    );
  }

  return (
    <details className="manual-branch" open={depth === 0} style={offset}>
      <summary>
        <span className="manual-branch-label">{node.label}</span>
        <span className="manual-count">{node.children?.length ?? 0}</span>
      </summary>
      <div className="manual-node-children">
        {node.children?.map((child) => (
          <ManualNode
            key={child.id}
            node={child}
            depth={depth + 1}
            copyLabel={copyLabel}
            onCopy={onCopy}
          />
        ))}
      </div>
    </details>
  );
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
