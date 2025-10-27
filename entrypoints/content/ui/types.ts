import type { PromptOption, PromptOptionSlot } from '../../../shared/apply/types';

export interface PromptOptions {
  label: string;
  preview?: string;
  options?: PromptOption[];
  defaultSlot?: PromptOptionSlot | null;
  defaultValue?: string;
  onFill: (value: string, slot: PromptOptionSlot | null) => void;
  onSkip: () => void;
}

export type OverlayComponentState =
  | { mode: 'hidden' }
  | { mode: 'highlight'; label: string }
  | { mode: 'prompt'; prompt: PromptOptions };

export interface OverlayRenderState {
  component: OverlayComponentState;
  highlightRect: HighlightRect | null;
  popoverPosition: PopoverPosition | null;
}

export interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PopoverPosition {
  x: number;
  y: number;
}
