import {
  computePosition,
  flip,
  offset,
  shift,
  type ReferenceElement,
  type VirtualElement,
} from '@floating-ui/dom';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OverlayApp } from './ui/OverlayApp';
import type { HighlightRect, OverlayRenderState, PopoverPosition, PromptOptions } from './ui/types';
import overlayMantineStyles from './ui/overlay.mantine.css?inline';
import overlayStyles from './ui/overlay.css?inline';

interface HighlightOptions {
  label: string;
  duration?: number;
}

interface OverlayGeometry {
  highlightRect: HighlightRect;
  referenceRect: DOMRectReadOnly;
}

interface OverlayBridge {
  clearOverlay(): void;
  showHighlight(target: Element, options: HighlightOptions): void;
  showPrompt(target: Element, options: PromptOptions): void;
}

interface OverlayController {
  clearOverlay(): void;
  showHighlight(target: Element, options: HighlightOptions): void;
  showPrompt(target: Element, options: PromptOptions): void;
}

const OVERLAY_BRIDGE_KEY = '__apply_overlay_bridge__';
const OVERLAY_ROOT_ELEMENT_ID = '__apply_overlay_root__';
const isTopWindow = window === window.top;

let clearOverlayImpl: () => void;
let showHighlightImpl: (target: Element, options: HighlightOptions) => void;
let showPromptImpl: (target: Element, options: PromptOptions) => void;

if (isTopWindow) {
  const controller = createOverlayController(true);
  clearOverlayImpl = controller.clearOverlay;
  showHighlightImpl = controller.showHighlight;
  showPromptImpl = controller.showPrompt;
} else {
  let localController: OverlayController | null = null;

  const resolveBridge = (): OverlayBridge | null => {
    try {
      const topWindow = window.top;
      if (!topWindow || topWindow === window) {
        return null;
      }
      const bridge = (topWindow as unknown as Record<string, unknown>)[OVERLAY_BRIDGE_KEY] as OverlayBridge | undefined;
      return bridge ?? null;
    } catch {
      return null;
    }
  };

  const ensureLocalController = (): OverlayController => {
    if (!localController) {
      localController = createOverlayController(false);
    }
    return localController;
  };

  clearOverlayImpl = () => {
    const bridge = resolveBridge();
    if (bridge) {
      bridge.clearOverlay();
      return;
    }
    ensureLocalController().clearOverlay();
  };

  showHighlightImpl = (target, options) => {
    const bridge = resolveBridge();
    if (bridge) {
      bridge.showHighlight(target, options);
      return;
    }
    ensureLocalController().showHighlight(target, options);
  };

  showPromptImpl = (target, options) => {
    const bridge = resolveBridge();
    if (bridge) {
      bridge.showPrompt(target, options);
      return;
    }
    ensureLocalController().showPrompt(target, options);
  };
}

export { clearOverlayImpl as clearOverlay, showHighlightImpl as showHighlight, showPromptImpl as showPrompt };
export type { PromptOptions } from './ui/types';

function createOverlayController(registerBridge: boolean): OverlayController {
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
  let currentReferenceRect: DOMRectReadOnly | null = null;
  let stylesInjected = false;
  let constructableSheets: CSSStyleSheet[] | null = null;
  const supportsConstructableStylesheets =
    Array.isArray(document.adoptedStyleSheets) && 'replaceSync' in CSSStyleSheet.prototype;

  const virtualReference: VirtualElement = {
    getBoundingClientRect(): DOMRect {
      if (!currentReferenceRect) {
        return new DOMRect(0, 0, 0, 0);
      }
      const { left, top, width, height } = currentReferenceRect;
      return new DOMRect(left, top, width, height);
    },
  };

  const clearOverlay = (): void => {
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    currentTarget = null;
    currentReferenceRect = null;

    setOverlayState({
      component: { mode: 'hidden' },
      highlightRect: null,
      popoverPosition: null,
    });
  };

  const showHighlight = (target: Element, options: HighlightOptions): void => {
    if (!(target instanceof HTMLElement)) {
      clearOverlay();
      return;
    }
    clearOverlay();
    currentTarget = target;
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

    const geometry = computeOverlayGeometry(target, window) ?? computeFallbackGeometry(target);
    currentReferenceRect = geometry.referenceRect;
    setOverlayState({
      component: { mode: 'highlight', label: options.label },
      highlightRect: geometry.highlightRect,
      popoverPosition: null,
    });

    const hasPopover = options.label.trim().length > 0;
    if (hasPopover) {
      void updatePopoverPosition();
    } else {
      updateOverlayState((previous) => ({
        ...previous,
        popoverPosition: null,
      }));
    }
    attachRepositionListeners(target, hasPopover);

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
  };

  const showPrompt = (target: Element, options: PromptOptions): void => {
    if (!(target instanceof HTMLElement)) {
      clearOverlay();
      return;
    }
    clearOverlay();
    currentTarget = target;
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });

    const geometry = computeOverlayGeometry(target, window) ?? computeFallbackGeometry(target);
    currentReferenceRect = geometry.referenceRect;
    setOverlayState({
      component: { mode: 'prompt', prompt: clonePromptOptions(options) },
      highlightRect: geometry.highlightRect,
      popoverPosition: null,
    });
    void updatePopoverPosition();
    attachRepositionListeners(target, true);
  };

  const attachRepositionListeners = (target: HTMLElement, hasPopover: boolean): void => {
    const reposition = () => {
      if (!currentTarget || currentTarget !== target) {
        return;
      }
      const geometry = computeOverlayGeometry(target, window) ?? computeFallbackGeometry(target);
      currentReferenceRect = geometry.referenceRect;
      updateOverlayState((previous) => {
        if (rectEquals(previous.highlightRect, geometry.highlightRect)) {
          return previous;
        }
        return {
          ...previous,
          highlightRect: geometry.highlightRect,
        };
      });
      if (hasPopover) {
        void updatePopoverPosition();
      }
    };

    const targetWindow = target.ownerDocument.defaultView ?? window;
    const targetDocumentElement = target.ownerDocument.documentElement;

    const hostObserver = new ResizeObserver(reposition);
    hostObserver.observe(document.documentElement);
    cleanupFns.push(() => hostObserver.disconnect());

    const targetObserver = new ResizeObserver(reposition);
    targetObserver.observe(target);
    cleanupFns.push(() => targetObserver.disconnect());

    if (targetDocumentElement) {
      const docObserver = new ResizeObserver(reposition);
      docObserver.observe(targetDocumentElement);
      cleanupFns.push(() => docObserver.disconnect());
    }

    const attachedWindows = new Set<Window>();
    const observedFrames = new Set<Element>();
    const attachWindowListeners = (win: Window) => {
      if (attachedWindows.has(win)) {
        return;
      }
      win.addEventListener('scroll', reposition, true);
      win.addEventListener('resize', reposition);
      cleanupFns.push(() => {
        win.removeEventListener('scroll', reposition, true);
        win.removeEventListener('resize', reposition);
        attachedWindows.delete(win);
      });
      attachedWindows.add(win);
    };

    let currentWindow: Window | null = targetWindow;
    while (currentWindow) {
      attachWindowListeners(currentWindow);

      let frameElement: Element | null = null;
      try {
        frameElement = currentWindow.frameElement;
      } catch {
        frameElement = null;
      }
      if (frameElement instanceof HTMLElement && !observedFrames.has(frameElement)) {
        const frameObserver = new ResizeObserver(reposition);
        frameObserver.observe(frameElement);
        cleanupFns.push(() => frameObserver.disconnect());
        observedFrames.add(frameElement);
      }

      if (currentWindow === window) {
        break;
      }
      let parentWindow: Window | null = null;
      try {
        parentWindow = currentWindow.parent;
      } catch {
        parentWindow = null;
      }
      if (!parentWindow || parentWindow === currentWindow) {
        break;
      }
      currentWindow = parentWindow;
    }
  };

  const appendStylesToShadowRoot = (root: ShadowRoot, styles: string[]): void => {
    if (supportsConstructableStylesheets) {
      if (!constructableSheets) {
        constructableSheets = styles.map((cssText) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(cssText);
          return sheet;
        });
      }
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...constructableSheets];
      return;
    }

    styles.forEach((cssText) => {
      const style = document.createElement('style');
      style.textContent = cssText;
      root.append(style);
    });
  };

  const ensureReactRoot = (): void => {
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
    }

    if (overlayRoot && !stylesInjected) {
      appendStylesToShadowRoot(overlayRoot, [overlayMantineStyles, overlayStyles]);
      stylesInjected = true;
    }

    if (!hostContainer) {
      hostContainer = document.createElement('div');
      hostContainer.id = OVERLAY_ROOT_ELEMENT_ID;
      overlayRoot!.append(hostContainer);
    }

    if (!reactRoot) {
      reactRoot = createRoot(hostContainer);
    }
  };

  const handlePopoverMount = (element: HTMLDivElement | null) => {
    popoverElement = element;
    if (element) {
      void updatePopoverPosition();
    }
  };

  const renderOverlay = (): void => {
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
        portalTarget: hostContainer,
        mantineRoot: hostContainer,
      }),
    );
  };

  const updatePopoverPosition = async (): Promise<void> => {
    if (!currentReferenceRect || !popoverElement) {
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

    popoverElement.hidden = false;
    popoverElement.setAttribute('data-apply-measuring', 'true');

    try {
      await nextFrame();
      const { x, y } = await computePosition(virtualReference as ReferenceElement, popoverElement, {
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
      popoverElement.removeAttribute('data-apply-measuring');
    }
  };

  const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  const setOverlayState = (nextState: OverlayRenderState): void => {
    overlayState = nextState;
    renderOverlay();
  };

  const updateOverlayState = (
    updater: (previous: OverlayRenderState) => OverlayRenderState,
  ): void => {
    const nextState = updater(overlayState);
    if (nextState === overlayState) {
      return;
    }
    setOverlayState(nextState);
  };

  if (registerBridge) {
    const bridge: OverlayBridge = {
      clearOverlay,
      showHighlight,
      showPrompt,
    };
    (window as unknown as Record<string, unknown>)[OVERLAY_BRIDGE_KEY] = bridge;
  }

  return {
    clearOverlay,
    showHighlight,
    showPrompt,
  };
}

function computeOverlayGeometry(target: HTMLElement, hostWindow: Window): OverlayGeometry | null {
  const ownerWindow = target.ownerDocument?.defaultView;
  if (!ownerWindow) {
    return null;
  }

  const rect = target.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let currentWindow: Window | null = ownerWindow;

  try {
    while (currentWindow && currentWindow !== hostWindow) {
      const frameElement = currentWindow.frameElement;
      if (!(frameElement instanceof HTMLElement)) {
        return null;
      }
      const frameRect = frameElement.getBoundingClientRect();
      left += frameRect.left;
      top += frameRect.top;
      const parentWindow: Window | null = currentWindow.parent;
      if (!parentWindow || parentWindow === currentWindow) {
        break;
      }
      currentWindow = parentWindow;
    }
  } catch {
    return null;
  }

  if (currentWindow !== hostWindow) {
    return null;
  }

  const referenceRect = new DOMRect(left, top, rect.width, rect.height);
  return {
    referenceRect,
    highlightRect: expandRect(referenceRect, 6),
  };
}

function computeFallbackGeometry(target: HTMLElement): OverlayGeometry {
  const rect = target.getBoundingClientRect();
  const referenceRect = new DOMRect(rect.left, rect.top, rect.width, rect.height);
  return {
    referenceRect,
    highlightRect: expandRect(referenceRect, 6),
  };
}

function expandRect(rect: DOMRectReadOnly, padding: number): HighlightRect {
  return {
    top: Math.max(rect.top - padding, 0),
    left: Math.max(rect.left - padding, 0),
    width: Math.max(rect.width + padding * 2, 0),
    height: Math.max(rect.height + padding * 2, 0),
  };
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
