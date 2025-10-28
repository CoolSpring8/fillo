import { browser } from 'wxt/browser';
import type {
  FieldAttributes,
  FieldKind,
  FillResultMessage,
  PromptAiSuggestMessage,
  PromptAiSuggestResponse,
  PromptFieldState,
  PromptFillRequest,
  PromptOption,
  PromptOptionSlot,
  PromptPreviewRequest,
  ScannedField,
} from '../shared/apply/types';
import { buildProfilePromptOptions } from '../shared/apply/promptOptions';
import { resolveFieldSlot } from '../shared/apply/fieldMapping';
import { getAllAdapterIds } from '../shared/apply/slots';
import { formatSlotLabel } from '../shared/apply/slotLabels';
import { requestGuidedSuggestion } from '../shared/llm/guidedSuggestion';
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../shared/llm/errors';
import { getSettings } from '../shared/storage/settings';
import { getProfile } from '../shared/storage/profiles';

type BrowserApi = typeof browser;
type RuntimePort = ReturnType<BrowserApi['runtime']['connect']>;

interface PendingScan {
  tabId: number;
  port: RuntimePort;
  expected: number;
  received: number;
  fields: ScannedField[];
  completedFrames: Set<number>;
}

interface PendingFill {
  tabId: number;
  port: RuntimePort;
  fieldId: string;
  frameId: number;
}

interface FieldsResponse {
  kind: 'FIELDS';
  requestId: string;
  fields: ScannedField[];
}

interface FillResultResponse extends FillResultMessage {
  kind: 'FILL_RESULT';
}

const contentPorts = new Map<number, Map<number, RuntimePort>>();
const sidePanelPorts = new Set<RuntimePort>();
const pendingScans = new Map<string, PendingScan>();
const pendingFills = new Map<string, PendingFill>();
const popupOverlayTabs = new Set<number>();
const overlayAdapterIds = getAllAdapterIds();
const ACTIVE_PROFILE_STORAGE_KEY = 'popupActiveProfileId';
let activeProfileId: string | null = null;

async function openSidePanelForTab(tabId: number): Promise<void> {
  try {
    void browser.sidePanel
      .setOptions({ tabId, path: 'sidepanel.html', enabled: true })
      .catch((error: unknown) => {
        console.warn('Unable to configure side panel for tab.', error);
      });
    await browser.sidePanel.open({ tabId });
  } catch (error) {
    console.warn('Unable to open side panel for tab.', error);
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      browser.tabs
        .create({ url: browser.runtime.getURL('/options.html') })
        .catch((error: unknown) => {
          console.warn('Unable to open options page.', error);
        });
    }
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) {
      return;
    }
    await openSidePanelForTab(tab.id);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'content') {
      registerContentPort(port);
      return;
    }
    if (port.name === 'sidepanel') {
      registerSidePanelPort(port);
    }
  });

  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: 'resume-helper-fill',
      title: i18n.t('contextMenu.fill'),
      contexts: ['editable'],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'resume-helper-fill' || !tab?.id) {
      return;
    }

    await openSidePanelForTab(tab.id);
  });

  browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const message = raw as Record<string, unknown>;
    if (message.kind === 'POPUP_PROMPT_OVERLAY_GET') {
      const tabId = typeof message.tabId === 'number' ? message.tabId : null;
      const enabled = tabId !== null && popupOverlayTabs.has(tabId);
      sendResponse({ status: 'ok', enabled, profileId: activeProfileId });
      return false;
    }
    if (message.kind === 'POPUP_PROMPT_OVERLAY_SET') {
      const tabId = typeof message.tabId === 'number' ? message.tabId : null;
      const enabled = Boolean(message.enabled);
      if (tabId === null) {
        sendResponse({ status: 'error', error: 'missing-tab' });
        return false;
      }
      if (enabled) {
        popupOverlayTabs.add(tabId);
      } else {
        popupOverlayTabs.delete(tabId);
        clearOverlayForTab(tabId);
      }
      sendResponse({ status: 'ok', enabled: popupOverlayTabs.has(tabId), profileId: activeProfileId });
      return false;
    }
    if (message.kind === 'POPUP_ACTIVE_PROFILE_GET') {
      sendResponse({ status: 'ok', profileId: activeProfileId });
      return false;
    }
    if (message.kind === 'POPUP_ACTIVE_PROFILE_SET') {
      const raw = typeof message.profileId === 'string' ? message.profileId.trim() : '';
      const next = raw.length > 0 ? raw : null;
      setActiveProfilePreference(next)
        .then(() => {
          sendResponse({ status: 'ok', profileId: activeProfileId });
        })
        .catch((error) => {
          const reason = error instanceof Error ? error.message : String(error ?? 'active-profile-error');
          sendResponse({ status: 'error', error: reason });
        });
      return true;
    }
    if (message.kind === 'PROMPT_AI_SUGGEST') {
      handlePromptAiSuggestMessage(message)
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          const fallback = error instanceof Error ? error.message : String(error ?? 'Unknown AI error');
          sendResponse({ status: 'error', error: fallback } satisfies PromptAiSuggestResponse);
        });
      return true;
    }
    return undefined;
  });

  void loadActiveProfilePreference();

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(changes, ACTIVE_PROFILE_STORAGE_KEY)) {
      const change = changes[ACTIVE_PROFILE_STORAGE_KEY];
      const nextRaw = change?.newValue;
      const next = typeof nextRaw === 'string' && nextRaw.trim().length > 0 ? nextRaw : null;
      if (next === activeProfileId) {
        return;
      }
      activeProfileId = next;
      for (const tabId of popupOverlayTabs) {
        clearOverlayForTab(tabId);
      }
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    if (popupOverlayTabs.delete(tabId)) {
      clearOverlayForTab(tabId);
    }
  });
});

function registerContentPort(port: RuntimePort): void {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) {
    port.disconnect();
    return;
  }
  const frameId = port.sender?.frameId ?? 0;

  let frames = contentPorts.get(tabId);
  if (!frames) {
    frames = new Map();
    contentPorts.set(tabId, frames);
  }
  frames.set(frameId, port);

  port.onMessage.addListener((message: unknown) => handleContentMessage(tabId, frameId, message));
  port.onDisconnect.addListener(() => {
    frames?.delete(frameId);
    if (frames && frames.size === 0) {
      contentPorts.delete(tabId);
    }
    markFrameComplete(tabId, frameId);

    for (const [requestId, pending] of pendingFills.entries()) {
      if (pending.tabId === tabId && pending.frameId === frameId) {
        sendFillResult(pending.port, {
          requestId,
          fieldId: pending.fieldId,
          status: 'failed',
          reason: 'frame-unavailable',
          frameId,
        });
        pendingFills.delete(requestId);
      }
    }
  });
}

function registerSidePanelPort(port: RuntimePort): void {
  sidePanelPorts.add(port);
  const handleMessage = (message: unknown) => {
    void handleSidePanelMessage(port, message);
  };

  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => {
    port.onMessage.removeListener(handleMessage);
    sidePanelPorts.delete(port);
    for (const [requestId, pending] of pendingScans.entries()) {
      if (pending.port === port) {
        pendingScans.delete(requestId);
      }
    }
    for (const [requestId, pending] of pendingFills.entries()) {
      if (pending.port === port) {
        pendingFills.delete(requestId);
      }
    }
  });
}

async function handleSidePanelMessage(port: RuntimePort, raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object') {
    return;
  }
  const message = raw as Record<string, unknown>;
  switch (message.kind) {
    case 'SCAN_FIELDS':
      await handleScanRequest(port, message);
      break;
    case 'PROMPT_FILL':
      await handlePromptFill(port, message);
      break;
    case 'FOCUS_FIELD':
      await handleFocusField(port, message);
      break;
    case 'HIGHLIGHT_FIELD':
      await handleHighlight(port, message);
      break;
    case 'CLEAR_OVERLAY':
      await handleClearOverlay(port);
      break;
    case 'GUIDED_STEP':
      await handleGuidedStep(port, message);
      break;
    case 'GUIDED_RESET':
      await handleGuidedReset();
      break;
    case 'GUIDED_REQUEST_CURRENT':
      await handleGuidedRequestCurrent(port, message);
      break;
    case 'PROMPT_PREVIEW':
      await handlePromptPreview(port, message);
      break;
  }
}

async function handleScanRequest(port: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : null;
  if (!requestId) {
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.id) {
    sendFields(port, requestId, []);
    return;
  }

  const frames = contentPorts.get(tab.id);
  if (!frames || frames.size === 0) {
    sendFields(port, requestId, []);
    return;
  }

  const pending: PendingScan = {
    tabId: tab.id,
    port,
    expected: frames.size,
    received: 0,
    fields: [],
    completedFrames: new Set(),
  };
  pendingScans.set(requestId, pending);

  for (const [frameId, framePort] of frames.entries()) {
    try {
      framePort.postMessage({ kind: 'SCAN_FIELDS', requestId });
    } catch (error) {
      console.warn('Failed to request field scan', error);
      markFrameComplete(tab.id, frameId, requestId);
    }
  }
}

async function handlePromptFill(port: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : null;
  const fieldId = typeof payload.fieldId === 'string' ? payload.fieldId : null;
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  const value = typeof payload.value === 'string' ? payload.value : undefined;
  const preview = typeof payload.preview === 'string' ? payload.preview : undefined;
  const label = typeof payload.label === 'string' ? payload.label : '';
  const profileId =
    typeof payload.profileId === 'string' && payload.profileId.trim().length > 0 ? payload.profileId : null;
  const fieldKind = payload.fieldKind ? parseFieldKind(payload.fieldKind) : undefined;
  const fieldContext = typeof payload.fieldContext === 'string' ? payload.fieldContext : undefined;
  const fieldAutocomplete =
    typeof payload.fieldAutocomplete === 'string' && payload.fieldAutocomplete.trim().length > 0
      ? payload.fieldAutocomplete
      : undefined;
  const fieldRequired =
    typeof payload.fieldRequired === 'boolean' ? payload.fieldRequired : undefined;
  const scrollIntoView =
    typeof payload.scrollIntoView === 'boolean' ? payload.scrollIntoView : undefined;
  let mode: PromptFillRequest['mode'];
  if (payload.mode === 'click') {
    mode = 'click';
  } else if (payload.mode === 'auto') {
    mode = 'auto';
  } else {
    mode = 'fill';
  }
  const options = Array.isArray(payload.options)
    ? (payload.options as Record<string, unknown>[])
        .map((entry) => {
          const slot = typeof entry.slot === 'string' ? (entry.slot as PromptOption['slot']) : null;
          const optionLabel = typeof entry.label === 'string' ? entry.label : null;
          const optionValue = typeof entry.value === 'string' ? entry.value : null;
          if (!slot || !optionLabel || !optionValue) {
            return null;
          }
          return { slot, label: optionLabel, value: optionValue } satisfies PromptOption;
        })
        .filter((entry): entry is PromptOption => entry !== null)
    : undefined;
  const defaultSlot =
    typeof payload.defaultSlot === 'string' && options?.some((option) => option.slot === payload.defaultSlot)
      ? (payload.defaultSlot as PromptOption['slot'])
      : null;
  if (!requestId || !fieldId) {
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    sendFillResult(port, {
      requestId,
      fieldId,
      status: 'failed',
      reason: 'no-active-tab',
      frameId,
    });
    return;
  }

  const framePort = contentPorts.get(tab.id)?.get(frameId);
  if (!framePort) {
    sendFillResult(port, {
      requestId,
      fieldId,
      status: 'failed',
      reason: 'missing-frame',
      frameId,
    });
    return;
  }

  pendingFills.set(requestId, { tabId: tab.id, port, fieldId, frameId });
  const message: PromptFillRequest = {
    requestId,
    fieldId,
    frameId,
    label,
    mode,
  };
  if (typeof value === 'string') {
    message.value = value;
  }
  if (typeof preview === 'string') {
    message.preview = preview;
  }
  if (options && options.length > 0) {
    message.options = options;
    message.defaultSlot = defaultSlot;
  }
  if (profileId !== undefined) {
    message.profileId = profileId;
  }
  if (fieldKind) {
    message.fieldKind = fieldKind;
  }
  if (fieldContext !== undefined) {
    message.fieldContext = fieldContext;
  }
  if (fieldAutocomplete !== undefined) {
    message.fieldAutocomplete = fieldAutocomplete;
  }
  if (fieldRequired !== undefined) {
    message.fieldRequired = fieldRequired;
  }
  const outbound: Record<string, unknown> = { kind: 'PROMPT_FILL', ...message };
  if (typeof scrollIntoView === 'boolean') {
    outbound.scrollIntoView = scrollIntoView;
  }
  framePort.postMessage(outbound);
}

async function handleFocusField(_: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const fieldId = typeof payload.fieldId === 'string' ? payload.fieldId : null;
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  const scrollIntoView =
    typeof payload.scrollIntoView === 'boolean' ? payload.scrollIntoView : undefined;
  if (!fieldId) {
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const framePort = contentPorts.get(tab.id)?.get(frameId);
  if (!framePort) {
    return;
  }
  const message: Record<string, unknown> = { kind: 'FOCUS_FIELD', fieldId };
  if (typeof scrollIntoView === 'boolean') {
    message.scrollIntoView = scrollIntoView;
  }
  framePort.postMessage(message);
}

async function handleHighlight(port: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const fieldId = typeof payload.fieldId === 'string' ? payload.fieldId : null;
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  const label = typeof payload.label === 'string' ? payload.label : '';
  const scrollIntoView =
    typeof payload.scrollIntoView === 'boolean' ? payload.scrollIntoView : undefined;
  if (!fieldId) {
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const framePort = contentPorts.get(tab.id)?.get(frameId);
  if (!framePort) {
    return;
  }
  const message: Record<string, unknown> = { kind: 'HIGHLIGHT_FIELD', fieldId, label };
  if (typeof scrollIntoView === 'boolean') {
    message.scrollIntoView = scrollIntoView;
  }
  framePort.postMessage(message);
}

async function handleClearOverlay(_: RuntimePort): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const frames = contentPorts.get(tab.id);
  if (!frames) {
    return;
  }
  for (const framePort of frames.values()) {
    framePort.postMessage({ kind: 'CLEAR_OVERLAY' });
  }
}

async function handleGuidedStep(_: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const direction = payload.direction === -1 ? -1 : 1;
  const wrap = payload.wrap === false ? false : true;
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const framePort = contentPorts.get(tab.id)?.get(frameId);
  framePort?.postMessage({ kind: 'GUIDED_STEP', direction, wrap });
}

async function handleGuidedReset(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const frames = contentPorts.get(tab.id);
  if (!frames) {
    return;
  }
  for (const framePort of frames.values()) {
    framePort.postMessage({ kind: 'GUIDED_RESET' });
  }
}

async function handleGuidedRequestCurrent(_: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const framePort = contentPorts.get(tab.id)?.get(frameId);
  framePort?.postMessage({ kind: 'GUIDED_REQUEST_CURRENT' });
}

async function handlePromptPreview(_: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const fieldId = typeof payload.fieldId === 'string' ? payload.fieldId : null;
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  if (!fieldId) {
    return;
  }
  const label = typeof payload.label === 'string' ? payload.label : '';
  const preview = typeof payload.preview === 'string' ? payload.preview : undefined;
  const value = typeof payload.value === 'string' ? payload.value : undefined;
  const defaultSlot = typeof payload.defaultSlot === 'string' ? (payload.defaultSlot as PromptOption['slot']) : null;
  const profileId =
    typeof payload.profileId === 'string' && payload.profileId.trim().length > 0 ? payload.profileId : null;
  const previewId = typeof payload.previewId === 'string' ? payload.previewId : undefined;
  const scrollIntoView =
    typeof payload.scrollIntoView === 'boolean' ? payload.scrollIntoView : undefined;
  const options = Array.isArray(payload.options)
    ? (payload.options as Record<string, unknown>[]) // eslint-disable-line @typescript-eslint/consistent-type-assertions
        .map((entry) => {
          const slot = typeof entry.slot === 'string' ? (entry.slot as PromptOption['slot']) : null;
          const optionLabel = typeof entry.label === 'string' ? entry.label : null;
          const optionValue = typeof entry.value === 'string' ? entry.value : null;
          if (!slot || !optionLabel || !optionValue) {
            return null;
          }
          return { slot, label: optionLabel, value: optionValue } satisfies PromptOption;
        })
        .filter((entry): entry is PromptOption => entry !== null)
    : undefined;

  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const framePort = contentPorts.get(tab.id)?.get(frameId);
  if (!framePort) {
    return;
  }

  const field = parsePromptFieldState(payload.field, fieldId, label);
  const message: PromptPreviewRequest = {
    fieldId,
    frameId,
    label,
    preview,
    value,
    defaultSlot,
    options,
    profileId,
    previewId,
  };
  if (field) {
    message.field = field;
  }

  const outbound: Record<string, unknown> = { kind: 'PROMPT_PREVIEW', ...message };
  if (typeof scrollIntoView === 'boolean') {
    outbound.scrollIntoView = scrollIntoView;
  }
  framePort.postMessage(outbound);
}

async function handlePromptAiSuggestMessage(raw: Record<string, unknown>): Promise<PromptAiSuggestResponse> {
  const query = typeof raw.query === 'string' ? raw.query : '';
  if (!query.trim()) {
    return { status: 'error', error: 'Query required.' };
  }
  const currentValue = typeof raw.currentValue === 'string' ? raw.currentValue : '';
  const suggestion = typeof raw.suggestion === 'string' ? raw.suggestion : '';
  const selectedSlot =
    typeof raw.selectedSlot === 'string' ? (raw.selectedSlot as PromptOptionSlot) : null;
  const matches = Array.isArray(raw.matches)
    ? (raw.matches
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const normalized = entry as Record<string, unknown>;
          const slot = typeof normalized.slot === 'string' ? (normalized.slot as PromptOptionSlot) : null;
          const label = typeof normalized.label === 'string' ? normalized.label : '';
          const value = typeof normalized.value === 'string' ? normalized.value : '';
          if (!slot || !label || !value) {
            return null;
          }
          return { slot, label, value } as PromptOption;
        })
        .filter((entry): entry is PromptOption => Boolean(entry)))
    : [];
  const profileId =
    typeof raw.profileId === 'string' && raw.profileId.trim().length > 0 ? raw.profileId : null;
  const field = parsePromptFieldState(raw.field, typeof raw.fieldId === 'string' ? raw.fieldId : undefined);
  if (!field) {
    return { status: 'error', error: 'Missing field context.' };
  }

  try {
    const settings = await getSettings();
    const provider = settings.provider;
    const profileRecord = profileId ? await getProfile(profileId) : undefined;
    const result = await requestGuidedSuggestion({
      provider,
      query,
      field: {
        label: field.label,
        kind: field.kind,
        context: field.context,
        autocomplete: field.autocomplete ?? null,
        required: field.required,
      },
      slot: selectedSlot ?? null,
      currentValue,
      suggestion,
      matches,
      profile: profileRecord?.resume ?? null,
    });
    const normalized = result.value.trim();
    if (!normalized) {
      return { status: 'error', error: 'AI returned an empty response.' };
    }
    return {
      status: 'ok',
      value: normalized,
      slot: selectedSlot ?? null,
    };
  } catch (error) {
    if (
      error instanceof NoProviderConfiguredError ||
      error instanceof ProviderConfigurationError ||
      error instanceof ProviderAvailabilityError ||
      error instanceof ProviderInvocationError
    ) {
      return { status: 'error', error: error.message };
    }
    if (error instanceof Error) {
      return { status: 'error', error: error.message };
    }
    return { status: 'error', error: 'Unknown AI error.' };
  }
}

function handleContentMessage(tabId: number, frameId: number, raw: unknown): void {
  if (!raw || typeof raw !== 'object') {
    return;
  }
  const message = raw as Record<string, unknown>;
  if (message.kind === 'FIELDS') {
    const requestId = typeof message.requestId === 'string' ? message.requestId : null;
    if (!requestId) {
      return;
    }
    const pending = pendingScans.get(requestId);
    if (!pending || pending.tabId !== tabId) {
      return;
    }
    if (pending.completedFrames.has(frameId)) {
      return;
    }

    pending.completedFrames.add(frameId);
    pending.received += 1;

    const frameUrl = typeof message.frameUrl === 'string' ? message.frameUrl : '';
    const fields = Array.isArray(message.fields) ? message.fields : [];
    const enriched = fields
      .map((entry) => normalizeFieldEntry(entry, frameId, frameUrl))
      .filter((entry): entry is ScannedField => entry !== null);
    pending.fields.push(...enriched);
    if (pending.received >= pending.expected) {
      finalizeScan(requestId, pending);
    }
  } else if (message.kind === 'FILL_RESULT') {
    const requestId = typeof message.requestId === 'string' ? message.requestId : null;
    const fieldId = typeof message.fieldId === 'string' ? message.fieldId : null;
    if (!requestId || !fieldId) {
      return;
    }
    const pending = pendingFills.get(requestId);
    const result: FillResultMessage = {
      requestId,
      fieldId,
      status: parseFillStatus(message.status),
      reason: typeof message.reason === 'string' ? message.reason : undefined,
      frameId,
    };
    if (pending) {
      sendFillResult(pending.port, result);
      pendingFills.delete(requestId);
    } else {
      // Fall back to broadcasting if the original requester is gone.
      for (const panel of sidePanelPorts) {
        sendFillResult(panel, result);
      }
    }
  } else if (message.kind === 'GUIDED_CANDIDATE') {
    const frameUrl = typeof message.frameUrl === 'string' ? message.frameUrl : '';
    const origin = message.origin === 'step' ? 'step' : message.origin === 'request' ? 'request' : 'focus';
    const normalized = normalizeFieldEntry(message.field, frameId, frameUrl);
    if (!normalized) {
      return;
    }
    for (const panel of sidePanelPorts) {
      panel.postMessage({ kind: 'GUIDED_CANDIDATE', field: normalized, origin, frameId });
    }
    void maybeShowPopupPromptOverlay(tabId, frameId, normalized, origin);
  } else if (message.kind === 'GUIDED_INPUT_CAPTURE') {
    const frameUrl = typeof message.frameUrl === 'string' ? message.frameUrl : '';
    const value = typeof message.value === 'string' ? message.value : '';
    if (value.length === 0) {
      return;
    }
    const normalized = normalizeFieldEntry(message.field, frameId, frameUrl);
    if (!normalized) {
      return;
    }
    for (const panel of sidePanelPorts) {
      panel.postMessage({ kind: 'GUIDED_INPUT_CAPTURE', field: normalized, value, frameId });
    }
  }
}

async function maybeShowPopupPromptOverlay(
  tabId: number,
  frameId: number,
  field: ScannedField,
  origin: 'focus' | 'step' | 'request',
): Promise<void> {
  if (!popupOverlayTabs.has(tabId)) {
    return;
  }
  if (origin !== 'focus') {
    return;
  }
  if (field.kind === 'checkbox' || field.kind === 'radio' || field.kind === 'file') {
    return;
  }
  const frames = contentPorts.get(tabId);
  const framePort = frames?.get(frameId);
  if (!framePort) {
    return;
  }

  const fallbackLabel = resolveFieldLabel(field);
  const previewId = typeof crypto?.randomUUID === 'function'
    ? `popup:${crypto.randomUUID()}`
    : `popup:${Math.random().toString(36).slice(2)}`;

  let profileOptions: PromptOption[] = [];
  let profileId: string | null = null;
  if (activeProfileId) {
    try {
      const profile = await getProfile(activeProfileId);
      if (profile) {
        profileOptions = buildProfilePromptOptions(profile, {
          formatSlotLabel,
          resumeLabel: i18n.t('sidepanel.manual.resumeRoot'),
        });
        profileId = profile.id;
      }
    } catch (error) {
      console.warn('Unable to load profile for prompt overlay.', error);
    }
  }

  const resolvedSlot = resolveFieldSlot(field, overlayAdapterIds);
  const slotMatch = resolvedSlot
    ? profileOptions.find((option) => option.slot === resolvedSlot)
    : undefined;
  const fallbackOption = slotMatch ?? profileOptions[0] ?? null;
  const defaultSlot: PromptOptionSlot | null = fallbackOption
    ? fallbackOption.slot
    : resolvedSlot ?? null;
  const defaultValue = fallbackOption ? fallbackOption.value : '';

  const message: Record<string, unknown> = {
    kind: 'PROMPT_PREVIEW',
    previewId,
    fieldId: field.id,
    frameId,
    label: fallbackLabel,
    scrollIntoView: false,
    field: {
      id: field.id,
      label: fallbackLabel,
      kind: field.kind,
      context: field.context,
      autocomplete: field.autocomplete ?? null,
      required: field.required,
    },
  };
  if (profileId) {
    message.profileId = profileId;
  }
  if (profileOptions.length > 0) {
    message.options = profileOptions;
  }
  if (defaultSlot !== null) {
    message.defaultSlot = defaultSlot;
  }
  if (defaultValue) {
    message.value = defaultValue;
    message.preview = defaultValue;
  }

  safePostMessage(framePort, message);
}

function resolveFieldLabel(field: ScannedField): string {
  const label = field.label?.trim?.();
  if (label) {
    return label;
  }
  const ariaLabel = field.attributes?.ariaLabel?.trim?.();
  if (ariaLabel) {
    return ariaLabel;
  }
  const placeholder = field.attributes?.placeholder?.trim?.();
  if (placeholder) {
    return placeholder;
  }
  return '';
}

function clearOverlayForTab(tabId: number): void {
  const frames = contentPorts.get(tabId);
  if (!frames) {
    return;
  }
  for (const port of frames.values()) {
    safePostMessage(port, { kind: 'CLEAR_OVERLAY' });
  }
}

async function loadActiveProfilePreference(): Promise<void> {
  try {
    const stored = await browser.storage.local.get(ACTIVE_PROFILE_STORAGE_KEY);
    const raw = stored[ACTIVE_PROFILE_STORAGE_KEY];
    activeProfileId = typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
  } catch (error) {
    console.warn('Unable to load active profile preference.', error);
    activeProfileId = null;
  }
}

async function setActiveProfilePreference(profileId: string | null): Promise<void> {
  const next = profileId && profileId.trim().length > 0 ? profileId : null;
  if (next === activeProfileId) {
    return;
  }
  if (next) {
    await browser.storage.local.set({ [ACTIVE_PROFILE_STORAGE_KEY]: next });
  } else {
    await browser.storage.local.remove(ACTIVE_PROFILE_STORAGE_KEY);
  }
  activeProfileId = next;
  for (const tabId of popupOverlayTabs) {
    clearOverlayForTab(tabId);
  }
}

function normalizeFieldEntry(entry: unknown, frameId: number, frameUrl: string): ScannedField | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const value = entry as Record<string, unknown>;
  return {
    id: String(value.id ?? ''),
    kind: parseFieldKind(value.kind),
    label: String(value.label ?? ''),
    context: typeof value.context === 'string' ? value.context : '',
    autocomplete: typeof value.autocomplete === 'string' ? value.autocomplete : undefined,
    required: Boolean(value.required),
    rect: normalizeRect(value.rect),
    frameId,
    frameUrl,
    attributes: normalizeAttributes(value.attributes),
    hasValue: Boolean(value.hasValue),
  };
}

function markFrameComplete(tabId: number, frameId: number, specificRequestId?: string): void {
  if (specificRequestId) {
    const pending = pendingScans.get(specificRequestId);
    if (!pending || pending.tabId !== tabId || pending.completedFrames.has(frameId)) {
      return;
    }
    pending.completedFrames.add(frameId);
    pending.received += 1;
    if (pending.received >= pending.expected) {
      finalizeScan(specificRequestId, pending);
    }
    return;
  }

  for (const [requestId, pending] of pendingScans.entries()) {
    if (pending.tabId !== tabId || pending.completedFrames.has(frameId)) {
      continue;
    }
    pending.completedFrames.add(frameId);
    pending.received += 1;
    if (pending.received >= pending.expected) {
      finalizeScan(requestId, pending);
    }
  }
}

function finalizeScan(requestId: string, pending: PendingScan): void {
  sendFields(pending.port, requestId, pending.fields);
  pendingScans.delete(requestId);
}

function sendFields(port: RuntimePort, requestId: string, fields: ScannedField[]): void {
  const payload: FieldsResponse = { kind: 'FIELDS', requestId, fields };
  safePostMessage(port, payload);
}

function sendFillResult(port: RuntimePort, result: FillResultMessage): void {
  const payload: FillResultResponse = { kind: 'FILL_RESULT', ...result };
  safePostMessage(port, payload);
}

function parsePromptFieldState(
  value: unknown,
  fallbackId?: string,
  fallbackLabel?: string,
): PromptFieldState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const data = value as Record<string, unknown>;
  const id = typeof data.id === 'string' && data.id.trim().length > 0 ? data.id : fallbackId ?? '';
  if (!id) {
    return null;
  }
  const label =
    typeof data.label === 'string' && data.label.trim().length > 0 ? data.label : fallbackLabel ?? '';
  const kind = parseFieldKind(data.kind);
  const context = typeof data.context === 'string' ? data.context : '';
  const autocomplete =
    typeof data.autocomplete === 'string' && data.autocomplete.trim().length > 0
      ? data.autocomplete
      : undefined;
  const required = data.required === true;
  return {
    id,
    label,
    kind,
    context,
    autocomplete,
    required,
  };
}

function parseFieldKind(value: unknown): FieldKind {
  switch (value) {
    case 'email':
    case 'tel':
    case 'number':
    case 'date':
    case 'select':
    case 'textarea':
    case 'checkbox':
    case 'radio':
    case 'file':
      return value;
    default:
      return 'text';
  }
}

function normalizeRect(value: unknown): ScannedField['rect'] {
  if (value && typeof value === 'object') {
    const rect = value as Record<string, unknown>;
    return {
      top: Number(rect.top) || 0,
      left: Number(rect.left) || 0,
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
    };
  }
  return { top: 0, left: 0, width: 0, height: 0 };
}

function normalizeAttributes(value: unknown): FieldAttributes | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const tagName = typeof raw.tagName === 'string' ? raw.tagName : undefined;
  if (!tagName) {
    return undefined;
  }

  const attributes: FieldAttributes = { tagName };

  if (typeof raw.type === 'string') {
    attributes.type = raw.type;
  }
  if (typeof raw.name === 'string') {
    attributes.name = raw.name;
  }
  if (typeof raw.id === 'string') {
    attributes.id = raw.id;
  }
  if (typeof raw.placeholder === 'string') {
    attributes.placeholder = raw.placeholder;
  }
  if (typeof raw.ariaLabel === 'string') {
    attributes.ariaLabel = raw.ariaLabel;
  }
  const maxLength = Number(raw.maxLength);
  if (Number.isFinite(maxLength) && maxLength > 0) {
    attributes.maxLength = maxLength;
  }
  if (Array.isArray(raw.options)) {
    const options = raw.options
      .map((option: unknown) => {
        if (!option || typeof option !== 'object') {
          return null;
        }
        const entry = option as Record<string, unknown>;
        const valueText = typeof entry.value === 'string' ? entry.value : undefined;
        const labelText = typeof entry.label === 'string' ? entry.label : undefined;
        if (!valueText && !labelText) {
          return null;
        }
        return {
          value: valueText ?? '',
          label: labelText ?? '',
        };
      })
      .filter((item): item is { value: string; label: string } => item !== null);
    if (options.length > 0) {
      attributes.options = options;
    }
  }

  return attributes;
}

function parseFillStatus(value: unknown): FillResultMessage['status'] {
  if (value === 'filled' || value === 'skipped' || value === 'failed') {
    return value;
  }
  return 'failed';
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function safePostMessage(port: RuntimePort, message: unknown): void {
  try {
    port.postMessage(message);
  } catch (error) {
    console.warn('Failed to post message to port.', error);
  }
}
