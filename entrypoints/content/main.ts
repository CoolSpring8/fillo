import { browser } from 'wxt/browser';
import type { FillResultStatus, PromptFillRequest } from '../../shared/apply/types';
import { fillField, triggerClick } from './fill';
import type { InternalField } from './fields';
import { scanFields } from './fields';
import { clearOverlay, showHighlight, showPrompt } from './overlay';
import { clearRegistry, getElement } from './registry';

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
      }
    });

    port.onDisconnect.addListener(() => {
      clearOverlay();
      clearRegistry();
      fieldMetadata.clear();
    });

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
  }));
}
