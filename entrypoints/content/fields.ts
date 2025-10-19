import { computeAccessibleName } from 'dom-accessibility-api';
import type { FieldAttributes, FieldKind, FieldRect } from '../../shared/apply/types';
import { clearRegistry, registerElement } from './registry';

type SupportedElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface InternalField {
  id: string;
  element: SupportedElement;
  kind: FieldKind;
  label: string;
  context: string;
  autocomplete?: string;
  required: boolean;
  rect: FieldRect;
  attributes: FieldAttributes;
  hasValue: boolean;
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
    const context = buildContext(element, label);
    const attributes = extractAttributes(element);
    const hasValue = elementHasValue(element);

    registerElement(id, element);
    candidates.push({
      id,
      element,
      kind,
      label,
      context,
      rect,
      required: isRequired(element),
      autocomplete: autocomplete && autocomplete !== 'on' ? autocomplete : undefined,
      attributes,
      hasValue,
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

function buildContext(element: SupportedElement, label: string): string {
  const parts = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const normalized = normalizeContext(value);
    if (normalized.length > 0) {
      parts.add(normalized);
    }
  };

  add(label);

  if (element instanceof HTMLInputElement) {
    add(element.placeholder);
    add(element.name);
    add(element.id);
    add(element.getAttribute('autocomplete'));
  } else {
    add(element.getAttribute('placeholder'));
    add(element.getAttribute('name'));
    add(element.getAttribute('id'));
    add(element.getAttribute('autocomplete'));
  }

  add(element.getAttribute('aria-label'));
  add(element.getAttribute('aria-description'));
  add(element.getAttribute('title'));
  add(element.className);

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .forEach((id) => {
        const node = document.getElementById(id);
        if (node?.textContent) {
          add(node.textContent);
        }
      });
  }

  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy) {
    describedBy
      .split(/\s+/)
      .filter(Boolean)
      .forEach((id) => {
        const node = document.getElementById(id);
        if (node?.textContent) {
          add(node.textContent);
        }
      });
  }

  if ('labels' in element && element.labels) {
    for (const node of Array.from(element.labels)) {
      if (node?.textContent) {
        add(node.textContent);
      }
    }
  }

  const enclosingLabel = element.closest('label');
  if (enclosingLabel?.textContent) {
    add(enclosingLabel.textContent);
  }

  const forLabel =
    element.id && typeof element.id === 'string'
      ? document.querySelector(`label[for="${escapeSelector(element.id)}"]`)
      : null;
  if (forLabel instanceof HTMLLabelElement && forLabel.textContent) {
    add(forLabel.textContent);
  }

  const container = element.closest<HTMLElement>(
    '.el-form-item, .ant-form-item, .form-item, .field, .form-group, [class*="field"], [class*="Form"], [class*="row"], tr',
  );
  if (container?.textContent) {
    add(container.textContent);
  }

  const parent = element.parentElement;
  if (parent?.textContent) {
    add(parent.textContent);
  }

  if (parts.size === 0) {
    return '';
  }

  const combined = Array.from(parts).join('|');
  return combined.length > 2000 ? combined.slice(0, 2000) : combined;
}

function extractAttributes(element: SupportedElement): FieldAttributes {
  const tagName = element.tagName.toLowerCase();
  const normalize = (value: string | null | undefined) => {
    if (!value) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const attributes: FieldAttributes = {
    tagName,
    ariaLabel: normalize(element.getAttribute('aria-label')),
  };

  if (element instanceof HTMLInputElement) {
    attributes.type = normalize(element.type);
    attributes.name = normalize(element.name);
    attributes.id = normalize(element.id);
    attributes.placeholder = normalize(element.placeholder);
    attributes.maxLength = element.maxLength > 0 ? element.maxLength : undefined;
  } else if (element instanceof HTMLTextAreaElement) {
    attributes.name = normalize(element.name);
    attributes.id = normalize(element.id);
    attributes.placeholder = normalize(element.placeholder);
    attributes.maxLength = element.maxLength > 0 ? element.maxLength : undefined;
  } else if (element instanceof HTMLSelectElement) {
    attributes.name = normalize(element.name);
    attributes.id = normalize(element.id);
    const options = Array.from(element.options)
      .slice(0, 20)
      .map((option) => ({
        value: normalize(option.value) ?? '',
        label: normalize(option.textContent) ?? '',
      }))
      .filter((entry) => entry.label || entry.value);
    if (options.length > 0) {
      attributes.options = options;
    }
  }

  return attributes;
}

function elementHasValue(element: SupportedElement): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked;
    }
    return element.value.trim().length > 0;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value.trim().length > 0;
  }
  if (element instanceof HTMLSelectElement) {
    return element.value.trim().length > 0;
  }
  return false;
}

function normalizeContext(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function isRequired(element: SupportedElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    return Boolean(element.required);
  }
  return false;
}
