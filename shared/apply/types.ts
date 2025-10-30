export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'select'
  | 'textarea'
  | 'checkbox'
  | 'radio'
  | 'file';

export interface FieldAttributes {
  tagName: string;
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface FieldRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ScannedField {
  id: string;
  kind: FieldKind;
  label: string;
  context: string;
  autocomplete?: string;
  required: boolean;
  rect: FieldRect;
  frameId: number;
  frameUrl: string;
  attributes?: FieldAttributes;
  hasValue: boolean;
}

import type { FieldSlot } from './slotTypes';

export type PromptOptionSlot = FieldSlot | `profile.${string}`;

export interface PromptOption {
  slot: PromptOptionSlot;
  label: string;
  value: string;
}

export interface PromptFieldState {
  id: string;
  label: string;
  kind: FieldKind;
  context: string;
  autocomplete?: string | null;
  required: boolean;
}

export interface PromptAiRequestInput {
  query: string;
  currentValue: string;
  suggestion?: string;
  selectedSlot?: PromptOptionSlot | null;
  matches: PromptOption[];
}

export interface PromptAiRequestOptions {
  signal?: AbortSignal;
}

export interface PromptAiResult {
  value: string;
  slot?: PromptOptionSlot | null;
}

export interface PromptPreviewRequest {
  previewId?: string;
  fieldId: string;
  frameId: number;
  label: string;
  preview?: string;
  value?: string;
  options?: PromptOption[];
  defaultSlot?: PromptOptionSlot | null;
  profileId?: string | null;
  field?: PromptFieldState;
}

export interface PromptAiSuggestMessage {
  kind: 'PROMPT_AI_SUGGEST';
  requestId: string;
  fieldId: string;
  frameId: number;
  field: PromptFieldState;
  query: string;
  currentValue: string;
  suggestion?: string;
  selectedSlot?: PromptOptionSlot | null;
  matches: PromptOption[];
  profileId?: string | null;
}

export interface PromptAiAbortMessage {
  kind: 'PROMPT_AI_ABORT';
  requestId: string;
  fieldId: string;
  frameId: number;
}

export type PromptAiSuggestResponse =
  | { status: 'ok'; value: string; slot?: PromptOptionSlot | null }
  | { status: 'error'; error: string }
  | { status: 'aborted' };

export interface PromptFillRequest {
  requestId: string;
  fieldId: string;
  frameId: number;
  label: string;
  mode: 'fill' | 'click' | 'auto';
  value?: string;
  preview?: string;
  options?: PromptOption[];
  defaultSlot?: PromptOptionSlot | null;
  profileId?: string | null;
  fieldKind?: FieldKind;
  fieldContext?: string;
  fieldAutocomplete?: string | null;
  fieldRequired?: boolean;
}

export type FillResultStatus = 'filled' | 'skipped' | 'failed';

export interface FillResultMessage {
  requestId: string;
  fieldId: string;
  status: FillResultStatus;
  frameId: number;
  reason?: string;
}
