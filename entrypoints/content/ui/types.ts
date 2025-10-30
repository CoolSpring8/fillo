import type {
  PromptAiRequestInput,
  PromptAiResult,
  PromptAiRequestOptions,
  PromptFieldState,
  PromptOption,
  PromptOptionSlot,
} from '../../../shared/apply/types';

export interface PromptOptions {
  requestId: string;
  label: string;
  preview?: string;
  options?: PromptOption[];
  defaultSlot?: PromptOptionSlot | null;
  defaultValue?: string;
  field?: PromptFieldState;
  profileId?: string | null;
  scrollIntoView?: boolean;
  onFill: (value: string, slot: PromptOptionSlot | null) => void;
  onSkip: () => void;
  onRequestAi?: (
    input: PromptAiRequestInput,
    options?: PromptAiRequestOptions,
  ) => Promise<PromptAiResult | null>;
}

export type OverlayComponentState =
  | { mode: 'hidden' }
  | { mode: 'highlight'; label: string }
  | { mode: 'prompt'; prompt: PromptOptions };

export interface OverlayRenderState {
  component: OverlayComponentState;
  highlightRect: HighlightRect | null;
  popoverPosition: PopoverPosition | null;
  showHighlight: boolean;
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
