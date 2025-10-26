import { browser } from 'wxt/browser';
import type {
  FieldAttributes,
  FieldKind,
  FillResultMessage,
  PromptFillRequest,
  PromptOption,
  ScannedField,
} from '../shared/apply/types';

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
  framePort.postMessage({ kind: 'PROMPT_FILL', ...message });
}

async function handleFocusField(_: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const fieldId = typeof payload.fieldId === 'string' ? payload.fieldId : null;
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  if (!fieldId) {
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const framePort = contentPorts.get(tab.id)?.get(frameId);
  framePort?.postMessage({ kind: 'FOCUS_FIELD', fieldId });
}

async function handleHighlight(port: RuntimePort, payload: Record<string, unknown>): Promise<void> {
  const fieldId = typeof payload.fieldId === 'string' ? payload.fieldId : null;
  const frameId = typeof payload.frameId === 'number' ? payload.frameId : 0;
  const label = typeof payload.label === 'string' ? payload.label : '';
  if (!fieldId) {
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  const framePort = contentPorts.get(tab.id)?.get(frameId);
  framePort?.postMessage({ kind: 'HIGHLIGHT_FIELD', fieldId, label });
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
