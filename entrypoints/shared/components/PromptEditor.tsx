import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

  const setValue = useCallback(
    (next: string) => {
      if (!valueIsControlled) {
        setInternalValue(next);
      }
      onValueChange?.(next);
    },
    [valueIsControlled, onValueChange],
  );

  const setSelectedSlot = useCallback(
    (slot: PromptOptionSlot | null) => {
      if (!slotIsControlled) {
        setInternalSlot(slot);
      }
      onSlotChange?.(slot);
    },
    [slotIsControlled, onSlotChange],
  );

  const setInstructionValue = useCallback(
    (next: string) => {
      if (!instructionIsControlled) {
        setInternalInstruction(next);
      }
      onInstructionChange?.(next);
    },
    [instructionIsControlled, onInstructionChange],
  );

  const requestAi = useCallback(async (): Promise<PromptAiResult | null> => {
    if (!onRequestAi) {
      return null;
    }
    const trimmedInstruction = instructionValue.trim();
    const fallbackQuery = value.trim();
    const trimmedQuery = trimmedInstruction || fallbackQuery;
    if (!trimmedQuery) {
      throw new Error('query-missing');
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const selected = selectedSlot ? normalizedOptions.find((option) => option.slot === selectedSlot) : undefined;
      const suggestion = selected?.value ?? preview ?? '';
      const matches = matchPromptOptions(normalizedOptions, trimmedQuery);
      return await onRequestAi({
        query: trimmedQuery,
        currentValue: value,
        suggestion,
        selectedSlot,
        matches,
      });
    } finally {
      setAiLoading(false);
    }
  }, [instructionValue, value, onRequestAi, selectedSlot, normalizedOptions, preview]);

  const reset = useCallback(() => {
    if (!instructionIsControlled) {
      setInternalInstruction('');
    } else {
      onInstructionChange?.('');
    }
    setAiError(null);
    setAiLoading(false);
  }, [instructionIsControlled, onInstructionChange]);

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

function matchPromptOptions(options: PromptOption[], query: string, limit = 5): PromptOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const scored = options
    .map((option) => {
      const label = option.label.toLowerCase();
      const value = option.value.toLowerCase();
      const labelIndex = label.indexOf(normalizedQuery);
      const valueIndex = value.indexOf(normalizedQuery);
      const hasMatch = labelIndex >= 0 || valueIndex >= 0;
      const score = hasMatch ? Math.min(labelIndex >= 0 ? labelIndex : Infinity, valueIndex >= 0 ? valueIndex + 100 : Infinity) : Infinity;
      return {
        option,
        score,
      };
    })
    .filter(({ score }) => Number.isFinite(score));

  scored.sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map(({ option }) => option);
}
