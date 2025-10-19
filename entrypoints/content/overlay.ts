import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { PromptOption, PromptOptionSlot } from '../../shared/apply/types';

type OverlayMode = 'highlight' | 'prompt';

interface PromptOptions {
  label: string;
  preview?: string;
  options?: PromptOption[];
  defaultSlot?: PromptOptionSlot | null;
  defaultValue?: string;
  onFill: (value: string, slot: PromptOptionSlot | null) => void;
  onSkip: () => void;
}

interface HighlightOptions {
  label: string;
  duration?: number;
}

interface OverlayElements {
  highlight: HTMLDivElement;
  popover: HTMLDivElement;
}

let cleanupFns: Array<() => void> = [];
let currentTarget: HTMLElement | null = null;
let currentMode: OverlayMode | null = null;
let overlayRoot: ShadowRoot | null = null;
let dismissTimer: number | null = null;

export function clearOverlay(): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  currentTarget = null;
  currentMode = null;

  const { highlight, popover } = ensureElements();
  highlight.style.display = 'none';
  highlight.style.opacity = '0';
  popover.hidden = true;
  popover.innerHTML = '';
}

export function showHighlight(target: Element, options: HighlightOptions): void {
  if (!(target instanceof HTMLElement)) {
    clearOverlay();
    return;
  }
  clearOverlay();
  currentTarget = target;
  currentMode = 'highlight';
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

  const { highlight, popover } = ensureElements();
  updateHighlightRect(target, highlight);

  popover.innerHTML = '';
  if (options.label.trim().length > 0) {
    const label = document.createElement('div');
    label.className = 'overlay-label';
    label.textContent = options.label;
    popover.append(label);
    popover.hidden = false;
    void positionPopover(target, popover);
  } else {
    popover.hidden = true;
  }
  attachRepositionListeners(target, highlight, popover, false);

  const duration = Math.max(0, options.duration ?? 1000);
  if (duration > 0) {
    dismissTimer = window.setTimeout(() => {
      dismissTimer = null;
      clearOverlay();
    }, duration);
    cleanupFns.push(() => {
      if (dismissTimer !== null) {
        window.clearTimeout(dismissTimer);
        dismissTimer = null;
      }
    });
  }
}

export function showPrompt(target: Element, options: PromptOptions): void {
  if (!(target instanceof HTMLElement)) {
    clearOverlay();
    return;
  }
  clearOverlay();
  currentTarget = target;
  currentMode = 'prompt';
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

  const { highlight, popover } = ensureElements();
  updateHighlightRect(target, highlight);
  renderPrompt(popover, options);
  popover.hidden = false;
  void positionPopover(target, popover);
  attachRepositionListeners(target, highlight, popover, true);
}

function renderPrompt(popover: HTMLDivElement, options: PromptOptions): void {
  const { t } = i18n;
  popover.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'overlay-title';
  heading.textContent = options.label.length > 0 ? options.label : t('overlay.prompt.heading');

  const body = document.createElement('div');
  body.className = 'overlay-body';
  popover.append(heading);

  const controls = document.createElement('div');
  controls.className = 'overlay-controls';

  let currentSlot: PromptOptionSlot | null = options.defaultSlot ?? null;
  let currentValue = options.defaultValue ?? options.preview ?? '';

  const updatePreview = () => {
    if (currentValue && currentValue.trim().length > 0) {
      body.textContent = currentValue;
    } else if (options.preview && options.preview.trim().length > 0) {
      body.textContent = options.preview;
    } else {
      body.textContent = t('overlay.prompt.awaitingSelection');
    }
  };

  let select: HTMLSelectElement | null = null;
  let fill!: HTMLButtonElement;

  const normalizeOptions = options.options ?? [];
  if (normalizeOptions.length > 0) {
    select = document.createElement('select');
    select.className = 'overlay-select';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('overlay.prompt.placeholder');
    select.append(placeholder);

    for (const option of normalizeOptions) {
      const optionEl = document.createElement('option');
      optionEl.value = option.slot;
      optionEl.textContent = `${option.label} · ${truncate(option.value)}`;
      optionEl.dataset.value = option.value;
      select.append(optionEl);
    }

    if (currentSlot && normalizeOptions.some((opt) => opt.slot === currentSlot)) {
      select.value = currentSlot;
      currentValue = normalizeOptions.find((opt) => opt.slot === currentSlot)?.value ?? currentValue;
    } else {
      select.value = '';
      if (!currentValue && normalizeOptions.length === 1) {
        currentSlot = normalizeOptions[0].slot;
        currentValue = normalizeOptions[0].value;
        select.value = currentSlot;
      }
    }

    select.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement;
      const slot = target.value as PromptOptionSlot | '';
      if (!slot) {
        currentSlot = null;
        currentValue = '';
      } else {
        const selected = normalizeOptions.find((opt) => opt.slot === slot);
        currentSlot = selected?.slot ?? null;
        currentValue = selected?.value ?? '';
      }
      updatePreview();
      fill.disabled = normalizeOptions.length > 0 && currentValue.trim().length === 0;
    });

    const helper = document.createElement('div');
    helper.className = 'overlay-helper';
    helper.textContent = t('overlay.prompt.helper');

    controls.append(select, helper);
  } else {
    currentSlot = null;
  }

  if (controls.childElementCount > 0) {
    popover.append(controls);
  }
  popover.append(body);

  const actions = document.createElement('div');
  actions.className = 'overlay-actions';

  fill = document.createElement('button');
  fill.type = 'button';
  fill.className = 'overlay-btn primary';
  fill.textContent = t('overlay.prompt.fill');
  fill.disabled = normalizeOptions.length > 0 && (!currentValue || currentValue.trim().length === 0);
  fill.addEventListener('click', (event) => {
    event.preventDefault();
    if (normalizeOptions.length > 0 && (!currentValue || currentValue.trim().length === 0)) {
      return;
    }
    options.onFill(currentValue ?? '', currentSlot ?? null);
  });

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'overlay-btn';
  skip.textContent = t('overlay.prompt.skip');
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    options.onSkip();
  });

  actions.append(fill, skip);
  popover.append(actions);

  updatePreview();
}

function attachRepositionListeners(
  target: HTMLElement,
  highlight: HTMLDivElement,
  popover: HTMLDivElement,
  hasPopover: boolean,
): void {
  const reposition = () => {
    if (!currentTarget || currentTarget !== target) {
      return;
    }
    updateHighlightRect(target, highlight);
    if (hasPopover) {
      void positionPopover(target, popover);
    }
  };

  const observer = new ResizeObserver(reposition);
  observer.observe(document.documentElement);
  if (target instanceof HTMLElement) {
    const targetObserver = new ResizeObserver(reposition);
    targetObserver.observe(target);
    cleanupFns.push(() => targetObserver.disconnect());
  }
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  cleanupFns.push(() => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    observer.disconnect();
  });
}

function ensureElements(): OverlayElements {
  let host = document.getElementById('__apply_overlay_host__');
  if (!host) {
    host = document.createElement('div');
    host.id = '__apply_overlay_host__';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    document.documentElement.append(host);
  }

  if (!overlayRoot) {
    overlayRoot = host.shadowRoot ?? host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .highlight {
        position: fixed;
        border: 1px solid rgba(255, 255, 255, 0.65);
        border-radius: 10px;
        box-shadow: 0 0 0 20000px rgba(15, 23, 42, 0.45);
        background: rgba(255, 255, 255, 0.03);
        pointer-events: none;
        transition: opacity 120ms ease;
        opacity: 0;
      }
      .popover {
        position: fixed;
        min-width: 220px;
        max-width: 320px;
        background: #ffffff;
        color: #1f2328;
        border-radius: 8px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
        padding: 12px;
        pointer-events: auto;
        font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .overlay-title {
        font-weight: 600;
        margin-bottom: 6px;
      }
      .overlay-body {
        white-space: pre-wrap;
        word-break: break-word;
        margin-bottom: 12px;
      }
      .overlay-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .overlay-btn {
        border: 1px solid rgba(76, 159, 254, 0.6);
        border-radius: 6px;
        padding: 6px 12px;
        background: #ffffff;
        color: #1f2328;
        cursor: pointer;
      }
      .overlay-btn.primary {
        background: #4c9ffe;
        border-color: #4c9ffe;
        color: #fff;
      }
      .overlay-btn:hover {
        filter: brightness(0.95);
      }
      .overlay-label {
        font-weight: 500;
      }
      .overlay-select {
        width: 100%;
        border: 1px solid rgba(15, 23, 42, 0.2);
        border-radius: 6px;
        padding: 6px 8px;
        font: inherit;
        background: #fff;
      }
      .overlay-controls {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
      }
      .overlay-helper {
        font-size: 12px;
        color: #475569;
      }
    `;
    overlayRoot.append(style);
  }

  const root = overlayRoot!;

  let highlight = root.querySelector<HTMLDivElement>('.highlight');
  if (!highlight) {
    highlight = document.createElement('div');
    highlight.className = 'highlight';
    highlight.style.display = 'none';
    root.append(highlight);
  }

  let popover = root.querySelector<HTMLDivElement>('.popover');
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'popover';
    popover.hidden = true;
    root.append(popover);
  }

  return { highlight, popover };
}

async function positionPopover(target: HTMLElement, popover: HTMLDivElement): Promise<void> {
  await nextFrame();
  const { x, y } = await computePosition(target, popover, {
    middleware: [offset(10), flip(), shift()],
  });
  popover.style.left = `${Math.round(x)}px`;
  popover.style.top = `${Math.round(y)}px`;
}

function updateHighlightRect(target: HTMLElement, highlight: HTMLDivElement): void {
  const rect = target.getBoundingClientRect();
  const padding = 6;
  highlight.style.display = 'block';
  highlight.style.top = `${Math.max(rect.top - padding, 0)}px`;
  highlight.style.left = `${Math.max(rect.left - padding, 0)}px`;
  highlight.style.width = `${Math.max(rect.width + padding * 2, 0)}px`;
  highlight.style.height = `${Math.max(rect.height + padding * 2, 0)}px`;
  highlight.style.opacity = '1';
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function truncate(value: string, limit = 80): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}
