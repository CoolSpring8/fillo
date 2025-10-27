import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  NativeSelect,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from '@mantine/core';
import { CheckCircle2, Eraser, RefreshCcw, Sparkles, Users, Wand2 } from 'lucide-react';
import { notifications } from '@mantine/notifications';
import { browser } from 'wxt/browser';
import { listProfiles } from '../../shared/storage/profiles';
import type { ProfileRecord, ProviderConfig } from '../../shared/types';
import type {
  FillResultMessage,
  PromptAiRequestInput,
  PromptOption,
  PromptOptionSlot,
  ScannedField,
} from '../../shared/apply/types';
import type { FieldSlot } from '../../shared/apply/slotTypes';
import { buildManualValueTree, flattenManualLeaves, type ManualValueNode } from './manualValues';
import {
  getAllAdapterIds,
  resolveSlotFromAutocomplete,
  resolveSlotFromLabel,
  resolveSlotFromText,
} from '../../shared/apply/slots';
import { buildSlotValues, type SlotValueMap } from '../../shared/apply/profile';
import { classifyFieldDescriptors, type FieldClassification, type FieldDescriptor } from './classifySlots';
import type { MemoryAssociation } from '../../shared/memory/types';
import { getSettings } from '../../shared/storage/settings';
// Auto mode removed; new guided mode uses side panel controls and shared memory
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../../shared/llm/errors';
import { requestGuidedSuggestion } from '../../shared/llm/guidedSuggestion';
import { PromptEditor } from '../shared/components/PromptEditor';
import { FieldReviewMode } from './components/FieldReviewMode';
import { GuidedMode } from './components/GuidedMode';
import { ManualCopyMode } from './components/ManualCopyMode';
import type { FieldEntry, FieldStatus, ViewState } from './types';

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

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

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
  const [guidedActiveId, setGuidedActiveId] = useState<string | null>(null);
  const [guidedFrameId, setGuidedFrameId] = useState<number>(0);
  const [guidedFilled, setGuidedFilled] = useState<number>(0);
  const [guidedSkipped, setGuidedSkipped] = useState<number>(0);
  const [guidedOrder, setGuidedOrder] = useState<string[]>([]);
  const [guidedPrompt, setGuidedPrompt] = useState('');
  const [memoryList, setMemoryList] = useState<Array<{ key: string; association: any }>>([]);
  const { t } = i18n;
  const tLoose = i18n.t as unknown as (key: string, params?: unknown[]) => string;
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
  const fillResolversRef = useRef<Map<string, (result: FillResultMessage) => void>>(new Map());
  const fieldsRef = useRef<FieldEntry[]>([]);
  const providerRef = useRef<ProviderConfig | null>(null);
  const selectedFieldRef = useRef<string | null>(null);
  const lastFocusedFieldRef = useRef<string | null>(null);
  const guidedEnhancedRef = useRef<Set<string>>(new Set());
  const guidedFrameIdRef = useRef<number>(0);
  const guidedProviderWarningRef = useRef(false);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const selectedProfileIdValue = selectedProfile?.id ?? null;

  const slotValues = useMemo(() => buildSlotValues(selectedProfile), [selectedProfile]);

  useEffect(() => {
    slotValuesRef.current = slotValues;
  }, [slotValues]);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    guidedFrameIdRef.current = guidedFrameId;
  }, [guidedFrameId]);

  useEffect(() => {
    if (fields.length === 0) {
      setSelectedFieldId(null);
      return;
    }
    if (mode === 'guided' && guidedActiveId) {
      setSelectedFieldId(guidedActiveId);
      return;
    }
    if (!selectedFieldRef.current || !fields.some((entry) => entry.field.id === selectedFieldRef.current)) {
      setSelectedFieldId(fields[0].field.id);
    }
  }, [fields, mode, guidedActiveId]);

  useEffect(() => {
    selectedFieldRef.current = selectedFieldId;
  }, [selectedFieldId]);

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
        if (cancelled) return;
        providerRef.current = settings.provider;
        guidedProviderWarningRef.current = false;
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

      if (message.kind === 'GUIDED_CANDIDATE') {
        const parsed = parseGuidedCandidateMessage(message);
        if (!parsed) return;
        handleGuidedCandidate(parsed.field, parsed.origin, parsed.frameId);
        return;
      }

      if (message.kind === 'GUIDED_INPUT_CAPTURE') {
        const parsed = parseGuidedInputCaptureMessage(message);
        if (!parsed) return;
        handleGuidedInputCapture(parsed.field, parsed.value, parsed.frameId);
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
        fieldKind: target.field.kind,
        fieldContext: target.field.context,
        fieldAutocomplete: target.field.autocomplete ?? null,
        fieldRequired: target.field.required,
        profileId: selectedProfile?.id ?? null,
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
  }, [fields, notify, selectedProfile, sendMessage, t]);

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
      fieldKind: entry.field.kind,
      fieldContext: entry.field.context,
      fieldAutocomplete: entry.field.autocomplete ?? null,
      fieldRequired: entry.field.required,
      profileId: selectedProfile?.id ?? null,
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
      fieldKind: entry.field.kind,
      fieldContext: entry.field.context,
      fieldAutocomplete: entry.field.autocomplete ?? null,
      fieldRequired: entry.field.required,
      profileId: selectedProfile?.id ?? null,
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

  const guidedActiveEntry = useMemo(
    () => (guidedActiveId ? fields.find((entry) => entry.field.id === guidedActiveId) ?? null : null),
    [fields, guidedActiveId],
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

  const showPromptOverlay = useCallback(
    (entry: FieldEntry | null) => {
      if (!entry) {
        sendMessage({ kind: 'CLEAR_OVERLAY' });
        return;
      }

      sendMessage({
        kind: 'HIGHLIGHT_FIELD',
        fieldId: entry.field.id,
        frameId: entry.field.frameId,
        label: entry.field.label,
      });

      if (entry.field.kind === 'file') {
        return;
      }

      const { fallbackOption, manualValue, value } = resolveEntryData(entry);
      const defaultSlot = entry.selectedSlot ?? entry.slot ?? (fallbackOption ? (fallbackOption.slot as PromptOptionSlot | null) : null);
      const defaultValue = manualValue.trim().length > 0 ? manualValue : fallbackOption?.value ?? entry.suggestion ?? '';
      const preview = fallbackOption?.value ?? entry.suggestion ?? value;

      sendMessage({
        kind: 'PROMPT_PREVIEW',
        previewId: `preview:${entry.field.id}`,
        fieldId: entry.field.id,
        frameId: entry.field.frameId,
        label: entry.field.label,
        preview,
        value: defaultValue,
        defaultSlot,
        options: manualOptions,
        profileId: selectedProfileIdValue,
        field: {
          id: entry.field.id,
          label: entry.field.label,
          kind: entry.field.kind,
          context: entry.field.context,
          autocomplete: entry.field.autocomplete ?? null,
          required: entry.field.required,
        },
      });
    },
    [manualOptions, resolveEntryData, selectedProfileIdValue, sendMessage],
  );

  const focusField = useCallback(
    (entry: FieldEntry | null) => {
      if (!entry) {
        showPromptOverlay(null);
        return;
      }
      sendMessage({
        kind: 'FOCUS_FIELD',
        fieldId: entry.field.id,
        frameId: entry.field.frameId,
      });
      showPromptOverlay(entry);
    },
    [sendMessage, showPromptOverlay],
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
  const guidedSeenCount = guidedOrder.length;
  const guidedCanGoBack = guidedStarted && guidedActiveId ? guidedOrder.indexOf(guidedActiveId) > 0 : guidedSeenCount > 1;
  const hasGuidedCandidate = Boolean(guidedActiveEntry);

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
              <FieldReviewMode
                viewState={viewState}
                selectedProfile={selectedProfile}
                scanning={scanning}
                fields={fields}
                selectedFieldId={selectedFieldId}
                toolbar={renderDomToolbar()}
                footer={renderSelectionFooter()}
                renderFieldCard={(entry, options) => renderFieldCard(entry, options)}
                t={t}
              />
            </Tabs.Panel>
            <Tabs.Panel value="guided" style={{ flex: 1, overflow: 'hidden' }}>
              <GuidedMode
                viewState={viewState}
                selectedProfile={selectedProfile}
                scanning={scanning}
                guidedStarted={guidedStarted}
                guidedActive={guidedActiveEntry}
                guidedFilled={guidedFilled}
                guidedSkipped={guidedSkipped}
                seenCount={guidedSeenCount}
                canGoBack={guidedCanGoBack}
                hasCandidate={hasGuidedCandidate}
                memoryList={memoryList}
                onStart={startGuided}
                onBack={navPrev}
                onNext={navNext}
                onJumpToUnfilled={navToFirstUnfilled}
                onRestart={restartGuided}
                onHighlight={highlightCurrent}
                onFinish={finishGuided}
                onRefreshMemory={refreshMemory}
                onClearMemory={clearMemory}
                onRemoveMemory={removeMemory}
                renderGuidedControls={renderGuidedControls}
                truncate={truncate}
                t={t}
              />
            </Tabs.Panel>
            <Tabs.Panel value="manual" style={{ flex: 1, overflow: 'hidden' }}>
              <ManualCopyMode
                viewState={viewState}
                selectedProfile={selectedProfile}
                manualTree={manualTree}
                onCopy={handleCopy}
                t={t}
              />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Stack>
      {permissionOverlay}
    </Box>
  );

  function renderGuidedControls(entry: FieldEntry) {
    const { fallbackOption, manualValue, value } = resolveEntryData(entry);
    const currentSlot = entry.selectedSlot ?? (fallbackOption ? (fallbackOption.slot as PromptOptionSlot | null) : null);
    const fillDisabled = entry.status === 'pending' || !value;
    const placeholderKey = fallbackOption
      ? 'sidepanel.guided.manualInputPlaceholderWithValue'
      : 'sidepanel.guided.manualInputPlaceholder';
    const acceptLabel = tLoose('sidepanel.guided.acceptNext');
    const defaultSlot = fallbackOption ? (fallbackOption.slot as PromptOptionSlot | null) : undefined;

    const requestAi = async (input: PromptAiRequestInput) => {
      const provider = providerRef.current;
      if (!provider) {
        throw new NoProviderConfiguredError();
      }
      return await requestGuidedSuggestion({
        provider,
        instruction: input.instruction,
        field: {
          label: entry.field.label,
          kind: entry.field.kind,
          context: entry.field.context,
          autocomplete: entry.field.autocomplete ?? null,
          required: entry.field.required,
        },
        slot: input.selectedSlot ?? currentSlot ?? entry.slot ?? null,
        currentValue: input.currentValue ?? manualValue ?? '',
        suggestion: input.suggestion ?? entry.suggestion ?? '',
        profile: selectedProfile?.resume ?? null,
      });
    };

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
                {t('sidepanel.field.meta', [
                  t(`sidepanel.fieldKind.${entry.field.kind}`),
                  entry.slot ? formatSlotLabel(entry.slot) : t('sidepanel.field.unmapped'),
                  String(entry.field.frameId),
                ])}
              </Text>
            </Stack>
            {entry.status !== 'idle' && (
              <Badge color={entry.status === 'filled' ? 'green' : entry.status === 'failed' ? 'red' : 'gray'} variant="light" size="sm">
                {t(`sidepanel.status.${entry.status}`)}
              </Badge>
            )}
          </Group>

          <PromptEditor
            options={manualOptions}
            defaultSlot={defaultSlot}
            defaultValue={fallbackOption?.value}
            preview={entry.suggestion ?? undefined}
            value={manualValue ?? ''}
            selectedSlot={currentSlot ?? null}
            onValueChange={(next) => handleManualValueChange(entry.field.id, next)}
            onSlotChange={(slot) => handleSlotSelectionChange(entry.field.id, slot)}
            instruction={guidedPrompt}
            onInstructionChange={setGuidedPrompt}
            onRequestAi={requestAi}
          >
            {(editor) => {
              const handleAiClick = async () => {
                try {
                  const result = await editor.requestAi();
                  if (!result) {
                    const message = tLoose('sidepanel.guided.aiPromptError');
                    notify(message, 'error');
                    editor.setAiError(message);
                    return;
                  }
                  const normalized = result.value?.trim?.() ?? '';
                  if (!normalized) {
                    const message = tLoose('sidepanel.guided.aiPromptEmpty');
                    notify(message, 'error');
                    editor.setAiError(message);
                    return;
                  }
                  editor.setValue(normalized);
                  if (Object.prototype.hasOwnProperty.call(result, 'slot')) {
                    editor.setSelectedSlot(result.slot ?? null);
                  }
                  editor.setAiError(null);
                  notify(tLoose('sidepanel.guided.aiPromptApplied'), 'success');
                } catch (error) {
                  if (
                    error instanceof NoProviderConfiguredError ||
                    error instanceof ProviderConfigurationError ||
                    error instanceof ProviderAvailabilityError ||
                    error instanceof ProviderInvocationError
                  ) {
                    notify(error.message, 'error');
                    editor.setAiError(error.message);
                  } else if (error instanceof Error) {
                    const message =
                      error.message === 'AI returned an empty response.' || error.message === 'instruction-missing'
                        ? tLoose('sidepanel.guided.aiPromptEmpty')
                        : tLoose('sidepanel.guided.aiPromptError');
                    notify(message, 'error');
                    editor.setAiError(message);
                  } else {
                    const message = tLoose('sidepanel.guided.aiPromptError');
                    notify(message, 'error');
                    editor.setAiError(message);
                  }
                } finally {
                  setGuidedPrompt('');
                  editor.setInstruction('');
                }
              };

              return (
                <>
                  <Select
                    label={t('sidepanel.field.selectorLabel')}
                    placeholder={t('sidepanel.field.selectPlaceholder')}
                    data={editor.options.map((option) => ({
                      value: option.slot,
                      label: `${option.label} · ${truncate(option.value)}`,
                    }))}
                    value={editor.selectedSlot ?? null}
                    onChange={(slot) => editor.setSelectedSlot(slot ? (slot as PromptOptionSlot) : null)}
                    size="sm"
                    clearable
                    searchable={editor.options.length > 7}
                    comboboxProps={{ withinPortal: true }}
                  />
                  {entry.field.kind !== 'file' ? (
                    <Stack gap="sm">
                      <Textarea
                        label={t('sidepanel.guided.manualInputLabel')}
                        placeholder={t(placeholderKey)}
                        autosize
                        minRows={2}
                        maxRows={6}
                        value={editor.value}
                        onChange={(event) => editor.setValue(event.currentTarget.value)}
                        description={t('sidepanel.guided.manualInputHint')}
                      />
                      <Textarea
                        label={tLoose('sidepanel.guided.aiPromptLabel')}
                        placeholder={tLoose('sidepanel.guided.aiPromptPlaceholder')}
                        autosize
                        minRows={1}
                        maxRows={3}
                        value={editor.instruction}
                        onChange={(event) => editor.setInstruction(event.currentTarget.value)}
                        description={tLoose('sidepanel.guided.aiPromptHint')}
                      />
                      {editor.aiError ? (
                        <Text fz="xs" c="red">
                          {editor.aiError}
                        </Text>
                      ) : null}
                      <Group justify="flex-end">
                        <Button
                          size="sm"
                          variant="light"
                          leftSection={<Sparkles size={16} />}
                          loading={editor.aiLoading}
                          disabled={editor.aiLoading || editor.instruction.trim().length === 0}
                          onClick={handleAiClick}
                        >
                          {tLoose('sidepanel.guided.aiPromptAction')}
                        </Button>
                      </Group>
                    </Stack>
                  ) : (
                    <Text fz="xs" c="dimmed">
                      {t('sidepanel.preview.file')}
                    </Text>
                  )}
                </>
              );
            }}
          </PromptEditor>
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
              loading={entry.status === 'pending'}
              onClick={() => handleGuidedAccept(entry)}
            >
              {acceptLabel}
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  function startGuided() {
    setGuidedStarted(true);
    setGuidedFilled(0);
    setGuidedSkipped(0);
    setGuidedPrompt('');
    setGuidedOrder(guidedActiveId ? [guidedActiveId] : []);
    guidedEnhancedRef.current.clear();
    const frameId = guidedFrameIdRef.current;
    sendMessage({ kind: 'GUIDED_RESET' });
    sendMessage({ kind: 'GUIDED_REQUEST_CURRENT', frameId });
    if (!guidedActiveId) {
      sendGuidedStep(1);
    }
    refreshMemory().catch(console.error);
  }

  function highlightCurrent(entry: FieldEntry | null) {
    showPromptOverlay(entry);
  }

  function sendGuidedStep(direction: 1 | -1) {
    const frameId = guidedFrameIdRef.current;
    sendMessage({ kind: 'GUIDED_STEP', direction, frameId });
  }

  function navPrev() {
    if (!guidedStarted) return;
    sendGuidedStep(-1);
  }

  function navNext() {
    if (!guidedStarted) return;
    sendGuidedStep(1);
  }

  function navToFirstUnfilled() {
    const targetId = guidedOrder.find((id) => {
      const entry = fieldsRef.current.find((item) => item.field.id === id);
      return entry && entry.status !== 'filled';
    });
    if (!targetId) {
      return;
    }
    const entry = fieldsRef.current.find((item) => item.field.id === targetId);
    if (entry) {
      setGuidedActiveId(entry.field.id);
      setSelectedFieldId(entry.field.id);
      setGuidedFrameId(entry.field.frameId);
      setGuidedOrder((current) => (current.includes(entry.field.id) ? current : [...current, entry.field.id]));
      sendMessage({ kind: 'FOCUS_FIELD', fieldId: entry.field.id, frameId: entry.field.frameId });
      highlightCurrent(entry);
    }
  }

  function restartGuided() {
    const frameId = guidedFrameIdRef.current;
    setGuidedStarted(true);
    setGuidedFilled(0);
    setGuidedSkipped(0);
    setGuidedPrompt('');
    setGuidedOrder([]);
    setGuidedActiveId(null);
    guidedEnhancedRef.current.clear();
    setFields((current) =>
      current.map((entry) => ({
        ...entry,
        status: entry.field.kind === 'file' ? entry.status : 'idle',
        reason: undefined,
      })),
    );
    sendMessage({ kind: 'GUIDED_RESET' });
    sendMessage({ kind: 'GUIDED_REQUEST_CURRENT', frameId });
    sendGuidedStep(1);
    refreshMemory().catch(console.error);
  }

  function finishGuided() {
    setGuidedStarted(false);
    setGuidedPrompt('');
    setGuidedActiveId(null);
    setGuidedOrder([]);
    setGuidedFilled(0);
    setGuidedSkipped(0);
    guidedEnhancedRef.current.clear();
    sendMessage({ kind: 'GUIDED_RESET' });
    sendMessage({ kind: 'CLEAR_OVERLAY' });
  }

  async function handleGuidedAccept(entry: FieldEntry) {
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
      fieldKind: entry.field.kind,
      fieldContext: entry.field.context,
      fieldAutocomplete: entry.field.autocomplete ?? null,
      fieldRequired: entry.field.required,
      profileId: selectedProfile?.id ?? null,
    });
    const result = await waitForFillCompletion(requestId);
    if (result?.status === 'filled') {
      setGuidedFilled((n) => n + 1);
      const { learnAccept } = await import('../../shared/memory/store');
      await learnAccept(entry.field, { slot: entry.selectedSlot, value });
    }
    setGuidedPrompt('');
    sendGuidedStep(1);
  }

  async function handleGuidedSkip(entry: FieldEntry) {
    setFieldStatus(entry.field.id, 'skipped');
    const { learnReject } = await import('../../shared/memory/store');
    await learnReject(entry.field);
    setGuidedSkipped((n) => n + 1);
    setGuidedPrompt('');
    sendGuidedStep(1);
  }

  function handleGuidedCandidate(field: ScannedField, origin: 'focus' | 'step' | 'request', frameId: number) {
    const entry = ensureGuidedEntry(field);
    setGuidedFrameId(frameId);
    setGuidedActiveId(field.id);
    setSelectedFieldId(field.id);
    setGuidedPrompt('');
    setGuidedOrder((current) => (current.includes(field.id) ? current : [...current, field.id]));
    highlightCurrent(entry);
    scheduleGuidedEnhancement(field);
  }

  async function handleGuidedInputCapture(field: ScannedField, value: string, frameId: number) {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    const entry = ensureGuidedEntry(field);
    const wasFilled = entry.status === 'filled';
    setGuidedFrameId(frameId);
    setGuidedActiveId(field.id);
    setSelectedFieldId(field.id);
    setGuidedOrder((current) => (current.includes(field.id) ? current : [...current, field.id]));
    setGuidedPrompt('');
    handleManualValueChange(field.id, normalized);
    setFieldStatus(field.id, 'filled');
    if (!wasFilled) {
      setGuidedFilled((count) => count + 1);
    }
    try {
      const { learnAccept } = await import('../../shared/memory/store');
      await learnAccept(field, { slot: entry.selectedSlot ?? entry.slot, value: normalized });
    } catch (error) {
      console.warn('Failed to learn from user input capture', error);
    }
  }

  function ensureGuidedEntry(field: ScannedField): FieldEntry {
    const existing = fieldsRef.current.find((entry) => entry.field.id === field.id);
    if (existing) {
      setFields((current) =>
        current.map((entry) => (entry.field.id === field.id ? { ...entry, field } : entry)),
      );
      return { ...existing, field };
    }
    const [created] = buildFieldEntries([field], slotValuesRef.current, adapterIdsRef.current);
    setFields((current) => [...current, created]);
    return created;
  }

  function scheduleGuidedEnhancement(field: ScannedField): void {
    if (guidedEnhancedRef.current.has(field.id)) {
      return;
    }
    guidedEnhancedRef.current.add(field.id);
    void enhanceGuidedField(field);
  }

  async function enhanceGuidedField(field: ScannedField): Promise<void> {
    try {
      const { getAssociationFor } = await import('../../shared/memory/store');
      const association = await getAssociationFor(field);
      if (association) {
        applyGuidedAssociation(field, association);
      }
    } catch (error) {
      console.warn('Failed to load association for guided field', error);
    }

    const provider = providerRef.current;
    if (!provider) {
      return;
    }

    try {
      const descriptors: FieldDescriptor[] = [
        {
          id: field.id,
          label: field.label,
          type: field.kind,
          autocomplete: field.autocomplete ?? null,
          required: field.required,
        },
      ];
      const map = await classifyFieldDescriptors(provider, descriptors);
      guidedProviderWarningRef.current = false;
      const match = map.get(field.id);
      if (match?.slot) {
        applyGuidedClassification(field, match);
      }
    } catch (error) {
      if (
        error instanceof NoProviderConfiguredError ||
        error instanceof ProviderConfigurationError ||
        error instanceof ProviderAvailabilityError ||
        error instanceof ProviderInvocationError
      ) {
        if (!guidedProviderWarningRef.current) {
          notify(error.message, 'error');
          guidedProviderWarningRef.current = true;
        }
        return;
      }
      console.warn('Guided classification failed', error);
    }
  }

  function applyGuidedAssociation(field: ScannedField, association: MemoryAssociation): void {
    setFields((current) =>
      current.map((entry) => {
        if (entry.field.id !== field.id) {
          return entry;
        }
        const next = { ...entry, field };
        let selectedSlot = entry.selectedSlot;
        let suggestion = entry.suggestion;
        if (association.preferredSlot && isFieldSlotValue(association.preferredSlot)) {
          const preferred = slotValuesRef.current[association.preferredSlot];
          if (preferred && preferred.trim().length > 0) {
            selectedSlot = association.preferredSlot;
            suggestion = preferred;
          }
        }
        if (!suggestion && association.lastValue && association.lastValue.trim().length > 0) {
          suggestion = association.lastValue.trim();
        }
        if (suggestion) {
          const manualValue = deriveManualValue(entry, suggestion);
          return {
            ...next,
            selectedSlot,
            suggestion,
            manualValue,
          };
        }
        return {
          ...next,
          selectedSlot,
        };
      }),
    );
  }

  function applyGuidedClassification(field: ScannedField, classification: FieldClassification): void {
    setFields((current) =>
      current.map((entry) => {
        if (entry.field.id !== field.id) {
          return entry;
        }
        const next = { ...entry, field, slotNote: classification.reason };
        if (classification.slot) {
          next.slot = classification.slot;
          next.slotSource = 'model';
          const suggestion = slotValuesRef.current[classification.slot];
          if (suggestion && suggestion.trim().length > 0) {
            next.selectedSlot = classification.slot;
            next.suggestion = suggestion;
            next.manualValue = deriveManualValue(entry, suggestion);
          }
        }
        return next;
      }),
    );
  }

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

    const { fallbackOption, manualValue, value } = resolveEntryData(selectedEntry);
    const currentSlot =
      selectedEntry.selectedSlot ??
      (fallbackOption ? (fallbackOption.slot as PromptOptionSlot | null) : null);
    const fillDisabled = selectedEntry.status === 'pending' || !value;
    const placeholderKey = fallbackOption
      ? 'sidepanel.guided.manualInputPlaceholderWithValue'
      : 'sidepanel.guided.manualInputPlaceholder';

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
        <Textarea
          label={t('sidepanel.guided.manualInputLabel')}
          placeholder={t(placeholderKey)}
          autosize
          minRows={2}
          maxRows={6}
          value={manualValue}
          onChange={(event) => handleManualValueChange(selectedEntry.field.id, event.currentTarget.value)}
          description={t('sidepanel.guided.manualInputHint')}
        />
        <Group justify="flex-end">
          <Button size="sm" disabled={fillDisabled} onClick={() => handleReview(selectedEntry)}>
            {t('sidepanel.buttons.fillField')}
          </Button>
        </Group>
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

function isScannedField(value: unknown): value is ScannedField {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.kind === 'string' && typeof record.label === 'string';
}

function parseGuidedCandidateMessage(
  value: Record<string, unknown>,
): { field: ScannedField; origin: 'focus' | 'step' | 'request'; frameId: number } | null {
  if (!isScannedField(value.field) || typeof value.frameId !== 'number') {
    return null;
  }
  const origin = value.origin === 'step' ? 'step' : value.origin === 'request' ? 'request' : 'focus';
  return {
    field: value.field,
    origin,
    frameId: value.frameId,
  };
}

function parseGuidedInputCaptureMessage(
  value: Record<string, unknown>,
): { field: ScannedField; value: string; frameId: number } | null {
  if (!isScannedField(value.field) || typeof value.value !== 'string' || typeof value.frameId !== 'number') {
    return null;
  }
  return {
    field: value.field,
    value: value.value,
    frameId: value.frameId,
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
