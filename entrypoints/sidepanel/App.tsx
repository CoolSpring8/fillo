import type { ChangeEvent, JSX, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Menu,
  NativeSelect,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tree,
  Tooltip,
  getTreeExpandedState,
  useComputedColorScheme,
  useMantineTheme,
  useTree,
  type RenderTreeNodePayload,
  type TreeNodeData,
} from '@mantine/core';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Eraser,
  ListChecks,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  Trash2,
  Users,
  Wand2,
} from 'lucide-react';
import { notifications } from '@mantine/notifications';
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
// Auto mode removed; new guided mode uses side panel controls and shared memory
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../../shared/llm/errors';

function isFieldSlotValue(slot: PromptOptionSlot | null | undefined): slot is FieldSlot {
  return typeof slot === 'string' && !slot.startsWith('profile.');
}

function hexToRgba(color: string | undefined, alpha: number): string {
  if (!color) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  let hex = color.trim();
  if (hex.startsWith('#')) {
    hex = hex.slice(1);
  }
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (hex.length !== 6 || Number.isNaN(Number.parseInt(hex, 16))) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type PanelMode = 'dom' | 'guided' | 'manual';

type FieldStatus = 'idle' | 'pending' | 'filled' | 'skipped' | 'failed';

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

interface FieldEntry {
  field: ScannedField;
  slot: FieldSlot | null;
  selectedSlot: PromptOptionSlot | null;
  suggestion?: string;
  manualValue: string;
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
  const [classifying, setClassifying] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const defaultAdapterIds = useMemo(() => getAllAdapterIds(), []);
  const [activeAdapterIds, setActiveAdapterIds] = useState<string[]>(defaultAdapterIds);
  // Guided mode state
  const [guidedStarted, setGuidedStarted] = useState(false);
  const [guidedIndex, setGuidedIndex] = useState<number>(0);
  const [guidedFilled, setGuidedFilled] = useState<number>(0);
  const [guidedSkipped, setGuidedSkipped] = useState<number>(0);
  const [memoryList, setMemoryList] = useState<Array<{ key: string; association: any }>>([]);
  const { t } = i18n;
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('light');
  const primaryPalette = theme.colors[theme.primaryColor] ?? theme.colors.blue ?? [];
  const accentPalette = theme.colors.teal ?? theme.colors.cyan ?? primaryPalette;
  const softPalette = theme.colors.pink ?? theme.colors.violet ?? primaryPalette;
  const neutralPalette = theme.colors.gray ?? [];
  const surfaceBaseHex = colorScheme === 'dark' ? theme.colors.dark?.[8] ?? '#0b1020' : theme.white ?? '#ffffff';
  const surfaceElevatedHex =
    colorScheme === 'dark' ? theme.colors.dark?.[6] ?? '#161b2a' : neutralPalette?.[0] ?? '#f8f9fa';
  const brandPrimaryHex = primaryPalette?.[colorScheme === 'dark' ? 4 : 6] ?? '#3345a2';
  const brandBrightHex = primaryPalette?.[colorScheme === 'dark' ? 5 : 4] ?? '#4c6ef5';
  const accentHex = accentPalette?.[colorScheme === 'dark' ? 5 : 2] ?? '#15aabf';
  const softHex = softPalette?.[colorScheme === 'dark' ? 4 : 1] ?? '#ffd6e8';
  const neutralTextHex = neutralPalette?.[colorScheme === 'dark' ? 2 : 7] ?? '#495057';

  const portRef = useRef<RuntimePort | null>(null);
  const slotValuesRef = useRef<SlotValueMap>({});
  const scanRequestIdRef = useRef<string | null>(null);
  const descriptorsRef = useRef<FieldDescriptor[]>([]);
  const adapterIdsRef = useRef<string[]>(defaultAdapterIds);
  const guidedIndexRef = useRef<number>(0);
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
    guidedIndexRef.current = guidedIndex;
  }, [guidedIndex]);

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
        if (cancelled) return;
        providerRef.current = settings.provider;
        setActiveAdapterIds(settings.adapters.length > 0 ? settings.adapters : defaultAdapterIds);
      } catch (error) {
        console.warn('Failed to load settings', error);
      }
    };

    loadSettings().catch(console.error);

    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
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
    const styleId = 'apply-pilot-permission-gradient';
    if (document.getElementById(styleId)) {
      return;
    }
    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent = `
      @keyframes apply-pilot-permission-gradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(styleElement);
    return () => {
      const existing = document.getElementById(styleId);
      if (existing) {
        existing.remove();
      }
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
        if (!parsed) return;
        if (scanRequestIdRef.current && parsed.requestId !== scanRequestIdRef.current) return;

        // Apply heuristics first, then augment with memory preferences
        const initial = buildFieldEntries(parsed.fields, slotValuesRef.current, adapterIdsRef.current);
        // Lazy-load memory and apply preferred slots/values
        void (async () => {
          const { loadMemory, computeSignatureKey } = await import('../../shared/memory/store');
          const memory = await loadMemory();
          const withMemory = initial.map((entry) => {
            const key = computeSignatureKey(entry.field);
            const assoc = memory[key];
            if (!assoc) return entry;
            let next = { ...entry };
            if (assoc.preferredSlot) {
              // If the preferred slot has a value in current profile, use it
              if (isFieldSlotValue(assoc.preferredSlot)) {
                const pref = slotValuesRef.current[assoc.preferredSlot];
                if (pref && pref.trim().length > 0) {
                  next.selectedSlot = assoc.preferredSlot;
                  next.suggestion = pref;
                }
              }
            }
            if (!next.suggestion && assoc.lastValue && assoc.lastValue.trim().length > 0) {
              next.suggestion = assoc.lastValue;
            }
            return {
              ...next,
              manualValue: deriveManualValue(entry, next.suggestion),
            };
          });
          setFields(withMemory);
        })().catch(console.error);

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
      setPermissionGranted(false);
    });

    return () => {
      port.onMessage.removeListener(handleMessage);
      port.disconnect();
      portRef.current = null;
    };
  }, []);

  const sendMessage = useCallback(
    (payload: Record<string, unknown>) => {
      if (!permissionGranted) {
        return;
      }
      const port = portRef.current;
      if (!port) {
        return;
      }
      port.postMessage(payload);
    },
    [permissionGranted],
  );

  const notify = useCallback((message: string, tone: 'info' | 'success' | 'error' = 'info') => {
    const colorMap: Record<'info' | 'success' | 'error', 'brand' | 'green' | 'red'> = {
      info: 'brand',
      success: 'green',
      error: 'red',
    };
    notifications.show({
      message,
      color: colorMap[tone],
      autoClose: 2500,
      withCloseButton: true,
    });
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

  // Auto insights removed with Guided mode replacement

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

  // Auto mode helpers removed

  // Auto mode helpers removed


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
      notify(t('sidepanel.feedback.noMapped'));
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
    notify(t('sidepanel.feedback.autofill', targets.length, [String(targets.length)]));
  }, [fields, notify, sendMessage, t]);

  // Auto mode flow removed

  const overlayGradient = useMemo(
    () =>
      `linear-gradient(140deg,
        ${hexToRgba(surfaceBaseHex, colorScheme === 'dark' ? 0.94 : 0.96)} 0%,
        ${hexToRgba(brandBrightHex, colorScheme === 'dark' ? 0.42 : 0.24)} 30%,
        ${hexToRgba(accentHex, colorScheme === 'dark' ? 0.32 : 0.22)} 60%,
        ${hexToRgba(softHex, colorScheme === 'dark' ? 0.36 : 0.22)} 100%)`,
    [accentHex, brandBrightHex, colorScheme, softHex, surfaceBaseHex],
  );

  const permissionCardStyles = useMemo(
    () => ({
      position: 'relative' as const,
      borderRadius: 24,
      padding: '2.25rem',
      background: hexToRgba(surfaceElevatedHex, colorScheme === 'dark' ? 0.88 : 0.94),
      border: `1px solid ${hexToRgba(brandBrightHex, colorScheme === 'dark' ? 0.34 : 0.18)}`,
      boxShadow:
        colorScheme === 'dark'
          ? '0 32px 70px rgba(5, 10, 25, 0.55)'
          : '0 32px 70px rgba(15, 23, 42, 0.14)',
      backdropFilter: `blur(${colorScheme === 'dark' ? 12 : 18}px)`,
    }),
    [brandBrightHex, colorScheme, surfaceElevatedHex],
  );

  const permissionTitleColor = colorScheme === 'dark' ? theme.white : brandPrimaryHex;
  const permissionBodyColor = hexToRgba(neutralTextHex, colorScheme === 'dark' ? 0.86 : 0.92);
  const permissionNoteBackground = hexToRgba(softHex, colorScheme === 'dark' ? 0.2 : 0.3);
  const permissionNoteBorder = hexToRgba(brandBrightHex, colorScheme === 'dark' ? 0.38 : 0.24);
  const permissionNoteText = hexToRgba(neutralTextHex, colorScheme === 'dark' ? 0.78 : 0.82);

  const requestScan = useCallback(() => {
    if (!permissionGranted) {
      return;
    }
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
  }, [permissionGranted, sendMessage]);

  useEffect(() => {
    if (!permissionGranted || !portRef.current) {
      return;
    }
    requestScan();
  }, [permissionGranted, requestScan, selectedProfileId]);

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
    const option = slot ? manualOptions.find((entry) => entry.slot === slot) ?? null : null;
    setFields((current) =>
      current.map((entry) =>
        entry.field.id === fieldId
          ? {
              ...entry,
              selectedSlot: slot,
              suggestion: option ? option.value : entry.suggestion,
              manualValue: option ? option.value : entry.manualValue,
            }
          : entry,
      ),
    );
  };

  const handleManualValueChange = (fieldId: string, value: string) => {
    setFields((current) =>
      current.map((entry) =>
        entry.field.id === fieldId
          ? {
              ...entry,
              manualValue: value,
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
      notify(t('sidepanel.feedback.noValues'), 'info');
      return;
    }

    const { value } = resolveEntryData(entry);
    if (!value) {
      notify(t('sidepanel.feedback.noValues'), 'info');
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
      notify(t('sidepanel.feedback.copied', [label]), 'success');
    } catch (error) {
      console.error('Failed to copy', error);
      notify(t('sidepanel.feedback.noClipboard'), 'error');
    }
  };

  const manualTree = useMemo<ManualValueNode[]>(
    () =>
      buildManualValueTree(selectedProfile, {
        resumeLabel: t('sidepanel.manual.resumeRoot'),
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
          manualValue: '',
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
      const manualValue = entry.manualValue ?? '';
      const manualValueTrimmed = manualValue.trim();
      const fallbackValue = (selectedOption?.value ?? fallbackOption?.value ?? entry.suggestion ?? '').trim();
      const value = manualValueTrimmed.length > 0 ? manualValueTrimmed : fallbackValue;
      return { selectedOption, fallbackOption, manualValue, value };
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
            manualValue: deriveManualValue(entry, suggestion),
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
        notify(error.message, 'error');
        return false;
      }
      console.warn('Field classification failed', error);
      return false;
    }
  }, [notify]);

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
        notify(t('sidepanel.feedback.classificationUpdated'), 'success');
      }
    } finally {
      setClassifying(false);
    }
  }, [classifying, classifyAndApply, notify, t]);

  const openProfilesPage = () => {
    browser.tabs
      .create({ url: browser.runtime.getURL('/options.html') })
      .catch((error: unknown) => {
        console.warn('Unable to open options page.', error);
    });
  };

  const handlePermissionAccept = useCallback(() => {
    setPermissionGranted(true);
  }, []);

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
  const guidedTotal = fields.length;
  const isFirst = guidedStarted ? guidedIndex <= 0 : true;
  const isLast = guidedStarted ? guidedIndex >= Math.max(guidedTotal - 1, 0) : false;

  const renderStateAlert = (message: string, tone: 'gray' | 'red' | 'brand' = 'gray') => (
    <Alert color={tone} variant="light" radius="lg">
      {message}
    </Alert>
  );

  const renderPanel = (content: ReactNode) => (
    <ScrollArea style={{ height: '100%' }} px="md" py="md">
      <Stack gap="md">{content}</Stack>
    </ScrollArea>
  );

  const renderDomToolbar = () => {
    const iconSize = 18;
    const baseDisabled = viewState.loadingProfiles || !selectedProfile;
    const statusBadge = scanning
      ? { color: 'brand' as const, label: t('sidepanel.toolbar.scanning') }
      : classifying
        ? { color: 'violet' as const, label: t('sidepanel.toolbar.classifying') }
        : null;

    const renderIconButton = (
      label: string,
      options: {
        onClick: () => void;
        disabled?: boolean;
        color?: string;
        variant?: 'subtle' | 'light' | 'filled';
        icon: JSX.Element;
      },
    ) => (
      <Tooltip key={label} label={label} withArrow>
        <ActionIcon
          aria-label={label}
          onClick={options.onClick}
          disabled={baseDisabled || options.disabled}
          variant={options.variant ?? 'light'}
          color={options.color ?? 'gray'}
          radius="md"
          size="lg"
        >
          {options.icon}
        </ActionIcon>
      </Tooltip>
    );

    return (
      <Group justify="space-between" align="center" gap="xs" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          {renderIconButton(scanning ? t('sidepanel.toolbar.scanning') : t('sidepanel.toolbar.rescan'), {
            onClick: requestScan,
            disabled: scanning,
            color: 'brand',
            variant: scanning ? 'filled' : 'light',
            icon: <RefreshCcw size={iconSize} />,
          })}
          {renderIconButton(classifying ? t('sidepanel.toolbar.classifying') : t('sidepanel.toolbar.classify'), {
            onClick: handleClassify,
            disabled: classifyDisabled,
            color: 'violet',
            variant: classifying ? 'filled' : 'light',
            icon: <Wand2 size={iconSize} />,
          })}
          {renderIconButton(t('sidepanel.toolbar.fillMapped'), {
            onClick: handleAutoFill,
            disabled: fillDisabled,
            color: 'brand',
            variant: 'filled',
            icon: <Sparkles size={iconSize} />,
          })}
          {renderIconButton(t('sidepanel.toolbar.clearOverlay'), {
            onClick: () => sendMessage({ kind: 'CLEAR_OVERLAY' }),
            color: 'gray',
            variant: 'subtle',
            icon: <Eraser size={iconSize} />,
          })}
        </Group>
        {statusBadge && (
          <Badge color={statusBadge.color} variant="light" size="sm">
            {statusBadge.label}
          </Badge>
        )}
      </Group>
    );
  };

  const permissionOverlay = !permissionGranted ? (
    <Box
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2.5rem 1.5rem',
        overflow: 'hidden',
      }}
    >
      <Box
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: overlayGradient,
          backgroundSize: '280% 280%',
          animation: 'apply-pilot-permission-gradient 24s ease infinite',
          backdropFilter: `blur(${colorScheme === 'dark' ? 16 : 20}px)`,
        }}
      />
      <Box style={{ position: 'relative', width: '100%', maxWidth: 460, zIndex: 1 }}>
        <Box style={permissionCardStyles}>
          <Stack gap="lg" align="center">
            <Title order={2} ta="center" style={{ color: permissionTitleColor }}>
              {t('sidepanel.permission.title')}
            </Title>
            <Text fz="sm" ta="center" style={{ color: permissionBodyColor }}>
              {t('sidepanel.permission.body')}
            </Text>
            <Paper
              radius="lg"
              withBorder={false}
              px="md"
              py="sm"
              style={{
                width: '100%',
                background: permissionNoteBackground,
                border: `1px solid ${permissionNoteBorder}`,
              }}
            >
              <Text fz="xs" ta="center" style={{ color: permissionNoteText }}>
                {t('sidepanel.permission.note')}
              </Text>
            </Paper>
            <Group gap="sm" justify="center" wrap="wrap">
              <Button
                size="md"
                radius="lg"
                color={theme.primaryColor}
                onClick={handlePermissionAccept}
                leftSection={<CheckCircle2 size={16} />}
              >
                {t('sidepanel.permission.allow')}
              </Button>
            </Group>
          </Stack>
        </Box>
      </Box>
    </Box>
  ) : null;

  return (
    <Box style={{ position: 'relative', height: '100vh' }}>
      <Stack gap={0} style={{ height: '100%' }}>
        <Stack gap={0} style={{ flex: 1, overflow: 'hidden' }}>
          <Paper px="md" py="sm" withBorder={false} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
            <Group gap="xs" wrap="nowrap" align="flex-end">
              <NativeSelect
                label={t('popup.title')}
                value={selectedProfileId ?? ''}
                onChange={(event) => setSelectedProfileId(event.currentTarget.value || null)}
                data={selectOptions}
                size="sm"
                style={{ flex: 1 }}
              />
              <Tooltip label={t('sidepanel.toolbar.manageProfiles')} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  radius="md"
                  onClick={openProfilesPage}
                  aria-label={t('sidepanel.toolbar.manageProfiles')}
                >
                  <Users size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
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
              <Tabs.Tab value="guided">{t('sidepanel.tabs.guided')}</Tabs.Tab>
              <Tabs.Tab value="manual">{t('sidepanel.tabs.manual')}</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel
              value="dom"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              <Stack gap={0} style={{ height: '100%', overflow: 'hidden' }}>
                <Paper
                  px="md"
                  py="sm"
                  withBorder
                  shadow="xs"
                  style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}
                >
                  {renderDomToolbar()}
                </Paper>
                <ScrollArea style={{ flex: 1 }} px="md" py="md">
                  <Stack gap="md">
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
            <Tabs.Panel value="guided" style={{ flex: 1, overflow: 'hidden' }}>
              {renderPanel(renderGuidedMode())}
            </Tabs.Panel>
            <Tabs.Panel value="manual" style={{ flex: 1, overflow: 'hidden' }}>
              {renderPanel(renderManualMode())}
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Stack>
      {permissionOverlay}
    </Box>
  );

  function renderDomMode() {
    if (viewState.loadingProfiles) {
      return renderStateAlert(t('sidepanel.states.loadingProfiles'), 'brand');
    }
    if (viewState.error) {
      return renderStateAlert(t('sidepanel.states.error', [viewState.error]), 'red');
    }
    if (!selectedProfile) {
      return renderStateAlert(t('sidepanel.states.noProfile'));
    }
    if (scanning) {
      return renderStateAlert(t('sidepanel.toolbar.scanning'), 'brand');
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

  function renderGuidedMode() {
    if (viewState.loadingProfiles) {
      return renderStateAlert(t('sidepanel.states.loadingProfiles'), 'brand');
    }
    if (viewState.error) {
      return renderStateAlert(t('sidepanel.states.error', [viewState.error]), 'red');
    }
    if (!selectedProfile) {
      return renderStateAlert(t('sidepanel.states.noProfile'));
    }
    if (scanning) {
      return renderStateAlert(t('sidepanel.toolbar.scanning'), 'brand');
    }
    if (fields.length === 0) {
      return renderStateAlert(t('sidepanel.states.noFields'));
    }

    const current = guidedStarted ? fields[guidedIndex] : null;
    const progressText = t('sidepanel.guided.progress', [
      String(guidedFilled),
      String(guidedTotal),
      String(guidedSkipped),
    ]);

    return (
      <Stack gap="sm">
        <Alert color="brand" variant="light" radius="lg">
          {t('sidepanel.guided.description')}
        </Alert>
        <Stack gap={4}>
          <Group gap="xs" wrap="wrap" align="center">
            {!guidedStarted ? (
              <Button size="sm" leftSection={<Play size={16} />} onClick={startGuided}>
                {t('sidepanel.guided.start')}
              </Button>
            ) : (
              <>
                <Badge variant="light" color="gray">
                  {t('sidepanel.guided.paused', [
                    current?.field.label || t('sidepanel.field.noLabel'),
                    String(guidedIndex + 1),
                    String(guidedTotal),
                  ])}
                </Badge>
                <Group gap="xs" wrap="wrap" align="center">
                  <Tooltip label={t('sidepanel.guided.back')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.back')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={navPrev}
                      disabled={isFirst}
                    >
                      <ArrowLeft size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.guided.next')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.next')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={navNext}
                      disabled={isLast}
                    >
                      <ArrowRight size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.guided.jumpToUnfilled')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.jumpToUnfilled')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={navToFirstUnfilled}
                    >
                      <ListChecks size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.guided.restart')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.guided.restart')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={restartGuided}
                    >
                      <RotateCcw size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('sidepanel.buttons.highlight')} withArrow>
                    <ActionIcon
                      aria-label={t('sidepanel.buttons.highlight')}
                      size="lg"
                      radius="md"
                      variant="light"
                      color="gray"
                      onClick={() => highlightCurrent(current)}
                      disabled={!current}
                    >
                      <Target size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Button
                    size="sm"
                    color="green"
                    leftSection={<CheckCircle2 size={16} />}
                    onClick={finishGuided}
                  >
                    {t('sidepanel.guided.done')}
                  </Button>
                </Group>
              </>
            )}
          </Group>
          <Text fz="xs" c="dimmed">{progressText}</Text>
        </Stack>

        <Stack gap="sm">
          {guidedStarted && current && renderGuidedControls(current)}
        </Stack>

        <Card withBorder radius="md" shadow="sm">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>{t('sidepanel.guided.memory.heading')}</Text>
              <Tooltip label={t('sidepanel.guided.memory.refresh')} withArrow>
                <ActionIcon
                  aria-label={t('sidepanel.guided.memory.refresh')}
                  size="lg"
                  radius="md"
                  variant="light"
                  color="gray"
                  onClick={refreshMemory}
                >
                  <RefreshCcw size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
            {memoryList.length === 0 ? (
              <Text fz="sm" c="dimmed">{t('sidepanel.guided.memory.empty')}</Text>
            ) : (
              <Stack gap={6}>
                {memoryList.map(({ key, association }) => (
                  <Group key={key} justify="space-between" align="center">
                    <Text fz="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                      {key} · {association.preferredSlot ?? ''} {association.lastValue ? `· ${truncate(association.lastValue, 60)}` : ''}
                    </Text>
                    <Tooltip label={t('sidepanel.guided.memory.delete')} withArrow>
                      <ActionIcon
                        aria-label={t('sidepanel.guided.memory.delete')}
                        size="md"
                        radius="md"
                        variant="subtle"
                        color="red"
                        onClick={() => removeMemory(key)}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ))}
                <Group justify="flex-end">
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    leftSection={<Trash2 size={14} />}
                    onClick={clearMemory}
                  >
                    {t('sidepanel.guided.memory.clearAll')}
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        </Card>
      </Stack>
    );
  }

  function renderGuidedControls(entry: FieldEntry) {
    const { fallbackOption, manualValue, value } = resolveEntryData(entry);
    const currentSlot = entry.selectedSlot ?? (fallbackOption ? (fallbackOption.slot as PromptOptionSlot | null) : null);
    const fillDisabled = entry.status === 'pending' || !value;
    const placeholderKey = fallbackOption
      ? 'sidepanel.guided.manualInputPlaceholderWithValue'
      : 'sidepanel.guided.manualInputPlaceholder';

    return (
      <Card withBorder radius="md" shadow="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Text fw={600} fz="sm">
                {entry.field.label || t('sidepanel.field.noLabel')}
                {entry.field.required ? ' *' : ''}
              </Text>
              <Text fz="xs" c="dimmed">
                {t('sidepanel.field.meta', [t(`sidepanel.fieldKind.${entry.field.kind}`), entry.slot ? formatSlotLabel(entry.slot) : t('sidepanel.field.unmapped'), String(entry.field.frameId)])}
              </Text>
            </Stack>
            {entry.status !== 'idle' && (
              <Badge color={entry.status === 'filled' ? 'green' : entry.status === 'failed' ? 'red' : 'gray'} variant="light" size="sm">
                {t(`sidepanel.status.${entry.status}`)}
              </Badge>
            )}
          </Group>

          <Select
            label={t('sidepanel.field.selectorLabel')}
            placeholder={t('sidepanel.field.selectPlaceholder')}
            data={manualOptions.map((option) => ({ value: option.slot, label: `${option.label} · ${truncate(option.value)}` }))}
            value={currentSlot}
            onChange={(slot) => handleSlotSelectionChange(entry.field.id, slot ? (slot as PromptOptionSlot) : null)}
            size="sm"
            clearable
            searchable={manualOptions.length > 7}
            comboboxProps={{ withinPortal: true }}
          />
          {entry.field.kind !== 'file' ? (
            <Textarea
              label={t('sidepanel.guided.manualInputLabel' as any)}
              placeholder={t(placeholderKey as any)}
              autosize
              minRows={2}
              maxRows={6}
              value={manualValue}
              onChange={(event) => handleManualValueChange(entry.field.id, event.currentTarget.value)}
              description={t('sidepanel.guided.manualInputHint' as any)}
            />
          ) : (
            <Text fz="xs" c="dimmed">
              {t('sidepanel.preview.file')}
            </Text>
          )}
          <Group gap="sm" justify="flex-end">
            <Button
              size="sm"
              variant="default"
              onClick={() => handleGuidedSkip(entry)}
              disabled={entry.status === 'pending'}
            >
              {t('sidepanel.guided.skip')}
            </Button>
            <Button
              size="sm"
              disabled={fillDisabled}
              onClick={() => handleGuidedAccept(entry, !isLast)}
            >
              {isLast ? t('sidepanel.guided.fill') : t('sidepanel.guided.accept')}
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  function startGuided() {
    setGuidedStarted(true);
    setGuidedIndex(0);
    setGuidedFilled(0);
    setGuidedSkipped(0);
    if (fields.length > 0) {
      setSelectedFieldId(fields[0].field.id);
      highlightCurrent(fields[0]);
    }
    refreshMemory().catch(console.error);
  }

  function highlightCurrent(entry: FieldEntry | null) {
    if (!entry) return;
    sendMessage({ kind: 'HIGHLIGHT_FIELD', fieldId: entry.field.id, frameId: entry.field.frameId, label: entry.field.label });
  }

  function navPrev() {
    if (!guidedStarted) return;
    const prevIndex = Math.max(0, guidedIndexRef.current - 1);
    if (prevIndex === guidedIndexRef.current) return;
    setGuidedIndex(prevIndex);
    const prev = fieldsRef.current[prevIndex];
    if (prev) {
      setSelectedFieldId(prev.field.id);
      highlightCurrent(prev);
    }
  }

  function navNext() {
    if (!guidedStarted) return;
    const nextIndex = guidedIndexRef.current + 1;
    if (nextIndex >= fieldsRef.current.length) return;
    setGuidedIndex(nextIndex);
    const next = fieldsRef.current[nextIndex];
    if (next) {
      setSelectedFieldId(next.field.id);
      highlightCurrent(next);
    }
  }

  function navToFirstUnfilled() {
    if (!guidedStarted) return;
    const idx = fieldsRef.current.findIndex((e) => e.status !== 'filled');
    if (idx === -1) {
      return;
    }
    setGuidedIndex(idx);
    const entry = fieldsRef.current[idx];
    if (entry) {
      setSelectedFieldId(entry.field.id);
      highlightCurrent(entry);
    }
  }

  function restartGuided() {
    setGuidedStarted(true);
    setGuidedIndex(0);
    setGuidedFilled(0);
    setGuidedSkipped(0);
    if (fieldsRef.current.length > 0) {
      const first = fieldsRef.current[0];
      setSelectedFieldId(first.field.id);
      highlightCurrent(first);
    }
  }

  function finishGuided() {
    setGuidedStarted(false);
    sendMessage({ kind: 'CLEAR_OVERLAY' });
  }

  async function handleGuidedAccept(entry: FieldEntry, advance = true) {
    const { value } = resolveEntryData(entry);
    if (!value) {
      notify(t('sidepanel.feedback.noValues'), 'info');
      return;
    }
    const requestId = crypto.randomUUID();
    setFieldStatus(entry.field.id, 'pending');
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
    const result = await waitForFillCompletion(requestId);
    if (result?.status === 'filled') {
      setGuidedFilled((n) => n + 1);
      const { learnAccept } = await import('../../shared/memory/store');
      await learnAccept(entry.field, { slot: entry.selectedSlot, value });
    }
    if (advance) {
      goToNext(entry);
    }
  }

  async function handleGuidedSkip(entry: FieldEntry) {
    setFieldStatus(entry.field.id, 'skipped');
    const { learnReject } = await import('../../shared/memory/store');
    await learnReject(entry.field);
    setGuidedSkipped((n) => n + 1);
    goToNext(entry);
  }

  function goToNext(current: FieldEntry) {
    const idx = fieldsRef.current.findIndex((e) => e.field.id === current.field.id);
    const nextIndex = idx + 1;
    if (nextIndex >= fieldsRef.current.length) {
      // At the end — do not advance further.
      return;
    }
    setGuidedIndex(nextIndex);
    const next = fieldsRef.current[nextIndex];
    if (next) {
      setSelectedFieldId(next.field.id);
      highlightCurrent(next);
    }
  }

  // Clamp guided index if fields change size while guided mode is active
  useEffect(() => {
    if (!guidedStarted) return;
    if (fields.length === 0) {
      setGuidedStarted(false);
      return;
    }
    const clamped = Math.min(guidedIndexRef.current, fields.length - 1);
    if (clamped !== guidedIndexRef.current) {
      setGuidedIndex(clamped);
      const entry = fields[clamped];
      if (entry) setSelectedFieldId(entry.field.id);
    }
  }, [fields.length, guidedStarted]);

  async function refreshMemory() {
    const { listAssociations } = await import('../../shared/memory/store');
    const items = await listAssociations();
    setMemoryList(items);
  }

  async function clearMemory() {
    const { clearAllMemory } = await import('../../shared/memory/store');
    await clearAllMemory();
    await refreshMemory();
  }

  async function removeMemory(key: string) {
    const { deleteAssociation } = await import('../../shared/memory/store');
    await deleteAssociation(key);
    await refreshMemory();
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
            ? 'brand'
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
          borderColor: isSelected ? 'var(--mantine-color-brand-5)' : undefined,
          backgroundColor: isSelected ? 'rgba(137, 100, 89, 0.08)' : undefined,
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
      return renderStateAlert(t('sidepanel.states.loadingProfiles'), 'brand');
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
          <ManualTreeView
            nodes={manualTree}
            tooltipLabel={t('sidepanel.manual.copyHint')}
            branchCopyLabel={t('sidepanel.manual.copyBranch')}
            valueCopyLabel={t('sidepanel.manual.copyValue')}
            searchPlaceholder={t('sidepanel.manual.searchPlaceholder' as any)}
            searchAriaLabel={t('sidepanel.manual.searchAria' as any)}
            previousMatchLabel={t('sidepanel.manual.searchPrevious' as any)}
            nextMatchLabel={t('sidepanel.manual.searchNext' as any)}
            onCopy={handleCopy}
          />
        )}
        <Card withBorder radius="md" shadow="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Text fw={600}>{t('sidepanel.manual.rawLabel')}</Text>
              <Tooltip label={t('sidepanel.buttons.copyAll')} withArrow>
                <ActionIcon
                  aria-label={t('sidepanel.buttons.copyAll')}
                  size="lg"
                  radius="md"
                  variant="light"
                  color="gray"
                  onClick={() => handleCopy(t('sidepanel.manual.rawLabel'), selectedProfile.rawText)}
                >
                  <Copy size={18} />
                </ActionIcon>
              </Tooltip>
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
      manualValue: suggestion ?? '',
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

function deriveManualValue(entry: FieldEntry, nextSuggestion?: string | null): string {
  const currentManual = entry.manualValue ?? '';
  const previousSuggestion = entry.suggestion ?? '';
  const trimmedManual = currentManual.trim();
  const trimmedPreviousSuggestion = previousSuggestion.trim();
  if (!trimmedManual || trimmedManual === trimmedPreviousSuggestion) {
    return nextSuggestion ?? '';
  }
  return currentManual;
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
  tooltipLabel: string;
  branchCopyLabel: string;
  valueCopyLabel: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  previousMatchLabel: string;
  nextMatchLabel: string;
  onCopy: (label: string, value: string) => void;
}

type ManualTreeNodeData = TreeNodeData & { manualNode: ManualValueNode };

function ManualTreeView({
  nodes,
  tooltipLabel,
  branchCopyLabel,
  valueCopyLabel,
  searchPlaceholder,
  searchAriaLabel,
  previousMatchLabel,
  nextMatchLabel,
  onCopy,
}: ManualTreeViewProps) {
  if (nodes.length === 0) {
    return null;
  }

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('light');
  const hoverBackground =
    colorScheme === 'dark'
      ? theme.colors.dark?.[6] ?? theme.colors.dark?.[5] ?? '#2c2e33'
      : theme.colors.gray?.[1] ?? theme.colors.gray?.[2] ?? '#f1f3f5';
  const treeData = useMemo<ManualTreeNodeData[]>(() => nodes.map(mapManualNodeToTreeNode), [nodes]);
  const expandedState = useMemo(() => getTreeExpandedState(treeData, '*'), [treeData]);
  const tree = useTree({ initialExpandedState: expandedState });
  const { setExpandedState, clearSelected, setHoveredNode } = tree;
  const [contextNodeId, setContextNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const flattenedNodes = useMemo(() => flattenManualNodes(nodes), [nodes]);
  const matches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [] as string[];
    }
    return flattenedNodes
      .filter((node) => {
        const labelMatch = node.label.toLowerCase().includes(query);
        const valueMatch =
          typeof node.value === 'string' && node.value.toLowerCase().includes(query);
        return labelMatch || valueMatch;
      })
      .map((node) => node.id);
  }, [flattenedNodes, searchQuery]);
  const matchesSet = useMemo(() => new Set(matches), [matches]);
  const matchesCount = matches.length;
  const hasMatches = matchesCount > 0;
  const activeMatchId = hasMatches
    ? matches[Math.min(activeMatchIndex, Math.max(matchesCount - 1, 0))]
    : null;
  const highlightColor =
    theme.colors.blue?.[colorScheme === 'dark' ? 3 : 6] ??
    (colorScheme === 'dark' ? '#4dabf7' : '#1c7ed6');
  const matchBackground =
    colorScheme === 'dark'
      ? theme.colors.blue?.[9] ?? '#1864ab'
      : theme.colors.blue?.[0] ?? '#e7f5ff';
  const activeMatchBackground =
    colorScheme === 'dark'
      ? theme.colors.blue?.[8] ?? '#1c7ed6'
      : theme.colors.blue?.[1] ?? '#d0ebff';
  const activeMatchBorderColor = highlightColor;
  const trimmedQuery = searchQuery.trim();
  const searchBarBackground =
    colorScheme === 'dark'
      ? theme.colors.dark?.[7] ?? theme.colors.dark?.[6] ?? '#1a1b1e'
      : theme.white ?? '#ffffff';
  const highlightText = useCallback(
    (text: string) => renderTextWithHighlight(text, trimmedQuery, highlightColor),
    [highlightColor, trimmedQuery],
  );

  useEffect(() => {
    setExpandedState(expandedState);
    clearSelected();
    setHoveredNode(null);
  }, [
    trimmedQuery,
    expandedState,
    setExpandedState,
    clearSelected,
    setHoveredNode,
  ]);

  useEffect(() => {
    setContextNodeId(null);
  }, [treeData]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [trimmedQuery]);

  useEffect(() => {
    setActiveMatchIndex((current) => {
      if (!hasMatches) {
        return 0;
      }
      return Math.min(current, matchesCount - 1);
    });
  }, [hasMatches, matchesCount]);

  useEffect(() => {
    if (!activeMatchId) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const selector =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? `[data-manual-node-id="${CSS.escape(activeMatchId)}"]`
        : `[data-manual-node-id="${activeMatchId.replace(/"/g, '\\"')}"]`;
    const element = document.querySelector(selector);
    element?.scrollIntoView({ block: 'center' });
  }, [activeMatchId]);

  const copyBranch = useCallback(
    (node: ManualValueNode) => {
      const text = buildManualBranchCopy(node);
      if (!text) {
        return;
      }
      onCopy(node.displayPath, text);
    },
    [onCopy],
  );

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.currentTarget.value);
  }, []);

  const handleNextMatch = useCallback(() => {
    if (!hasMatches) {
      return;
    }
    setActiveMatchIndex((current) => (current + 1) % matchesCount);
  }, [hasMatches, matchesCount]);

  const handlePreviousMatch = useCallback(() => {
    if (!hasMatches) {
      return;
    }
    setActiveMatchIndex((current) => (current - 1 + matchesCount) % matchesCount);
  }, [hasMatches, matchesCount]);

  const renderNode = useCallback(
    ({ node, elementProps, hasChildren, expanded }: RenderTreeNodePayload) => {
      const manualNode = (node as ManualTreeNodeData).manualNode;
      const isHovered = elementProps['data-hovered'] === true;
      const { className, style, onClick, ...rest } = elementProps;
      const isMatch = matchesSet.has(manualNode.id);
      const isActiveMatch = activeMatchId === manualNode.id;
      const backgroundColor = (() => {
        if (isActiveMatch) {
          return activeMatchBackground;
        }
        if (isMatch) {
          return matchBackground;
        }
        if (isHovered) {
          return hoverBackground;
        }
        return 'transparent';
      })();
      const borderColor = isActiveMatch ? activeMatchBorderColor : 'transparent';

      if (!hasChildren && typeof manualNode.value === 'string') {
        const value = manualNode.value;
        const { onContextMenu, ...restElementProps } = rest as typeof rest & {
          onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
        };
        const isMenuOpen = contextNodeId === manualNode.id;
        const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          onContextMenu?.(event);
          setContextNodeId(manualNode.id);
        };
        return (
          <Menu
            withinPortal
            opened={isMenuOpen}
            onClose={() => setContextNodeId((current) => (current === manualNode.id ? null : current))}
            closeOnItemClick
            closeOnEscape
          >
            <Menu.Target>
              <Tooltip label={tooltipLabel} position="right" withArrow openDelay={250}>
                <div
                  className={className}
                  style={{
                    ...style,
                    paddingBlock: '4px',
                    paddingInlineEnd: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '2px',
                    borderRadius: 'var(--mantine-radius-sm)',
                    border: '1px solid transparent',
                    backgroundColor,
                    borderColor,
                    transition: 'background-color 120ms ease, border-color 120ms ease',
                  }}
                  {...restElementProps}
                  data-manual-node-id={manualNode.id}
                  onClick={(event) => {
                    onCopy(manualNode.displayPath, value);
                    onClick?.(event);
                  }}
                  onContextMenu={handleContextMenu}
                >
                  <Text
                    fz="sm"
                    fw={500}
                    style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {highlightText(manualNode.label)}
                  </Text>
                  <Text
                    fz="xs"
                    c="dimmed"
                    style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {highlightText(value)}
                  </Text>
                </div>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<Copy size={14} aria-hidden />}
                onClick={() => {
                  onCopy(manualNode.displayPath, value);
                  setContextNodeId(null);
                }}
              >
                {valueCopyLabel}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        );
      }

      if (hasChildren) {
        const { onContextMenu, ...restElementProps } = rest as typeof rest & {
          onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
        };
        const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          onContextMenu?.(event);
          setContextNodeId(manualNode.id);
        };
        const nodeHasLeaves = manualNodeHasLeaf(manualNode);
        const isMenuOpen = contextNodeId === manualNode.id;
        return (
          <Menu
            withinPortal
            opened={isMenuOpen}
            onClose={() => setContextNodeId((current) => (current === manualNode.id ? null : current))}
            closeOnItemClick
            closeOnEscape
          >
            <Menu.Target>
              <div
                className={className}
                style={{
                  ...style,
                  paddingBlock: '4px',
                  paddingInlineEnd: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--mantine-spacing-xs)',
                  cursor: 'pointer',
                  borderRadius: 'var(--mantine-radius-sm)',
                  border: '1px solid transparent',
                  backgroundColor,
                  borderColor,
                  transition: 'background-color 120ms ease, border-color 120ms ease',
                }}
                onClick={onClick}
                onContextMenu={handleContextMenu}
                {...restElementProps}
                data-manual-node-id={manualNode.id}
              >
                <ChevronRight
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                  style={{
                    transition: 'transform 150ms ease',
                    transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    flexShrink: 0,
                  }}
                />
                <Text fw={600} fz="sm" style={{ margin: 0 }}>
                  {highlightText(manualNode.label)}
                </Text>
              </div>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<Copy size={14} aria-hidden />}
                onClick={() => {
                  copyBranch(manualNode);
                  setContextNodeId(null);
                }}
                disabled={!nodeHasLeaves}
              >
                {branchCopyLabel}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        );
      }

      return (
        <div
          className={className}
          style={{
            ...style,
            paddingBlock: '4px',
            paddingInlineEnd: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--mantine-spacing-xs)',
            cursor: 'pointer',
            borderRadius: 'var(--mantine-radius-sm)',
            border: '1px solid transparent',
            backgroundColor,
            borderColor,
            transition: 'background-color 120ms ease, border-color 120ms ease',
          }}
          onClick={onClick}
          {...rest}
          data-manual-node-id={manualNode.id}
        >
          <ChevronRight
            size={16}
            strokeWidth={2}
            aria-hidden
            style={{
              transition: 'transform 150ms ease',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              flexShrink: 0,
            }}
          />
          <Text fw={600} fz="sm" style={{ margin: 0 }}>
            {highlightText(manualNode.label)}
          </Text>
        </div>
      );
    },
    [
      activeMatchBackground,
      activeMatchBorderColor,
      activeMatchId,
      branchCopyLabel,
      contextNodeId,
      copyBranch,
      hoverBackground,
      matchBackground,
      matchesSet,
      highlightText,
      onCopy,
      tooltipLabel,
      valueCopyLabel,
    ],
  );

  return (
    <Stack gap={0} style={{ position: 'relative' }}>
      <Box
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          backgroundColor: searchBarBackground,
          paddingBottom: 'var(--mantine-spacing-xs)',
        }}
      >
        <TextInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          size="sm"
          leftSection={<Search size={16} strokeWidth={2} aria-hidden />}
          rightSection={
            <Group gap={4} wrap="nowrap">
              {hasMatches && (
                <Text size="xs" c="dimmed" fw={500}>
                  {`${Math.min(activeMatchIndex + 1, matchesCount)} / ${matchesCount}`}
                </Text>
              )}
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={previousMatchLabel}
                disabled={!hasMatches}
                onClick={handlePreviousMatch}
              >
                <ChevronUp size={16} strokeWidth={2} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={nextMatchLabel}
                disabled={!hasMatches}
                onClick={handleNextMatch}
              >
                <ChevronDown size={16} strokeWidth={2} />
              </ActionIcon>
            </Group>
          }
          rightSectionPointerEvents="auto"
          rightSectionWidth={hasMatches ? 144 : 112}
        />
      </Box>
      <Tree data={treeData} tree={tree} levelOffset="sm" renderNode={renderNode} />
    </Stack>
  );
}

function mapManualNodeToTreeNode(node: ManualValueNode): ManualTreeNodeData {
  return {
    value: node.id,
    label: node.label,
    manualNode: node,
    children: node.children?.map(mapManualNodeToTreeNode),
  };
}

function flattenManualNodes(nodes: ManualValueNode[]): ManualValueNode[] {
  const result: ManualValueNode[] = [];
  nodes.forEach((node) => {
    result.push(node);
    if (node.children && node.children.length > 0) {
      result.push(...flattenManualNodes(node.children));
    }
  });
  return result;
}

function renderTextWithHighlight(text: string, query: string, highlightColor: string): ReactNode {
  if (!query) {
    return text;
  }
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) {
    return text;
  }
  const normalizedText = text.toLowerCase();
  let searchIndex = 0;
  const segments: Array<{ value: string; match: boolean }> = [];
  let matchIndex = normalizedText.indexOf(normalizedQuery, searchIndex);

  while (matchIndex !== -1) {
    if (matchIndex > searchIndex) {
      segments.push({ value: text.slice(searchIndex, matchIndex), match: false });
    }
    segments.push({
      value: text.slice(matchIndex, matchIndex + query.length),
      match: true,
    });
    searchIndex = matchIndex + query.length;
    matchIndex = normalizedText.indexOf(normalizedQuery, searchIndex);
  }

  if (searchIndex < text.length) {
    segments.push({ value: text.slice(searchIndex), match: false });
  }

  return segments.map((segment, index) => {
    if (!segment.match) {
      return (
        <span key={`segment-${index}`} style={{ fontWeight: 'inherit', fontSize: 'inherit' }}>
          {segment.value}
        </span>
      );
    }
    return (
      <mark
        key={`segment-${index}`}
        style={{
          backgroundColor: 'transparent',
          color: highlightColor,
          fontWeight: 'inherit',
          fontSize: 'inherit',
        }}
      >
        {segment.value}
      </mark>
    );
  });
}

function manualNodeHasLeaf(node: ManualValueNode): boolean {
  if (typeof node.value === 'string' && node.value.trim().length > 0) {
    return true;
  }
  if (!node.children) {
    return false;
  }
  return node.children.some((child) => manualNodeHasLeaf(child));
}

function buildManualBranchCopy(node: ManualValueNode): string | null {
  const entries: Array<{ path: string; value: string }> = [];
  const visit = (current: ManualValueNode) => {
    if (typeof current.value === 'string' && current.value.trim().length > 0) {
      entries.push({ path: current.displayPath, value: current.value });
    }
    current.children?.forEach(visit);
  };
  visit(node);
  if (entries.length === 0) {
    return null;
  }
  return entries.map((entry) => entry.value).join('\n');
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
