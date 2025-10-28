import type { FieldKind, PromptOption, PromptOptionSlot } from '../apply/types';
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
  query: string;
  field: GuidedSuggestionField;
  slot: PromptOptionSlot | null;
  currentValue: string;
  suggestion: string;
  matches: PromptOption[];
  profile: unknown;
  signal?: LlmInvocationOptions['signal'];
}

export interface GuidedSuggestionResult {
  value: string;
}

export async function requestGuidedSuggestion({
  provider,
  query,
  field,
  slot,
  currentValue,
  suggestion,
  matches,
  profile,
  signal,
}: GuidedSuggestionRequest): Promise<GuidedSuggestionResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error('Missing query');
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
    query: trimmedQuery,
    profile: profile ?? null,
    matches,
  };

  const messages = [
    {
      role: 'system' as const,
      content:
        'You help job applicants fill out form fields using their resume data. ' +
        'Return a JSON object with a single key "value" (string) representing the completed field value. ' +
        'Read the user query and provided matches, prefer precise professional wording, and avoid explanations.',
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

  try {
    const parsed = JSON.parse(trimmed) as GuidedAiSuggestion;
    if (parsed && typeof parsed.value === 'string') {
      proposed = parsed.value;
    }
  } catch {
    // Non-JSON response; fall back to raw text.
  }

  return {
    value: proposed,
  };
}
