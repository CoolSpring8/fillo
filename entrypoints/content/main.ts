import { browser } from 'wxt/browser';
import type { FieldAttributes, FillResultStatus, PromptFillRequest } from '../../shared/apply/types';
import { fillField, triggerClick } from './fill';
import type { InternalField } from './fields';
import { describeElement, scanFields } from './fields';
import { clearOverlay, showHighlight, showPrompt } from './overlay';
import { clearRegistry, getElement } from './registry';
import { currentTabbable, documentHasFocus, focusNextTabbable } from './tabbable';

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
      direction?: 'next' | 'prev';
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
    }
  | {
      kind: 'GUIDED_VALUE_CAPTURED';
      fieldId: string;
      value: string;
      label: string;
      frameUrl: string;
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

    const dirtyElements = new WeakSet<Element>();

    const port = browser.runtime.connect({ name: 'content' });

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
          handleGuidedStep(message.direction);
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
    });

    document.addEventListener(
      'focusin',
      (event) => {
        if (!(event.target instanceof Element)) {
          return;
        }
        const field = describeElement(event.target);
        if (!field) {
          return;
        }
        emitCandidate(field);
      },
      true,
    );

    document.addEventListener(
      'input',
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          if (target instanceof HTMLInputElement && target.type === 'password') {
            return;
          }
          dirtyElements.add(target);
        }
      },
      true,
    );

    document.addEventListener(
      'focusout',
      (event) => {
        const target = event.target;
        if (
          !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
        ) {
          return;
        }
        if (!dirtyElements.has(target)) {
          return;
        }
        dirtyElements.delete(target);
        if (target instanceof HTMLInputElement && target.type === 'password') {
          return;
        }
        const value = readElementValue(target);
        if (!value || value.trim().length === 0) {
          return;
        }
        const field = describeElement(target);
        if (!field) {
          return;
        }
        send({
          kind: 'GUIDED_VALUE_CAPTURED',
          fieldId: field.id,
          value,
          label: field.label,
          frameUrl: window.location.href,
        });
      },
      true,
    );

    function send(message: ContentOutboundMessage): void {
      port.postMessage(message);
    }

    function handleScan(requestId: string): void {
      const fields = scanFields();
      fieldMetadata.clear();
      for (const field of fields) {
        fieldMetadata.set(field.id, { label: field.label, kind: field.kind });
      }

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

    function handleGuidedStep(direction: 'next' | 'prev' | undefined): void {
      if (!documentHasFocus()) {
        return;
      }
      focusNextTabbable({ direction: direction === 'prev' ? -1 : 1, wrap: true });
    }

    function handleGuidedRequestCurrent(): void {
      const active = currentTabbable();
      if (active) {
        const described = describeElement(active);
        if (described) {
          emitCandidate(described);
        }
        return;
      }
      focusNextTabbable({ direction: 1, wrap: true });
    }

    function emitCandidate(field: InternalField): void {
      send({
        kind: 'GUIDED_CANDIDATE',
        field: serialize([field])[0],
        frameUrl: window.location.href,
      });
    }

    function readElementValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string | null {
      if (element instanceof HTMLInputElement) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          return element.checked ? element.value || 'on' : '';
        }
        return element.value ?? '';
      }
      if (element instanceof HTMLTextAreaElement) {
        return element.value ?? '';
      }
      if (element instanceof HTMLSelectElement) {
        return element.value ?? '';
      }
      return null;
    }
  },
});

function serialize(fields: InternalField[]): SerializedField[] {
  return fields.map((field) => ({
    id: field.id,
    kind: field.kind,
    label: field.label,
    context: field.context,
    autocomplete: field.autocomplete,
    required: field.required,
    rect: field.rect,
    attributes: field.attributes,
    hasValue: field.hasValue,
  }));
}
