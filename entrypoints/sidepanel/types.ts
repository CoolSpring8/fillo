import type { PromptOptionSlot, ScannedField } from '../../shared/apply/types';
import type { FieldSlot } from '../../shared/apply/slotTypes';

export type FieldStatus = 'idle' | 'pending' | 'filled' | 'skipped' | 'failed';

export interface FieldEntry {
  field: ScannedField;
  slot: FieldSlot | null;
  selectedSlot: PromptOptionSlot | null;
  suggestion?: string;
  manualValue: string;
  status: FieldStatus;
  reason?: string;
  slotSource: 'heuristic' | 'model' | 'unset';
  slotNote?: string;
  autoKey?: string;
  autoKeyLabel?: string;
  autoNote?: string;
  autoConfidence?: number;
}

export interface ViewState {
  loadingProfiles: boolean;
  error?: string;
}
