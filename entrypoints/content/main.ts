import { browser } from 'wxt/browser';
import type { FieldAttributes, FillResultStatus, PromptFillRequest } from '../../shared/apply/types';
import { fillField, triggerClick } from './fill';
import type { InternalField } from './fields';
import { buildFieldForElement, elementHasValue, scanFields } from './fields';
import { clearOverlay, showHighlight, showPrompt } from './overlay';
import { clearRegistry, getElement } from './registry';
import { deepActiveElement, focusStep } from './tabbable';

type ContentInboundMessage =
  | {
      kind: 'SCAN_FIELDS';
      requestId: string;
    }
  | ({ kind: 'PROMPT_FILL' } & PromptFillRequest)
  | {
      kind: 'HIGHLIGHT_FIELD';
      fieldId: string;
      label: string;
    }
  | {
      kind: 'CLEAR_OVERLAY';
    }
  | {
      kind: 'FOCUS_FIELD';
      fieldId: string;
    }
  | {
      kind: 'GUIDED_STEP';
      direction?: 1 | -1;
      wrap?: boolean;
    }
  | {
      kind: 'GUIDED_RESET';
    }
  | {
      kind: 'GUIDED_REQUEST_CURRENT';
    };

type ContentOutboundMessage =
  | {
      kind: 'FIELDS';
      requestId: string;
      fields: SerializedField[];
      frameUrl: string;
    }
  | {
      kind: 'FILL_RESULT';
      requestId: string;
      fieldId: string;
      status: FillResultStatus;
      reason?: string;
    }
  | {
      kind: 'GUIDED_CANDIDATE';
      field: SerializedField;
      frameUrl: string;
      origin: 'focus' | 'step' | 'request';
    }
  | {
      kind: 'GUIDED_INPUT_CAPTURE';
      field: SerializedField;
      frameUrl: string;
      value: string;
    };

interface SerializedField {
  id: string;
  kind: string;
  label: string;
  context: string;
  autocomplete?: string;
  required: boolean;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  attributes?: FieldAttributes;
  hasValue: boolean;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const fieldMetadata = new Map<
      string,
      {
        label: string;
        kind: string;
      }
    >();
    const ignoreCaptures = new Set<string>();
    let lastGuidedId: string | null = null;

    const port = browser.runtime.connect({ name: 'content' });

    const handleFocusIn = () => {
      const active = deepActiveElement();
      if (!active) {
        return;
      }
      const field = buildFieldForElement(active);
      if (!field) {
        return;
      }
      emitGuidedCandidate(field, 'focus');
    };

    const handleFocusOut = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const field = buildFieldForElement(target);
      if (!field) {
        return;
      }
      if (ignoreCaptures.has(field.id)) {
        ignoreCaptures.delete(field.id);
        return;
      }
      if (!shouldCaptureValue(target)) {
        return;
      }
      const value = readElementValue(target);
      if (!value.trim()) {
        return;
      }
      emitGuidedInputCapture(field, value);
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);

    port.onMessage.addListener((message: ContentInboundMessage) => {
      switch (message.kind) {
        case 'SCAN_FIELDS':
          handleScan(message.requestId);
          break;
        case 'PROMPT_FILL':
          handlePromptFill(message);
          break;
        case 'HIGHLIGHT_FIELD':
          handleHighlight(message.fieldId, message.label);
          break;
        case 'CLEAR_OVERLAY':
          clearOverlay();
          break;
        case 'FOCUS_FIELD':
          handleFocus(message.fieldId);
          break;
        case 'GUIDED_STEP':
          handleGuidedStep(message.direction, message.wrap);
          break;
        case 'GUIDED_RESET':
          handleGuidedReset();
          break;
        case 'GUIDED_REQUEST_CURRENT':
          handleGuidedRequestCurrent();
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      clearOverlay();
      clearRegistry();
      fieldMetadata.clear();
      ignoreCaptures.clear();
      lastGuidedId = null;
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
    });

    function send(message: ContentOutboundMessage): void {
      port.postMessage(message);
    }

    function rememberField(field: InternalField): void {
      fieldMetadata.set(field.id, { label: field.label, kind: field.kind });
    }

    function emitGuidedCandidate(field: InternalField, origin: 'focus' | 'step' | 'request'): void {
      if (origin !== 'request' && lastGuidedId === field.id) {
        return;
      }
      lastGuidedId = field.id;
      rememberField(field);
      send({
        kind: 'GUIDED_CANDIDATE',
        field: serializeField(field),
        frameUrl: window.location.href,
        origin,
      });
    }

    function emitGuidedInputCapture(field: InternalField, value: string): void {
      rememberField(field);
      send({
        kind: 'GUIDED_INPUT_CAPTURE',
        field: serializeField(field),
        frameUrl: window.location.href,
        value,
      });
    }

    function markProgrammaticFill(fieldId: string): void {
      ignoreCaptures.add(fieldId);
      window.setTimeout(() => {
        ignoreCaptures.delete(fieldId);
      }, 250);
    }

    function shouldCaptureValue(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
      if (element instanceof HTMLInputElement) {
        const type = element.type?.toLowerCase?.() ?? '';
        if (type === 'password' || type === 'file' || type === 'button' || type === 'submit' || type === 'reset') {
          return false;
        }
        return true;
      }
      if (element instanceof HTMLTextAreaElement) {
        return true;
      }
      if (element instanceof HTMLSelectElement) {
        return true;
      }
      return false;
    }

    function readElementValue(element: Element): string {
      if (element instanceof HTMLInputElement) {
        const type = element.type?.toLowerCase?.() ?? '';
        if (type === 'checkbox' || type === 'radio') {
          if (!element.checked) {
            return '';
          }
          return element.value ?? '';
        }
        return element.value ?? '';
      }
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return element.value ?? '';
      }
      return '';
    }

    function handleScan(requestId: string): void {
      const fields = scanFields();
      fieldMetadata.clear();
      fields.forEach(rememberField);

      send({
        kind: 'FIELDS',
        requestId,
        fields: serialize(fields),
        frameUrl: window.location.href,
      });
    }

    function handlePromptFill(message: Extract<ContentInboundMessage, { kind: 'PROMPT_FILL' }>): void {
      const meta = fieldMetadata.get(message.fieldId);
      if (!meta) {
        send({
          kind: 'FILL_RESULT',
          requestId: message.requestId,
          fieldId: message.fieldId,
          status: 'failed',
          reason: 'missing-field',
        });
        return;
      }

      if (message.mode === 'click') {
        const success = triggerClick(message.fieldId);
        send({
          kind: 'FILL_RESULT',
          requestId: message.requestId,
          fieldId: message.fieldId,
          status: success ? 'filled' : 'failed',
          reason: success ? undefined : 'click-failed',
        });
        return;
      }

      if (message.mode === 'auto') {
        const element = getElement(message.fieldId);
        const value = typeof message.value === 'string' ? message.value : '';
        if (!element || !(element instanceof HTMLElement)) {
          send({
            kind: 'FILL_RESULT',
            requestId: message.requestId,
            fieldId: message.fieldId,
            status: 'failed',
            reason: 'missing-element',
          });
          return;
        }
        if (!value.trim()) {
          send({
            kind: 'FILL_RESULT',
            requestId: message.requestId,
            fieldId: message.fieldId,
            status: 'failed',
            reason: 'empty-value',
          });
          return;
        }
        const filled = fillField(message.fieldId, value);
        send({
          kind: 'FILL_RESULT',
          requestId: message.requestId,
          fieldId: message.fieldId,
          status: filled ? 'filled' : 'failed',
          reason: filled ? undefined : 'fill-failed',
        });
        clearOverlay();
        return;
      }

      const element = getElement(message.fieldId);
      if (!element || !(element instanceof HTMLElement)) {
        send({
          kind: 'FILL_RESULT',
          requestId: message.requestId,
          fieldId: message.fieldId,
          status: 'failed',
          reason: 'missing-element',
        });
        return;
      }

      if (message.mode === 'fill' && (!message.options || message.options.length === 0)) {
        const value = typeof message.value === 'string' ? message.value : '';
        if (!value.trim()) {
          send({
            kind: 'FILL_RESULT',
            requestId: message.requestId,
            fieldId: message.fieldId,
            status: 'failed',
            reason: 'empty-value',
          });
          clearOverlay();
          return;
        }
        markProgrammaticFill(message.fieldId);
        const filled = fillField(message.fieldId, value);
        send({
          kind: 'FILL_RESULT',
          requestId: message.requestId,
          fieldId: message.fieldId,
          status: filled ? 'filled' : 'failed',
          reason: filled ? undefined : 'fill-failed',
        });
        clearOverlay();
        return;
      }

      showPrompt(element, {
        label: message.label || meta.label,
        preview: message.preview,
        options: message.options,
        defaultSlot: message.defaultSlot ?? null,
        defaultValue: message.value,
        onFill: (selectedValue) => {
          const value = selectedValue && selectedValue.trim().length > 0 ? selectedValue : message.value ?? '';
          if (!value) {
            send({
              kind: 'FILL_RESULT',
              requestId: message.requestId,
              fieldId: message.fieldId,
              status: 'failed',
              reason: 'no-selection',
            });
            clearOverlay();
            return;
          }
          markProgrammaticFill(message.fieldId);
          const filled = fillField(message.fieldId, value);
          send({
            kind: 'FILL_RESULT',
            requestId: message.requestId,
            fieldId: message.fieldId,
            status: filled ? 'filled' : 'failed',
            reason: filled ? undefined : 'fill-failed',
          });
          clearOverlay();
        },
        onSkip: () => {
          send({
            kind: 'FILL_RESULT',
            requestId: message.requestId,
            fieldId: message.fieldId,
            status: 'skipped',
          });
          clearOverlay();
        },
      });
    }

    function handleHighlight(fieldId: string, label: string): void {
      const target = getElement(fieldId);
      if (!target) {
        clearOverlay();
        return;
      }
      showHighlight(target, { label });
    }

    function handleFocus(fieldId: string): void {
      const target = getElement(fieldId);
      if (!target || !(target instanceof HTMLElement)) {
        return;
      }
      clearOverlay();
      try {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      } catch (error) {
        console.warn('scrollIntoView failed', error);
      }
      queueMicrotask(() => {
        try {
          target.focus({ preventScroll: true });
        } catch {
          // Element might not be focusable; ignore.
        }
        showHighlight(target, { label: '', duration: 1000 });
      });
    }

    function handleGuidedStep(direction?: number, wrap?: boolean): void {
      const dir: 1 | -1 = direction === -1 ? -1 : 1;
      const next = focusStep({ direction: dir, wrap: wrap !== false });
      if (!next) {
        return;
      }
      const field = buildFieldForElement(next);
      if (!field) {
        return;
      }
      emitGuidedCandidate(field, 'step');
    }

    function handleGuidedReset(): void {
      lastGuidedId = null;
    }

    function handleGuidedRequestCurrent(): void {
      const active = deepActiveElement();
      if (!active) {
        return;
      }
      const field = buildFieldForElement(active);
      if (!field) {
        return;
      }
      emitGuidedCandidate(field, 'request');
    }
  },
});

function serializeField(field: InternalField): SerializedField {
  return {
    id: field.id,
    kind: field.kind,
    label: field.label,
    context: field.context,
    autocomplete: field.autocomplete,
    required: field.required,
    rect: field.rect,
    attributes: field.attributes,
    hasValue: field.hasValue,
  };
}

function serialize(fields: InternalField[]): SerializedField[] {
  return fields.map(serializeField);
}
