import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OverlayApp } from './ui/OverlayApp';
import type { HighlightRect, OverlayRenderState, PopoverPosition, PromptOptions } from './ui/types';

interface HighlightOptions {
  label: string;
  duration?: number;
}

let cleanupFns: Array<() => void> = [];
let currentTarget: HTMLElement | null = null;
let overlayRoot: ShadowRoot | null = null;
let dismissTimer: number | null = null;
let hostContainer: HTMLDivElement | null = null;
let reactRoot: Root | null = null;
let popoverElement: HTMLDivElement | null = null;
let overlayState: OverlayRenderState = {
  component: { mode: 'hidden' },
  highlightRect: null,
  popoverPosition: null,
};

export function clearOverlay(): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  currentTarget = null;

  setOverlayState({
    component: { mode: 'hidden' },
    highlightRect: null,
    popoverPosition: null,
  });
}

export function showHighlight(target: Element, options: HighlightOptions): void {
  if (!(target instanceof HTMLElement)) {
    clearOverlay();
    return;
  }
  clearOverlay();
  currentTarget = target;
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

  setOverlayState({
    component: { mode: 'highlight', label: options.label },
    highlightRect: computeHighlightLayout(target),
    popoverPosition: null,
  });
  if (options.label.trim().length > 0) {
    void updatePopoverPosition();
  }
  attachRepositionListeners(target, options.label.trim().length > 0);

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
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

  setOverlayState({
    component: { mode: 'prompt', prompt: clonePromptOptions(options) },
    highlightRect: computeHighlightLayout(target),
    popoverPosition: null,
  });
  void updatePopoverPosition();
  attachRepositionListeners(target, true);
}

function attachRepositionListeners(target: HTMLElement, hasPopover: boolean): void {
  const reposition = () => {
    if (!currentTarget || currentTarget !== target) {
      return;
    }
    const nextHighlight = computeHighlightLayout(target);
    updateOverlayState((previous) => {
      if (rectEquals(previous.highlightRect, nextHighlight)) {
        return previous;
      }
      return {
        ...previous,
        highlightRect: nextHighlight,
      };
    });
    if (hasPopover) {
      void updatePopoverPosition();
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

function ensureReactRoot(): void {
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
        border: 1px solid rgba(137, 100, 89, 0.6);
        border-radius: 6px;
        padding: 6px 12px;
        background: #ffffff;
        color: #1f2328;
        cursor: pointer;
      }
      .overlay-btn.primary {
        background: #896459;
        border-color: #896459;
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

  if (!hostContainer) {
    hostContainer = document.createElement('div');
    overlayRoot!.append(hostContainer);
  }

  if (!reactRoot) {
    reactRoot = createRoot(hostContainer);
  }
}

const handlePopoverMount = (element: HTMLDivElement | null) => {
  popoverElement = element;
  if (element) {
    void updatePopoverPosition();
  }
};

function renderOverlay(): void {
  ensureReactRoot();
  if (!reactRoot) {
    return;
  }

  reactRoot.render(
    createElement(OverlayApp, {
      state: overlayState.component,
      highlightRect: overlayState.highlightRect,
      popoverPosition: overlayState.popoverPosition,
      onPopoverMount: handlePopoverMount,
    }),
  );
}

async function updatePopoverPosition(): Promise<void> {
  if (!currentTarget || !popoverElement) {
    return;
  }
  if (overlayState.component.mode === 'hidden') {
    return;
  }
  if (
    overlayState.component.mode === 'highlight' &&
    overlayState.component.label.trim().length === 0
  ) {
    updateOverlayState((previous) => ({
      ...previous,
      popoverPosition: null,
    }));
    return;
  }

  const previousVisibility = popoverElement.style.visibility;
  // Temporarily unhide so Floating UI measures the popover with real dimensions.
  popoverElement.hidden = false;
  popoverElement.style.visibility = 'hidden';

  try {
    await nextFrame();
    const { x, y } = await computePosition(currentTarget, popoverElement, {
      middleware: [offset(10), flip(), shift()],
    });
    const nextPosition: PopoverPosition = { x: Math.round(x), y: Math.round(y) };
    updateOverlayState((previous) => {
      if (pointEquals(previous.popoverPosition, nextPosition)) {
        return previous;
      }
      return {
        ...previous,
        popoverPosition: nextPosition,
      };
    });
  } finally {
    popoverElement.style.visibility = previousVisibility;
  }
}

function computeHighlightLayout(target: HTMLElement): HighlightRect {
  const rect = target.getBoundingClientRect();
  const padding = 6;
  return {
    top: Math.max(rect.top - padding, 0),
    left: Math.max(rect.left - padding, 0),
    width: Math.max(rect.width + padding * 2, 0),
    height: Math.max(rect.height + padding * 2, 0),
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setOverlayState(nextState: OverlayRenderState): void {
  overlayState = nextState;
  renderOverlay();
}

function updateOverlayState(
  updater: (previous: OverlayRenderState) => OverlayRenderState,
): void {
  const nextState = updater(overlayState);
  if (nextState === overlayState) {
    return;
  }
  setOverlayState(nextState);
}

function clonePromptOptions(options: PromptOptions): PromptOptions {
  const clonedOptions = options.options?.map((option) => ({ ...option }));
  return {
    ...options,
    options: clonedOptions,
  };
}

function rectEquals(left: HighlightRect | null, right: HighlightRect | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.width === right.width &&
    left.height === right.height
  );
}

function pointEquals(left: PopoverPosition | null, right: PopoverPosition | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.x === right.x && left.y === right.y;
}

export type { PromptOptions } from './ui/types';
