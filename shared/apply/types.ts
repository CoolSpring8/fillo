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
}

import type { FieldSlot } from './slots';

export interface PromptOption {
  slot: FieldSlot;
  label: string;
  value: string;
}

export interface PromptFillRequest {
  requestId: string;
  fieldId: string;
  frameId: number;
  label: string;
  mode: 'fill' | 'click' | 'auto';
  value?: string;
  preview?: string;
  options?: PromptOption[];
  defaultSlot?: FieldSlot | null;
}

export type FillResultStatus = 'filled' | 'skipped' | 'failed';

export interface FillResultMessage {
  requestId: string;
  fieldId: string;
  status: FillResultStatus;
  frameId: number;
  reason?: string;
}
