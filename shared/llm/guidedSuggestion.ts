import type { FieldKind, PromptOptionSlot } from '../apply/types';
import { GUIDED_AI_SUGGESTION_SCHEMA, type GuidedAiSuggestion } from '../schema/guidedAiSuggestion';
import type { ProviderConfig } from '../types';
import { invokeWithProvider, type LlmInvocationOptions } from './runtime';

export interface GuidedSuggestionField {
  label: string;
  kind: FieldKind;
  context: string;
  autocomplete?: string | null;
  required: boolean;
}

export interface GuidedSuggestionRequest {
  provider: ProviderConfig | null | undefined;
  instruction: string;
  field: GuidedSuggestionField;
  slot: PromptOptionSlot | null;
  currentValue: string;
  suggestion: string;
  profile: unknown;
  signal?: LlmInvocationOptions['signal'];
}

export interface GuidedSuggestionResult {
  value: string;
  reason?: string;
}

export async function requestGuidedSuggestion({
  provider,
  instruction,
  field,
  slot,
  currentValue,
  suggestion,
  profile,
  signal,
}: GuidedSuggestionRequest): Promise<GuidedSuggestionResult> {
  const trimmedInstruction = instruction.trim();
  if (!trimmedInstruction) {
    throw new Error('Missing instruction');
  }

  const payload = {
    field: {
      label: field.label,
      kind: field.kind,
      context: field.context,
      autocomplete: field.autocomplete ?? null,
      required: field.required,
    },
    slot,
    currentValue,
    suggestion,
    instruction: trimmedInstruction,
    profile: profile ?? null,
  };

  const messages = [
    {
      role: 'system' as const,
      content:
        'You help job applicants fill out form fields using their resume data. ' +
        'Return a JSON object with keys "value" (string) and optional "reason" explaining your choice. ' +
        'Respect the provided instruction and prefer precise, professional values.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify(payload),
    },
  ];

  const raw = await invokeWithProvider(provider, messages, {
    responseSchema: GUIDED_AI_SUGGESTION_SCHEMA,
    temperature: 0.2,
    signal,
  });

  const trimmed = raw.trim();
  let proposed = trimmed;
  let reason: string | undefined;

  try {
    const parsed = JSON.parse(trimmed) as GuidedAiSuggestion;
    if (parsed && typeof parsed.value === 'string') {
      proposed = parsed.value;
      if (parsed.reason && typeof parsed.reason === 'string') {
        reason = parsed.reason;
      }
    }
  } catch {
    // Non-JSON response; fall back to raw text.
  }

  return {
    value: proposed,
    reason,
  };
}
