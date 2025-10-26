export function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active: Element | null = root.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

export function isVisible(el: Element | null): el is Element {
  if (!el || (el as HTMLElement).hasAttribute?.('hidden')) return false;
  if (el.closest('[inert]')) return false;
  const style = window.getComputedStyle(el as Element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if ((el as Element).getClientRects().length === 0) return false;
  return true;
}

export function isDisabledControl(el: Element | null): boolean {
  if (!el) return false;
  const element = el as HTMLElement & { disabled?: boolean };
  if ('disabled' in element && Boolean(element.disabled)) return true;
  if (element.closest('fieldset[disabled]')) return true;
  const ariaDisabled = element.getAttribute?.('aria-disabled');
  if (ariaDisabled === 'true') return true;
  return false;
}

export function isTabbable(el: Element | null): el is HTMLElement {
  if (!el || !isVisible(el) || isDisabledControl(el)) return false;
  const element = el as HTMLElement;
  const tn = element.tagName;
  const hasTabindex = element.hasAttribute('tabindex');
  const ti = element.tabIndex;
  if (ti < 0) return false;

  if (tn === 'INPUT') {
    const type = element.getAttribute('type');
    if (type && type.toLowerCase() === 'hidden') return false;
    return true;
  }
  if (tn === 'SELECT' || tn === 'TEXTAREA' || tn === 'BUTTON') return true;
  if (tn === 'A' || tn === 'AREA') return Boolean(element.getAttribute('href'));
  if (tn === 'IFRAME' || tn === 'SUMMARY') return true;
  if ((tn === 'AUDIO' || tn === 'VIDEO') && element.hasAttribute('controls')) return true;
  if (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') return true;
  if (hasTabindex) return ti >= 0;
  return false;
}

function compareDOMOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function collapseRadioGroups(scope: Document | Element, elements: Element[]): Element[] {
  const out: Element[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      const formId = el.form ? el.form.id || '(anon-form)' : '(no-form)';
      const key = `${formId}::${el.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const escapeFn = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape : ((value: string) => value);
      const escaped = escapeFn(el.name);
      const group = Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escaped}"]`))
        .filter((candidate) => !isDisabledControl(candidate) && isVisible(candidate));
      const candidate = group.find((radio) => radio.checked) || group[0] || el;
      out.push(candidate);
    } else {
      out.push(el);
    }
  }
  return out;
}

export function getTabOrder(scope: Document | Element = document): Element[] {
  const selector = [
    'input',
    'select',
    'textarea',
    'button',
    'a[href]',
    'area[href]',
    'iframe',
    'summary',
    '[tabindex]',
    '[contenteditable]',
    'audio[controls]',
    'video[controls]',
  ].join(',');
  const candidates = Array.from(scope.querySelectorAll<Element>(selector)).filter(isTabbable);
  const collapsed = collapseRadioGroups(scope, candidates);
  const positives: Element[] = [];
  const normals: Element[] = [];

  for (const el of collapsed) {
    const ti = (el as HTMLElement).tabIndex;
    if (ti > 0) positives.push(el);
    else normals.push(el);
  }

  positives.sort((a, b) => {
    const diff = (a as HTMLElement).tabIndex - (b as HTMLElement).tabIndex;
    if (diff !== 0) return diff;
    return compareDOMOrder(a, b);
  });
  normals.sort(compareDOMOrder);

  return positives.concat(normals);
}

interface FocusStepOptions {
  direction?: 1 | -1;
  wrap?: boolean;
  scope?: Document | Element | null;
}

export function focusStep({ direction = 1, wrap = true, scope = null }: FocusStepOptions = {}): Element | null {
  const currentDeep = deepActiveElement(document);
  const localScope = scope ?? (currentDeep?.closest('form') ?? document);
  const order = getTabOrder(localScope);
  if (order.length === 0) return null;

  let idx = currentDeep ? order.indexOf(currentDeep) : -1;
  if (idx === -1) idx = direction > 0 ? -1 : 0;

  const len = order.length;
  for (let step = 1; step <= len; step += 1) {
    const nextIndex = idx + direction * step;
    let j = nextIndex;
    if (j < 0 || j >= len) {
      if (!wrap) return null;
      j = ((j % len) + len) % len;
    }
    const next = order[j];
    if (next && next !== currentDeep) {
      (next as HTMLElement).focus({ preventScroll: true });
      return next;
    }
  }

  return null;
}

export function focusNext(options: Omit<FocusStepOptions, 'direction'> = {}): Element | null {
  return focusStep({ direction: 1, ...options });
}

export function focusPrev(options: Omit<FocusStepOptions, 'direction'> = {}): Element | null {
  return focusStep({ direction: -1, ...options });
}
