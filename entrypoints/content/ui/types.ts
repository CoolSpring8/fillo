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
  | { mode: 'hidden'; version: number }
  | { mode: 'highlight'; version: number; label: string }
  | { mode: 'prompt'; version: number; prompt: PromptOptions };

export interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface PopoverPosition {
  x: number;
  y: number;
  visible: boolean;
}
