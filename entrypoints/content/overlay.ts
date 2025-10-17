import { computePosition, flip, offset, shift } from '@floating-ui/dom';

type OverlayMode = 'highlight' | 'prompt';

interface PromptOptions {
  preview: string;
  label: string;
  onFill: () => void;
  onSkip: () => void;
}

interface HighlightOptions {
  label: string;
}

interface OverlayElements {
  highlight: HTMLDivElement;
  popover: HTMLDivElement;
}

let cleanupFns: Array<() => void> = [];
let currentTarget: HTMLElement | null = null;
let currentMode: OverlayMode | null = null;

export function clearOverlay(): void {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  currentTarget = null;
  currentMode = null;

  const { highlight, popover } = ensureElements();
  highlight.style.display = 'none';
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
  popover.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'overlay-title';
  heading.textContent = options.label.length > 0 ? options.label : 'Suggested value';

  const body = document.createElement('div');
  body.className = 'overlay-body';
  body.textContent = options.preview;

  const actions = document.createElement('div');
  actions.className = 'overlay-actions';

  const fill = document.createElement('button');
  fill.type = 'button';
  fill.className = 'overlay-btn primary';
  fill.textContent = 'Fill';
  fill.addEventListener('click', (event) => {
    event.preventDefault();
    options.onFill();
  });

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'overlay-btn';
  skip.textContent = 'Skip';
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    options.onSkip();
  });

  actions.append(fill, skip);
  popover.append(heading, body, actions);
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

  let root = host.shadowRoot;
  if (!root) {
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .highlight {
        position: fixed;
        border: 2px solid #4c9ffe;
        border-radius: 6px;
        box-shadow: 0 0 0 4px rgba(76, 159, 254, 0.2);
        pointer-events: none;
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
    `;
    root.append(style);
  }

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
  highlight.style.display = 'block';
  highlight.style.top = `${Math.max(rect.top, 0)}px`;
  highlight.style.left = `${Math.max(rect.left, 0)}px`;
  highlight.style.width = `${Math.max(rect.width, 0)}px`;
  highlight.style.height = `${Math.max(rect.height, 0)}px`;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
