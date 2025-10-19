import type { ScannedField } from '../../shared/apply/types';
import { AUTO_FILL_DECISION_SCHEMA } from '../../shared/schema/autoFillDecision';

interface LanguageModel {
  create: () => Promise<LanguageModelSession>;
}

interface LanguageModelSession {
  prompt: (input: string, options?: Record<string, unknown>) => Promise<string>;
  destroy?: () => void;
}

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

export function hasAutoFillModel(): boolean {
  return Boolean(getLanguageModel());
}

export async function judgeAutoFill(payload: AutoFillPromptPayload): Promise<AutoFillDecision | null> {
  const model = getLanguageModel();
  if (!model) {
    return null;
  }

  let session: LanguageModelSession | undefined;
  try {
    session = await model.create();
  } catch (error) {
    console.warn('Unable to create on-device session for auto fill', error);
    return null;
  }

  try {
    const prompt = formatMessages([
      {
        role: 'system',
        content:
          'You select which resume data key should fill an HTML form field. ' +
          'Output only JSON matching {"decision":"fill"|"reject","key":string,"reason":string,"confidence":number}. ' +
          'Only return keys from the provided list. Never invent new keys or return actual user data. ' +
          'If unsure, choose "reject".',
      },
      {
        role: 'user',
        content: buildUserContent(payload),
      },
    ]);

    const raw = await session.prompt(prompt, {
      responseConstraint: AUTO_FILL_DECISION_SCHEMA,
      temperature: 0,
    });

    return parseDecision(raw);
  } catch (error) {
    console.warn('Auto fill model decision failed', error);
    return null;
  } finally {
    session?.destroy?.();
  }
}

function getLanguageModel(): LanguageModel | undefined {
  const win = window as unknown as {
    LanguageModel?: LanguageModel;
    ai?: { languageModel?: LanguageModel };
  };
  return win.LanguageModel ?? win.ai?.languageModel;
}

function formatMessages(messages: { role: 'system' | 'user'; content: string }[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');
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

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
