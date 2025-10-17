import { getElement } from './registry';

export function fillField(fieldId: string, value: string): boolean {
  const element = getElement(fieldId);
  if (!element) {
    return false;
  }

  if (element instanceof HTMLSelectElement) {
    const matchIndex = Array.from(element.options).findIndex((option) => {
      const text = option.textContent?.trim().toLowerCase() ?? '';
      return text === value.trim().toLowerCase();
    });
    if (matchIndex >= 0) {
      element.selectedIndex = matchIndex;
    } else {
      element.value = value;
    }
    dispatchInput(element);
    return true;
  }

  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    const next = /^true|1|yes|on$/i.test(value);
    element.checked = next;
    dispatchInput(element);
    return true;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const descriptor = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    );
    descriptor?.set?.call(element, value);
    dispatchInput(element);
    return true;
  }

  return false;
}

export function triggerClick(fieldId: string): boolean {
  const element = getElement(fieldId);
  if (!element) {
    return false;
  }
  if (element instanceof HTMLElement) {
    element.click();
    return true;
  }
  return false;
}

function dispatchInput(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
