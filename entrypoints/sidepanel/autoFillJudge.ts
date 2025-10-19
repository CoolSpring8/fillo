import type { ScannedField } from '../../shared/apply/types';
import { AUTO_FILL_DECISION_SCHEMA } from '../../shared/schema/autoFillDecision';
import type { ProviderConfig } from '../../shared/types';
import { invokeWithProvider } from '../../shared/llm/runtime';
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../../shared/llm/errors';

export interface AutoFillKey {
  key: string;
  label: string;
}

export interface AutoFillDecision {
  decision: 'fill' | 'reject';
  key?: string;
  reason?: string;
  confidence?: number;
}

export interface AutoFillPromptPayload {
  field: ScannedField;
  keys: AutoFillKey[];
  usedKeys: string[];
  round: number;
}

export function hasAutoFillModel(provider: ProviderConfig | null | undefined): boolean {
  if (!provider) {
    return false;
  }
  if (provider.kind === 'openai') {
    return Boolean(provider.apiKey?.trim() && provider.model?.trim());
  }
  return true;
}

export async function judgeAutoFill(
  provider: ProviderConfig | null | undefined,
  payload: AutoFillPromptPayload,
): Promise<AutoFillDecision | null> {
  if (!provider) {
    throw new NoProviderConfiguredError();
  }

  const messages = [
    {
      role: 'system' as const,
      content:
        'You select which resume data key should fill an HTML form field. ' +
        'Output only JSON matching {"decision":"fill"|"reject","key":string,"reason":string,"confidence":number}. ' +
        'Only return keys from the provided list. Never invent new keys or return actual user data. ' +
        'If unsure, choose "reject".',
    },
    {
      role: 'user' as const,
      content: buildUserContent(payload),
    },
  ];

  try {
    const raw = await invokeWithProvider(provider, messages, {
      responseSchema: AUTO_FILL_DECISION_SCHEMA,
      temperature: 0,
    });
    return parseDecision(raw);
  } catch (error) {
    if (
      error instanceof NoProviderConfiguredError ||
      error instanceof ProviderConfigurationError ||
      error instanceof ProviderAvailabilityError ||
      error instanceof ProviderInvocationError
    ) {
      throw error;
    }
    console.warn('Auto fill model decision failed', error);
    return null;
  }
}

function buildUserContent(payload: AutoFillPromptPayload): string {
  const { field } = payload;
  const contextEntries = buildContextEntries(field.context);
  const fieldSummary = {
    label: truncate(field.label, 120),
    kind: field.kind,
    required: field.required,
    autocomplete: field.autocomplete ?? null,
    context: contextEntries,
    attributes: summarizeAttributes(field),
    hasValue: Boolean(field.hasValue),
  };

  const result = {
    schema: 'apply-pilot.autofill/v1',
    round: payload.round,
    field: fieldSummary,
    availableKeys: payload.keys.map((key) => ({
      key: key.key,
      label: truncate(key.label, 120),
    })),
    usedKeys: payload.usedKeys,
  };

  return JSON.stringify(result);
}

function buildContextEntries(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function summarizeAttributes(field: ScannedField): Record<string, unknown> | undefined {
  const attributes = field.attributes;
  if (!attributes) {
    return undefined;
  }
  const summary: Record<string, unknown> = {
    tagName: attributes.tagName,
  };
  if (attributes.type) {
    summary.type = attributes.type;
  }
  if (attributes.name) {
    summary.name = attributes.name;
  }
  if (attributes.id) {
    summary.id = attributes.id;
  }
  if (attributes.placeholder) {
    summary.placeholder = truncate(attributes.placeholder, 160);
  }
  if (attributes.ariaLabel) {
    summary.ariaLabel = truncate(attributes.ariaLabel, 160);
  }
  if (typeof attributes.maxLength === 'number') {
    summary.maxLength = attributes.maxLength;
  }
  if (Array.isArray(attributes.options) && attributes.options.length > 0) {
    summary.options = attributes.options.slice(0, 8).map((option) => ({
      value: truncate(option.value ?? '', 60),
      label: truncate(option.label ?? '', 60),
    }));
  }
  return summary;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}

function parseDecision(raw: string): AutoFillDecision | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AutoFillDecision>;
    if (parsed.decision === 'fill') {
      const key = typeof parsed.key === 'string' ? parsed.key.trim() : '';
      if (!key) {
        return null;
      }
      return {
        decision: 'fill',
        key,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        confidence: typeof parsed.confidence === 'number' ? clampConfidence(parsed.confidence) : undefined,
      };
    }
    if (parsed.decision === 'reject') {
      return {
        decision: 'reject',
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        confidence: typeof parsed.confidence === 'number' ? clampConfidence(parsed.confidence) : undefined,
      };
    }
  } catch (error) {
    console.warn('Failed to parse auto fill decision', error);
  }
  return null;
}

function clampConfidence(raw: number): number {
  if (Number.isNaN(raw)) {
    return 0;
  }
  if (raw < 0) {
    return 0;
  }
  if (raw > 1) {
    return 1;
  }
  return raw;
}

