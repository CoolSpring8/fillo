import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  PromptAiRequestInput,
  PromptAiResult,
  PromptOption,
  PromptOptionSlot,
} from '../../../shared/apply/types';

interface PromptEditorProps {
  options?: PromptOption[];
  defaultSlot?: PromptOptionSlot | null;
  defaultValue?: string;
  preview?: string;
  value?: string;
  selectedSlot?: PromptOptionSlot | null;
  onValueChange?: (value: string) => void;
  onSlotChange?: (slot: PromptOptionSlot | null) => void;
  instruction?: string;
  onInstructionChange?: (value: string) => void;
  onRequestAi?: (input: PromptAiRequestInput) => Promise<PromptAiResult | null>;
  children: (state: PromptEditorState) => ReactNode;
}

export interface PromptEditorState {
  value: string;
  setValue: (value: string) => void;
  selectedSlot: PromptOptionSlot | null;
  setSelectedSlot: (slot: PromptOptionSlot | null) => void;
  options: PromptOption[];
  instruction: string;
  setInstruction: (value: string) => void;
  aiLoading: boolean;
  aiError: string | null;
  setAiError: (message: string | null) => void;
  requestAi: () => Promise<PromptAiResult | null>;
  reset: () => void;
  defaultSlot?: PromptOptionSlot | null;
  defaultValue?: string;
  preview?: string;
}

export function PromptEditor({
  options,
  defaultSlot,
  defaultValue,
  preview,
  value: controlledValue,
  selectedSlot: controlledSlot,
  onValueChange,
  onSlotChange,
  instruction: controlledInstruction,
  onInstructionChange,
  onRequestAi,
  children,
}: PromptEditorProps) {
  const normalizedOptions = useMemo(() => options ?? [], [options]);
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? preview ?? '');
  const [internalSlot, setInternalSlot] = useState<PromptOptionSlot | null>(defaultSlot ?? null);
  const [internalInstruction, setInternalInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const valueIsControlled = controlledValue !== undefined;
  const slotIsControlled = controlledSlot !== undefined;
  const instructionIsControlled = controlledInstruction !== undefined;

  useEffect(() => {
    let slot: PromptOptionSlot | null = defaultSlot ?? null;
    let nextValue = defaultValue ?? preview ?? '';

    if (normalizedOptions.length > 0) {
      const existing = slot ? normalizedOptions.find((option) => option.slot === slot) : undefined;
      if (existing) {
        nextValue = existing.value;
      } else if (!nextValue && normalizedOptions.length === 1) {
        slot = normalizedOptions[0].slot;
        nextValue = normalizedOptions[0].value;
      }
    }

    if (!slotIsControlled) {
      setInternalSlot(slot);
    }
    if (!valueIsControlled) {
      setInternalValue(nextValue);
    }
    if (!instructionIsControlled) {
      setInternalInstruction('');
    } else {
      onInstructionChange?.('');
    }
    setAiError(null);
    setAiLoading(false);
  }, [
    defaultSlot,
    defaultValue,
    preview,
    normalizedOptions,
    slotIsControlled,
    valueIsControlled,
    instructionIsControlled,
    onInstructionChange,
  ]);

  const value = valueIsControlled ? controlledValue ?? '' : internalValue;
  const selectedSlot = slotIsControlled ? controlledSlot ?? null : internalSlot;
  const instructionValue = instructionIsControlled ? controlledInstruction ?? '' : internalInstruction;

  const setValue = (next: string) => {
    if (!valueIsControlled) {
      setInternalValue(next);
    }
    onValueChange?.(next);
  };

  const setSelectedSlot = (slot: PromptOptionSlot | null) => {
    if (!slotIsControlled) {
      setInternalSlot(slot);
    }
    onSlotChange?.(slot);
  };

  const setInstructionValue = (next: string) => {
    if (!instructionIsControlled) {
      setInternalInstruction(next);
    }
    onInstructionChange?.(next);
  };

  const requestAi = async (): Promise<PromptAiResult | null> => {
    if (!onRequestAi) {
      return null;
    }
    const trimmedInstruction = instructionValue.trim();
    if (!trimmedInstruction) {
      throw new Error('instruction-missing');
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const selected = selectedSlot ? normalizedOptions.find((option) => option.slot === selectedSlot) : undefined;
      const suggestion = selected?.value ?? preview ?? '';
      return await onRequestAi({
        instruction: trimmedInstruction,
        currentValue: value,
        suggestion,
        selectedSlot,
      });
    } finally {
      setAiLoading(false);
    }
  };

  const reset = () => {
    if (!instructionIsControlled) {
      setInternalInstruction('');
    } else {
      onInstructionChange?.('');
    }
    setAiError(null);
    setAiLoading(false);
  };

  return (
    <>
      {children({
        value,
        setValue,
        selectedSlot,
        setSelectedSlot,
        options: normalizedOptions,
        instruction: instructionValue,
        setInstruction: setInstructionValue,
        aiLoading,
        aiError,
        setAiError,
        requestAi,
        reset,
        defaultSlot,
        defaultValue,
        preview,
      })}
    </>
  );
}
