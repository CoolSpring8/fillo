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
  autocomplete?: string;
  required: boolean;
  rect: FieldRect;
  frameId: number;
  frameUrl: string;
}

export interface PromptFillRequest {
  requestId: string;
  fieldId: string;
  frameId: number;
  value: string;
  preview: string;
  label: string;
  mode: 'fill' | 'click';
}

export type FillResultStatus = 'filled' | 'skipped' | 'failed';

export interface FillResultMessage {
  requestId: string;
  fieldId: string;
  status: FillResultStatus;
  frameId: number;
  reason?: string;
}
