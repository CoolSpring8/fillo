import { computeAccessibleName } from 'dom-accessibility-api';
import type { FieldKind, FieldRect } from '../../shared/apply/types';
import { clearRegistry, registerElement } from './registry';

type SupportedElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface InternalField {
  id: string;
  element: SupportedElement;
  kind: FieldKind;
  label: string;
  autocomplete?: string;
  required: boolean;
  rect: FieldRect;
}

export function scanFields(): InternalField[] {
  clearRegistry();

  const nodes: SupportedElement[] = Array.from(
    document.querySelectorAll<SupportedElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    ),
  );

  const candidates: InternalField[] = [];

  for (const element of nodes) {
    if (!isSupported(element)) {
      continue;
    }
    if (!isEditable(element)) {
      continue;
    }

    const kind = classify(element);
    if (!kind) {
      continue;
    }

    const label = buildLabel(element);
    const rect = extractRect(element);
    const id = crypto.randomUUID();
    const autocomplete = (element as HTMLInputElement).autocomplete;

    registerElement(id, element);
    candidates.push({
      id,
      element,
      kind,
      label,
      rect,
      required: isRequired(element),
      autocomplete: autocomplete && autocomplete !== 'on' ? autocomplete : undefined,
    });
  }

  candidates.sort((a, b) => {
    const top = a.rect.top - b.rect.top;
    if (Math.abs(top) > 1) {
      return top;
    }
    return a.rect.left - b.rect.left;
  });

  return candidates;
}

function isSupported(element: Element): element is SupportedElement {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLSelectElement) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    return element.type !== 'hidden';
  }
  return false;
}

function isEditable(element: SupportedElement): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.readOnly) {
      return false;
    }
    if (element.type === 'button' || element.type === 'submit' || element.type === 'reset') {
      return false;
    }
  }
  return true;
}

function classify(element: SupportedElement): FieldKind | null {
  if (element instanceof HTMLTextAreaElement) {
    return 'textarea';
  }
  if (element instanceof HTMLSelectElement) {
    return 'select';
  }
  if (element instanceof HTMLInputElement) {
    switch (element.type) {
      case 'text':
      case 'url':
      case 'search':
      case 'password':
        return 'text';
      case 'email':
        return 'email';
      case 'tel':
        return 'tel';
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      case 'checkbox':
        return 'checkbox';
      case 'radio':
        return 'radio';
      case 'file':
        return 'file';
      default:
        return null;
    }
  }
  return null;
}

function buildLabel(element: SupportedElement): string {
  const accessible = computeAccessibleName(element).trim();
  if (accessible.length > 0) {
    return accessible;
  }
  const placeholder =
    'placeholder' in element ? element.placeholder.trim() : element.getAttribute('placeholder')?.trim() ?? '';
  if (placeholder.length > 0) {
    return placeholder;
  }
  if ('name' in element && typeof element.name === 'string' && element.name.trim().length > 0) {
    return element.name.trim();
  }
  if ('id' in element && typeof element.id === 'string' && element.id.trim().length > 0) {
    return element.id.trim();
  }
  return '';
}

function extractRect(element: SupportedElement): FieldRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function isRequired(element: SupportedElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    return Boolean(element.required);
  }
  return false;
}
