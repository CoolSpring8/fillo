// Utilities to navigate tabbable elements within the current document.
// Adapted from guidance snippet to support guided mode focus management.

function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active: Element | null = root.activeElement;
  while (active && (active as HTMLElement).shadowRoot && (active as HTMLElement).shadowRoot!.activeElement) {
    active = (active as HTMLElement).shadowRoot!.activeElement;
  }
  return active;
}

function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement) || el.hasAttribute('hidden')) return false;
  if (el.closest('[inert]')) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (el.getClientRects().length === 0) return false;
  return true;
}

function isDisabledControl(el: Element): boolean {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  if ('disabled' in el && (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled) return true;
  if (el.closest('fieldset[disabled]')) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return false;
}

function isTabbable(el: Element): el is HTMLElement {
  if (!isVisible(el) || isDisabledControl(el)) return false;
  const element = el as HTMLElement & { tabIndex: number };
  const tagName = element.tagName;
  const hasTabindex = element.hasAttribute('tabindex');
  const tabIndex = element.tabIndex;
  if (tabIndex < 0) return false;

  if (tagName === 'INPUT') {
    const type = element.getAttribute('type');
    if (type && type.toLowerCase() === 'hidden') return false;
    return true;
  }
  if (tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON') return true;
  if (tagName === 'A' || tagName === 'AREA') return !!element.getAttribute('href');
  if (tagName === 'IFRAME' || tagName === 'SUMMARY') return true;
  if ((tagName === 'AUDIO' || tagName === 'VIDEO') && element.hasAttribute('controls')) return true;
  if (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') return true;
  if (hasTabindex) return tabIndex >= 0;
  return false;
}

function compareDOMOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function collapseRadioGroups(scope: Document | Element, els: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const el of els) {
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio' && (el as HTMLInputElement).name) {
      const radio = el as HTMLInputElement;
      const formId = radio.form ? radio.form.id || '(anon-form)' : '(no-form)';
      const key = `${formId}::${radio.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const escaped = CSS.escape(radio.name);
      const group = Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escaped}"]`)).filter(
        (entry) => !isDisabledControl(entry) && isVisible(entry),
      );
      const candidate = group.find((r) => r.checked) || group[0] || radio;
      out.push(candidate);
    } else {
      out.push(el);
    }
  }
  return out;
}

function getTabOrder(scope: Document | Element): HTMLElement[] {
  const selectors = [
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
  ];
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>(selectors.join(','))).filter(isTabbable);
  const collapsed = collapseRadioGroups(scope, candidates);
  const positives: HTMLElement[] = [];
  const normals: HTMLElement[] = [];
  for (const el of collapsed) {
    const tabIndex = el.tabIndex;
    if (tabIndex > 0) {
      positives.push(el);
    } else {
      normals.push(el);
    }
  }
  positives.sort((a, b) => (a.tabIndex - b.tabIndex) || compareDOMOrder(a, b));
  normals.sort(compareDOMOrder);
  return positives.concat(normals);
}

export function focusNextTabbable(opts: { direction?: 1 | -1; wrap?: boolean; scope?: Element | Document } = {}): HTMLElement | null {
  const { direction = 1, wrap = true, scope } = opts;
  const current = deepActiveElement(document);
  const localScope = scope || (current instanceof HTMLElement ? current.closest('form') : null) || document;
  const order = getTabOrder(localScope);
  if (order.length === 0) return null;
  const currentIndex = current && order.includes(current as HTMLElement) ? order.indexOf(current as HTMLElement) : -1;
  const len = order.length;
  for (let step = 1; step <= len; step += 1) {
    const rawIndex = currentIndex + direction * step;
    let index = rawIndex;
    if (index < 0 || index >= len) {
      if (!wrap) return null;
      index = ((index % len) + len) % len;
    }
    const next = order[index];
    if (next && next !== current) {
      try {
        next.focus({ preventScroll: true });
      } catch {
        continue;
      }
      return next;
    }
  }
  return null;
}

export function currentTabbable(): HTMLElement | null {
  const active = deepActiveElement(document);
  if (!active) {
    return null;
  }
  return isTabbable(active) ? (active as HTMLElement) : null;
}

export function documentHasFocus(): boolean {
  return document.hasFocus();
}
