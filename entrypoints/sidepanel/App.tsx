import type { JSX, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NativeSelect,
  Select,
  Paper,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Title,
  Tree,
  getTreeExpandedState,
  useTree,
  type RenderTreeNodePayload,
  type TreeNodeData,
} from '@mantine/core';
import { browser } from 'wxt/browser';
import { listProfiles } from '../../shared/storage/profiles';
import type { ProfileRecord, ProviderConfig } from '../../shared/types';
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
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../../shared/llm/errors';

type PanelMode = 'dom' | 'auto' | 'manual';

type FieldStatus = 'idle' | 'pending' | 'filled' | 'skipped' | 'failed';

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

interface FieldEntry {
  field: ScannedField;
  slot: FieldSlot | null;
  selectedSlot: PromptOptionSlot | null;
  suggestion?: string;
  status: FieldStatus;
  reason?: string;
  slotSource: 'heuristic' | 'model' | 'unset';
  slotNote?: string;
  autoKey?: string;
  autoKeyLabel?: string;
  autoNote?: string;
  autoConfidence?: number;
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
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [scanRequestId, setScanRequestId] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ loadingProfiles: true });
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoSummary, setAutoSummary] = useState<string | null>(null);
  const defaultAdapterIds = useMemo(() => getAllAdapterIds(), []);
  const [activeAdapterIds, setActiveAdapterIds] = useState<string[]>(defaultAdapterIds);
  const [autoFallback, setAutoFallback] = useState<'skip' | 'pause'>('skip');
  const { t } = i18n;

  const portRef = useRef<RuntimePort | null>(null);
  const slotValuesRef = useRef<SlotValueMap>({});
  const scanRequestIdRef = useRef<string | null>(null);
  const descriptorsRef = useRef<FieldDescriptor[]>([]);
  const adapterIdsRef = useRef<string[]>(defaultAdapterIds);
  const autoFallbackRef = useRef<'skip' | 'pause'>('skip');
  const fillResolversRef = useRef<Map<string, (result: FillResultMessage) => void>>(new Map());
  const fieldsRef = useRef<FieldEntry[]>([]);
  const providerRef = useRef<ProviderConfig | null>(null);
  const selectedFieldRef = useRef<string | null>(null);
  const lastFocusedFieldRef = useRef<string | null>(null);

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
    if (fields.length === 0) {
      setSelectedFieldId(null);
      return;
    }
    if (!selectedFieldRef.current || !fields.some((entry) => entry.field.id === selectedFieldRef.current)) {
      setSelectedFieldId(fields[0].field.id);
    }
  }, [fields]);

  useEffect(() => {
    selectedFieldRef.current = selectedFieldId;
  }, [selectedFieldId]);

  useEffect(() => {
    adapterIdsRef.current = activeAdapterIds.length > 0 ? activeAdapterIds : defaultAdapterIds;
  }, [activeAdapterIds, defaultAdapterIds]);

  useEffect(() => {
    autoFallbackRef.current = autoFallback;
  }, [autoFallback]);

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
        providerRef.current = settings.provider;
        setActiveAdapterIds(settings.adapters.length > 0 ? settings.adapters : defaultAdapterIds);
        const fallback = settings.autoFallback ?? 'skip';
        setAutoFallback(fallback);
        autoFallbackRef.current = fallback;
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

  const focusField = useCallback(
    (entry: FieldEntry | null) => {
      if (!entry) {
        return;
      }
      sendMessage({
        kind: 'FOCUS_FIELD',
        fieldId: entry.field.id,
        frameId: entry.field.frameId,
      });
    },
    [sendMessage],
  );

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

  const setFieldAutoDecision = useCallback(
    (fieldId: string, details: { key?: string; keyLabel?: string; note?: string; confidence?: number }) => {
      setFields((current) =>
        current.map((entry) =>
          entry.field.id === fieldId
            ? {
                ...entry,
                autoKey: details.key,
                autoKeyLabel: details.keyLabel,
                autoNote: details.note,
                autoConfidence: details.confidence,
              }
            : entry,
        ),
      );
    },
    [],
  );

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

  const resetAutoInsights = useCallback(() => {
    setFields((current) =>
      current.map((entry) => ({
        ...entry,
        autoKey: undefined,
        autoKeyLabel: undefined,
        autoNote: undefined,
        autoConfidence: undefined,
      })),
    );
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

    if (!hasAutoFillModel(providerRef.current)) {
      const message = t('sidepanel.auto.noModel');
      setAutoSummary(message);
      setFeedback(message);
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
    let stoppedEarly = false;
    let pausedFieldLabel: string | null = null;
    let summaryLocked = false;
    const shouldPause = autoFallbackRef.current === 'pause';

    resetAutoInsights();

    try {
      for (const entry of snapshot) {
        if (stoppedEarly) {
          break;
        }
        if (entry.status === 'filled') {
          continue;
        }

        attempted += 1;

        const markAndMaybePause = (status: FieldStatus, reason: string) => {
          setFieldStatus(entry.field.id, status, reason);
          if (shouldPause && !stoppedEarly) {
            stoppedEarly = true;
            pausedFieldLabel = entry.field.label || t('sidepanel.field.noLabel');
          }
        };

        if (!supportedKinds.has(entry.field.kind)) {
          markAndMaybePause('skipped', 'auto-unsupported');
          if (stoppedEarly) {
            break;
          }
          continue;
        }
        if (entry.field.hasValue) {
          markAndMaybePause('skipped', 'auto-non-empty');
          if (stoppedEarly) {
            break;
          }
          continue;
        }

        const available = availableKeys.filter((key) => !usedKeys.has(key.key));
        if (available.length === 0) {
          markAndMaybePause('skipped', 'auto-no-keys');
          if (stoppedEarly) {
            break;
          }
          continue;
        }

        let decision = null;
        for (let round = 1; round <= 3; round += 1) {
          const result = await judgeAutoFill(providerRef.current, {
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

        if (decision) {
          const keyLabel =
            decision.decision === 'fill' && decision.key
              ? available.find((item) => item.key === decision.key)?.label ?? formatSlotLabel(decision.key as FieldSlot)
              : undefined;
          setFieldAutoDecision(entry.field.id, {
            key: decision.decision === 'fill' ? decision.key : undefined,
            keyLabel,
            note: decision.reason,
            confidence: decision.confidence,
          });
        }

        if (!decision || decision.decision !== 'fill' || !decision.key) {
          markAndMaybePause('skipped', 'auto-no-decision');
          if (stoppedEarly) {
            break;
          }
          continue;
        }

        const slotValue = slotValuesRef.current[decision.key as FieldSlot];
        if (!slotValue) {
          markAndMaybePause('skipped', 'auto-invalid-key');
          if (stoppedEarly) {
            break;
          }
          continue;
        }
        const value = slotValue.trim();
        if (!value) {
          markAndMaybePause('skipped', 'auto-missing-value');
          if (stoppedEarly) {
            break;
          }
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
          markAndMaybePause('failed', 'auto-timeout');
          if (stoppedEarly) {
            break;
          }
          continue;
        }

        if (result.status === 'filled') {
          filled += 1;
          usedKeys.add(decision.key);
        } else if (result.status === 'skipped') {
          markAndMaybePause('skipped', result.reason ?? 'auto-no-decision');
          if (stoppedEarly) {
            break;
          }
        } else {
          markAndMaybePause('failed', result.reason ?? 'auto-error');
          if (stoppedEarly) {
            break;
          }
        }
      }
    } catch (error) {
      if (
        error instanceof NoProviderConfiguredError ||
        error instanceof ProviderConfigurationError ||
        error instanceof ProviderAvailabilityError ||
        error instanceof ProviderInvocationError
      ) {
        setAutoSummary(error.message);
        setFeedback(error.message);
        summaryLocked = true;
      } else {
        console.warn('Auto mode run failed', error);
        const message =
          error instanceof Error ? error.message : t('sidepanel.auto.noModel');
        setAutoSummary(message);
        setFeedback(message);
        summaryLocked = true;
      }
    } finally {
      setAutoRunning(false);
      if (summaryLocked) {
        return;
      }
      if (stoppedEarly && pausedFieldLabel) {
        setAutoSummary(
          t('sidepanel.auto.paused', [String(filled), String(attempted), pausedFieldLabel]),
        );
      } else if (attempted > 0) {
        setAutoSummary(t('sidepanel.auto.summary', [String(filled), String(attempted)]));
      }
    }
  }, [
    autoRunning,
    buildAutoFillKeys,
    fieldsRef,
    resetAutoInsights,
    sendMessage,
    setFieldAutoDecision,
    setFieldStatus,
    slotValuesRef,
    t,
    waitForFillCompletion,
  ]);

  const requestScan = () => {
    if (!portRef.current) {
      return;
    }
    const requestId = crypto.randomUUID();
    setScanRequestId(requestId);
    scanRequestIdRef.current = requestId;
    setScanning(true);
    setFields([]);
    setSelectedFieldId(null);
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

  const handleSlotSelectionChange = (fieldId: string, slot: PromptOptionSlot | null) => {
    setFields((current) =>
      current.map((entry) =>
        entry.field.id === fieldId
          ? {
              ...entry,
              selectedSlot: slot,
            }
          : entry,
      ),
    );
  };

  const handleSelectField = (entry: FieldEntry) => {
    setSelectedFieldId(entry.field.id);
  };

  const handleReview = (entry: FieldEntry) => {
    if (entry.field.kind === 'file') {
      const requestId = crypto.randomUUID();
      sendMessage({
        kind: 'PROMPT_FILL',
        requestId,
        fieldId: entry.field.id,
        frameId: entry.field.frameId,
        label: entry.field.label,
        mode: 'click',
        preview: t('sidepanel.preview.file'),
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
      return;
    }

    if (manualOptions.length === 0) {
      setFeedback(t('sidepanel.feedback.noValues'));
      return;
    }

    const { value } = resolveEntryData(entry);
    if (!value) {
      setFeedback(t('sidepanel.feedback.noValues'));
      return;
    }

    const requestId = crypto.randomUUID();
    sendMessage({
      kind: 'PROMPT_FILL',
      requestId,
      fieldId: entry.field.id,
      frameId: entry.field.frameId,
      label: entry.field.label,
      mode: 'fill',
      value,
      preview: value,
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

  const selectedEntry = useMemo(
    () => fields.find((entry) => entry.field.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );

  const resolveEntryData = useCallback(
    (entry: FieldEntry) => {
      if (entry.field.kind === 'file') {
        return {
          selectedOption: null as PromptOption | null,
          fallbackOption: null as PromptOption | null,
          value: '',
        };
      }
      const selectedOption =
        entry.selectedSlot !== null
          ? manualOptions.find((option) => option.slot === entry.selectedSlot) ?? null
          : null;
      const fallbackOption =
        entry.slot !== null
          ? manualOptions.find((option) => option.slot === entry.slot) ?? null
          : null;
      const value = (selectedOption?.value ?? fallbackOption?.value ?? entry.suggestion ?? '').trim();
      return { selectedOption, fallbackOption, value };
    },
    [manualOptions],
  );

  useEffect(() => {
    if (!selectedEntry) {
      lastFocusedFieldRef.current = null;
      return;
    }
    if (lastFocusedFieldRef.current === selectedEntry.field.id) {
      return;
    }
    focusField(selectedEntry);
    lastFocusedFieldRef.current = selectedEntry.field.id;
  }, [focusField, selectedEntry]);

  const classifyAndApply = useCallback(async (descriptors: FieldDescriptor[]): Promise<boolean> => {
    if (descriptors.length === 0) {
      return false;
    }
    try {
      const map = await classifyFieldDescriptors(providerRef.current, descriptors);
      if (map.size === 0) {
        return false;
      }
      setFields((current) =>
        current.map((entry) => {
          const match = map.get(entry.field.id);
          if (!match?.slot) {
            return entry;
          }
          const suggestion = slotValuesRef.current[match.slot] ?? entry.suggestion;
          const shouldUpdateSelection = entry.selectedSlot === entry.slot || entry.selectedSlot === null;
          return {
            ...entry,
            slot: match.slot,
            suggestion,
            slotSource: 'model',
            slotNote: match.reason,
            selectedSlot: suggestion && shouldUpdateSelection ? match.slot : entry.selectedSlot,
          };
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof NoProviderConfiguredError ||
        error instanceof ProviderConfigurationError ||
        error instanceof ProviderAvailabilityError ||
        error instanceof ProviderInvocationError
      ) {
        setFeedback(error.message);
        return false;
      }
      console.warn('Field classification failed', error);
      return false;
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
      const updated = await classifyAndApply(descriptors);
      if (updated) {
        setFeedback(t('sidepanel.feedback.classificationUpdated'));
      }
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

  const profileOptions = useMemo(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: formatProfileLabel(profile),
      })),
    [profiles],
  );

  const selectOptions = useMemo(
    () => [
      { value: '', label: t('sidepanel.states.noProfilesOption') },
      ...profileOptions,
    ],
    [profileOptions, t],
  );

  const fillDisabled =
    fields.length === 0 ||
    fields.every(
      (entry) =>
        entry.field.kind === 'file' ||
        !entry.suggestion ||
        entry.suggestion.trim().length === 0 ||
        entry.status === 'pending' ||
        entry.status === 'filled',
    );

  const classifyDisabled = classifying || fields.length === 0;
  const autoButtonDisabled = autoRunning || scanning;

  const renderStateAlert = (message: string, tone: 'gray' | 'red' | 'blue' = 'gray') => (
    <Alert color={tone} variant="light" radius="lg">
      {message}
    </Alert>
  );

  const renderPanel = (content: ReactNode) => (
    <ScrollArea style={{ height: '100%' }} px="md" py="md">
      <Stack gap="md">
        {feedback && (
          <Alert color="blue" variant="light" radius="lg" onClose={() => setFeedback(null)} withCloseButton>
            {feedback}
          </Alert>
        )}
        {content}
      </Stack>
    </ScrollArea>
  );

  return (
    <Stack gap={0} style={{ height: '100vh' }}>
      <Paper shadow="sm" withBorder={false} px="md" py="sm">
        <Stack gap={2}>
          <Title order={3}>{t('sidepanel.title')}</Title>
          <Text fz="sm" c="dimmed">
            {t('sidepanel.subtitle')}
          </Text>
        </Stack>
      </Paper>
      <Stack gap={0} style={{ flex: 1, overflow: 'hidden' }}>
        <Paper px="md" py="sm" withBorder={false} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
          <Stack gap="sm">
            <NativeSelect
              label={t('popup.title')}
              value={selectedProfileId ?? ''}
              onChange={(event) => setSelectedProfileId(event.currentTarget.value || null)}
              data={selectOptions}
              size="sm"
            />
            <Group gap="sm" wrap="wrap">
              <Button variant="light" size="sm" onClick={requestScan} disabled={scanning}>
                {scanning ? t('sidepanel.toolbar.scanning') : t('sidepanel.toolbar.rescan')}
              </Button>
              <Button
                variant="light"
                size="sm"
                onClick={handleClassify}
                disabled={classifyDisabled}
              >
                {classifying ? t('sidepanel.toolbar.classifying') : t('sidepanel.toolbar.classify')}
              </Button>
              <Button
                size="sm"
                onClick={handleAutoFill}
                disabled={fillDisabled}
              >
                {t('sidepanel.toolbar.fillMapped')}
              </Button>
              <Button
                variant="light"
                size="sm"
                onClick={() => sendMessage({ kind: 'CLEAR_OVERLAY' })}
              >
                {t('sidepanel.toolbar.clearOverlay')}
              </Button>
              <Button variant="light" size="sm" onClick={openProfilesPage}>
                {t('sidepanel.toolbar.manageProfiles')}
              </Button>
            </Group>
          </Stack>
        </Paper>
        <Tabs
          value={mode}
          onChange={(value) => setMode((value as PanelMode) ?? 'dom')}
          keepMounted={false}
          variant="outline"
          radius="md"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          <Tabs.List>
            <Tabs.Tab value="dom">{t('sidepanel.tabs.dom')}</Tabs.Tab>
            <Tabs.Tab value="auto">{t('sidepanel.tabs.auto')}</Tabs.Tab>
            <Tabs.Tab value="manual">{t('sidepanel.tabs.manual')}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel
            value="dom"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <Stack gap={0} style={{ height: '100%', overflow: 'hidden' }}>
              <ScrollArea style={{ flex: 1 }} px="md" py="md">
                <Stack gap="md">
                  {feedback && (
                    <Alert
                      color="blue"
                      variant="light"
                      radius="lg"
                      onClose={() => setFeedback(null)}
                      withCloseButton
                    >
                      {feedback}
                    </Alert>
                  )}
                  {renderDomMode()}
                </Stack>
              </ScrollArea>
              <Paper
                px="md"
                py="sm"
                withBorder
                shadow="sm"
                style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
              >
                {renderSelectionFooter()}
              </Paper>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="auto" style={{ flex: 1, overflow: 'hidden' }}>
            {renderPanel(renderAutoMode())}
          </Tabs.Panel>
          <Tabs.Panel value="manual" style={{ flex: 1, overflow: 'hidden' }}>
            {renderPanel(renderManualMode())}
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Stack>
  );

  function renderDomMode() {
    if (viewState.loadingProfiles) {
      return renderStateAlert(t('sidepanel.states.loadingProfiles'), 'blue');
    }
    if (viewState.error) {
      return renderStateAlert(t('sidepanel.states.error', [viewState.error]), 'red');
    }
    if (!selectedProfile) {
      return renderStateAlert(t('sidepanel.states.noProfile'));
    }
    if (scanning) {
      return renderStateAlert(t('sidepanel.toolbar.scanning'), 'blue');
    }
    if (fields.length === 0) {
      return renderStateAlert(t('sidepanel.states.noFields'));
    }
    return (
      <Stack gap="sm">
        {fields.map((entry) => renderFieldCard(entry, { isSelected: entry.field.id === selectedFieldId }))}
      </Stack>
    );
  }

  function renderAutoMode() {
    if (viewState.loadingProfiles) {
      return renderStateAlert(t('sidepanel.states.loadingProfiles'), 'blue');
    }
    if (viewState.error) {
      return renderStateAlert(t('sidepanel.states.error', [viewState.error]), 'red');
    }
    if (!selectedProfile) {
      return renderStateAlert(t('sidepanel.states.noProfile'));
    }
    if (scanning) {
      return renderStateAlert(t('sidepanel.toolbar.scanning'), 'blue');
    }
    if (fields.length === 0) {
      return renderStateAlert(t('sidepanel.states.noFields'));
    }

    return (
      <Stack gap="sm">
        <Alert color="blue" variant="light" radius="lg">
          {t('sidepanel.auto.description')}
        </Alert>
        <Group gap="sm" wrap="wrap">
          <Button onClick={handleAutoModeRun} disabled={autoButtonDisabled} loading={autoRunning} size="sm">
            {autoRunning ? t('sidepanel.auto.running') : t('sidepanel.auto.start')}
          </Button>
        </Group>
        {autoSummary && renderStateAlert(autoSummary)}
        <Stack gap="sm">
          {fields.map((entry) => renderFieldCard(entry, { isSelected: entry.field.id === selectedFieldId }))}
        </Stack>
      </Stack>
    );
  }

  function renderFieldCard(entry: FieldEntry, options: { isSelected?: boolean } = {}) {
    const { selectedOption, value } = resolveEntryData(entry);
    const baseSlotLabel = entry.slot ? formatSlotLabel(entry.slot) : t('sidepanel.field.unmapped');
    const slotLabel =
      entry.slot && entry.slotSource === 'model'
        ? `${baseSlotLabel}${t('sidepanel.field.aiSuffix')}`
        : baseSlotLabel;
    const summary = (() => {
      if (entry.field.kind === 'file') {
        return t('sidepanel.field.fileSummary');
      }
      if (selectedOption) {
        return t('sidepanel.field.selectedValue', [truncate(selectedOption.value)]);
      }
      if (value) {
        return entry.slotSource === 'model'
          ? t('sidepanel.field.suggestedAI', [truncate(value)])
          : t('sidepanel.field.suggestedProfile', [truncate(value)]);
      }
      return manualOptions.length > 0 ? t('sidepanel.field.chooseValue') : t('sidepanel.field.noValues');
    })();

    const autoInfo: string[] = [];
    const autoConfidencePercent =
      typeof entry.autoConfidence === 'number' ? Math.round(entry.autoConfidence * 100) : null;
    if (entry.autoKeyLabel) {
      autoInfo.push(
        autoConfidencePercent !== null
          ? t('sidepanel.field.autoKeyWithConfidence', [entry.autoKeyLabel, String(autoConfidencePercent)])
          : t('sidepanel.field.autoKey', [entry.autoKeyLabel]),
      );
    }
    if (entry.autoNote) {
      autoInfo.push(t('sidepanel.field.autoReason', [entry.autoNote]));
    }

    const isSelected = options.isSelected ?? false;
    const statusColor =
      entry.status === 'filled'
        ? 'green'
        : entry.status === 'failed'
          ? 'red'
          : entry.status === 'pending'
            ? 'blue'
            : 'gray';

    return (
      <Card
        key={entry.field.id}
        withBorder
        radius="md"
        p="sm"
        shadow={isSelected ? 'sm' : 'xs'}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectField(entry)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleSelectField(entry);
          }
        }}
        style={{
          cursor: 'pointer',
          borderColor: isSelected ? 'var(--mantine-color-blue-5)' : undefined,
          backgroundColor: isSelected ? 'rgba(76, 159, 254, 0.08)' : undefined,
          outline: 'none',
        }}
      >
        <Stack gap="xs">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4} flex={1}>
              <Text fw={600} fz="sm">
                {entry.field.label || t('sidepanel.field.noLabel')}
                {entry.field.required ? ' *' : ''}
              </Text>
              <Text fz="xs" c="dimmed">
                {t('sidepanel.field.meta', [
                  t(`sidepanel.fieldKind.${entry.field.kind}`),
                  slotLabel,
                  String(entry.field.frameId),
                ])}
              </Text>
              <Text fz="xs" c="dimmed">
                {summary}
              </Text>
            </Stack>
            {entry.status !== 'idle' && (
              <Badge color={statusColor} variant="light" size="sm">
                {t(`sidepanel.status.${entry.status}`)}
              </Badge>
            )}
          </Group>
          {entry.slotNote && (
            <Text fz="xs" c="dimmed">
              {t('sidepanel.field.aiNote', [entry.slotNote])}
            </Text>
          )}
          {entry.reason && (
            <Text fz="xs" c="dimmed">
              {formatFillReason(entry.reason)}
            </Text>
          )}
          {autoInfo.map((line) => (
            <Text key={line} fz="xs" c="dimmed">
              {line}
            </Text>
          ))}
        </Stack>
      </Card>
    );
  }

  function renderSelectionFooter() {
    if (viewState.loadingProfiles) {
      return (
        <Text fz="sm" c="dimmed">
          {t('sidepanel.states.loadingProfiles')}
        </Text>
      );
    }
    if (viewState.error) {
      return (
        <Text fz="sm" c="red">
          {t('sidepanel.states.error', [viewState.error])}
        </Text>
      );
    }
    if (!selectedEntry) {
      const baseMessage =
        scanning && fields.length === 0
          ? t('sidepanel.toolbar.scanning')
          : fields.length === 0
            ? t('sidepanel.states.noFields')
            : t('sidepanel.footer.noSelection');
      return (
        <Text fz="sm" c="dimmed">
          {baseMessage}
        </Text>
      );
    }

    if (selectedEntry.field.kind === 'file') {
      return (
        <Group justify="space-between" align="flex-start">
          <Stack gap={4} flex={1}>
            <Text fw={600} fz="sm">
              {selectedEntry.field.label || t('sidepanel.field.noLabel')}
              {selectedEntry.field.required ? ' *' : ''}
            </Text>
            <Text fz="xs" c="dimmed">
              {t('sidepanel.field.fileSummary')}
            </Text>
          </Stack>
          <Button
            size="sm"
            onClick={() => handleReview(selectedEntry)}
            disabled={selectedEntry.status === 'pending'}
          >
            {t('sidepanel.buttons.openPicker')}
          </Button>
        </Group>
      );
    }

    const { fallbackOption, value } = resolveEntryData(selectedEntry);
    const currentSlot =
      selectedEntry.selectedSlot ??
      (fallbackOption ? (fallbackOption.slot as PromptOptionSlot | null) : null);
    const fillDisabled = selectedEntry.status === 'pending' || !value;

    return (
      <Stack gap="sm">
        <Stack gap={4}>
          <Text fw={600} fz="sm">
            {selectedEntry.field.label || t('sidepanel.field.noLabel')}
            {selectedEntry.field.required ? ' *' : ''}
          </Text>
          <Text fz="xs" c="dimmed">
            {t('sidepanel.footer.selectionHint')}
          </Text>
        </Stack>
        <Select
          label={t('sidepanel.field.selectorLabel')}
          placeholder={t('sidepanel.field.selectPlaceholder')}
          data={manualOptions.map((option) => ({
            value: option.slot,
            label: `${option.label} · ${truncate(option.value)}`,
          }))}
          value={currentSlot}
          onChange={(slot) =>
            handleSlotSelectionChange(
              selectedEntry.field.id,
              slot ? (slot as PromptOptionSlot) : null,
            )
          }
          size="sm"
          clearable
          searchable={manualOptions.length > 7}
          comboboxProps={{ withinPortal: true }}
        />
        <Text fz="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
          {value ? truncate(value, 200) : t('sidepanel.field.chooseValue')}
        </Text>
        <Group justify="flex-end">
          <Button size="sm" disabled={fillDisabled} onClick={() => handleReview(selectedEntry)}>
            {t('sidepanel.buttons.fillField')}
          </Button>
        </Group>
      </Stack>
    );
  }

  function renderManualMode() {
    if (viewState.loadingProfiles) {
      return renderStateAlert(t('sidepanel.states.loadingProfiles'), 'blue');
    }
    if (viewState.error) {
      return renderStateAlert(t('sidepanel.states.error', [viewState.error]), 'red');
    }
    if (!selectedProfile) {
      return renderStateAlert(t('sidepanel.states.noProfileManual'));
    }
    return (
      <Stack gap="md">
        {manualTree.length === 0 && renderStateAlert(t('sidepanel.states.noManualValues'))}
        {manualTree.length > 0 && (
          <ManualTreeView nodes={manualTree} copyLabel={t('sidepanel.buttons.copy')} onCopy={handleCopy} />
        )}
        <Card withBorder radius="md" shadow="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Text fw={600}>{t('sidepanel.manual.rawLabel')}</Text>
              <Button
                size="xs"
                variant="light"
                onClick={() => handleCopy(t('sidepanel.manual.rawLabel'), selectedProfile.rawText)}
              >
                {t('sidepanel.buttons.copyAll')}
              </Button>
            </Group>
            <Paper withBorder radius="md" p="sm">
              <ScrollArea h={220}>
                <Text
                  component="pre"
                  fz="sm"
                  style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {selectedProfile.rawText}
                </Text>
              </ScrollArea>
            </Paper>
          </Stack>
        </Card>
      </Stack>
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
      selectedSlot: suggestion ? slot : null,
      suggestion,
      status: 'idle',
      reason: undefined,
      slotSource: slot ? 'heuristic' : 'unset',
      slotNote: undefined,
      autoKey: undefined,
      autoKeyLabel: undefined,
      autoNote: undefined,
      autoConfidence: undefined,
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

type ManualTreeNodeData = TreeNodeData & { manualNode: ManualValueNode };

function ManualTreeView({ nodes, copyLabel, onCopy }: ManualTreeViewProps) {
  if (nodes.length === 0) {
    return null;
  }

  const treeData = useMemo<ManualTreeNodeData[]>(() => nodes.map(mapManualNodeToTreeNode), [nodes]);
  const initialExpandedState = useMemo(() => getTreeExpandedState(treeData, '*'), [treeData]);
  const tree = useTree({ initialExpandedState });

  const { setExpandedState, clearSelected, setHoveredNode } = tree;
  useEffect(() => {
    setExpandedState(initialExpandedState);
    clearSelected();
    setHoveredNode(null);
  }, [initialExpandedState, setExpandedState, clearSelected, setHoveredNode]);

  const renderNode = useCallback(
    ({ node, elementProps, hasChildren }: RenderTreeNodePayload) => {
      const manualNode = (node as ManualTreeNodeData).manualNode;
      const { className, style, ...rest } = elementProps;

      if (!hasChildren && typeof manualNode.value === 'string') {
        const value = manualNode.value;
        return (
          <div className={className} style={{ ...style, paddingBlock: 'var(--mantine-spacing-xs)' }} {...rest}>
            <Card withBorder radius="md" shadow="sm">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={2}>
                    <Text fw={600} fz="sm">
                      {manualNode.label}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {manualNode.displayPath}
                    </Text>
                  </Stack>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopy(manualNode.displayPath, value);
                    }}
                  >
                    {copyLabel}
                  </Button>
                </Group>
                <Text fz="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {value}
                </Text>
              </Stack>
            </Card>
          </div>
        );
      }

      return (
        <div className={className} style={{ ...style, paddingBlock: 'var(--mantine-spacing-xs)' }} {...rest}>
          <Group gap="xs" align="center">
            <Text fw={600} fz="sm">
              {manualNode.label}
            </Text>
            <Badge variant="light" color="gray" size="sm">
              {(manualNode.children?.length ?? 0).toLocaleString()}
            </Badge>
          </Group>
        </div>
      );
    },
    [copyLabel, onCopy],
  );

  return <Tree data={treeData} tree={tree} levelOffset="md" renderNode={renderNode} />;
}

function mapManualNodeToTreeNode(node: ManualValueNode): ManualTreeNodeData {
  return {
    value: node.id,
    label: node.label,
    manualNode: node,
    children: node.children?.map(mapManualNodeToTreeNode),
  };
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
