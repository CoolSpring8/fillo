import type { FieldKind } from '../apply/types';
import type { PromptOptionSlot } from '../apply/types';

export interface FieldSignatureParts {
  labelNorm: string;
  kind: FieldKind;
  autocomplete?: string;
  name?: string;
  id?: string;
}

export interface MemoryAssociation {
  preferredSlot?: PromptOptionSlot | null;
  lastValue?: string | null;
  accepted?: number;
  rejected?: number;
  updatedAt: string;
  note?: string;
}

export type MemoryMap = Record<string, MemoryAssociation>;

