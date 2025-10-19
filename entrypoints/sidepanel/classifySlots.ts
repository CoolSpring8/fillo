import type { FieldSlot } from '../../shared/apply/slotTypes';
import {
  CLASSIFICATION_KNOWN_SLOTS,
  FIELD_CLASSIFICATION_RESPONSE_SCHEMA,
  type ClassificationSlotResponse,
} from '../../shared/schema/fieldClassificationResponse';
import type { ProviderConfig } from '../../shared/types';
import { invokeWithProvider } from '../../shared/llm/runtime';
import {
  NoProviderConfiguredError,
  ProviderAvailabilityError,
  ProviderConfigurationError,
  ProviderInvocationError,
} from '../../shared/llm/errors';

export interface FieldDescriptor {
  id: string;
  label: string;
  type: string;
  autocomplete?: string | null;
  required?: boolean;
}

export interface FieldClassification {
  slot?: FieldSlot;
  reason?: string;
}

function chunkDescriptors(descriptors: FieldDescriptor[], size: number): FieldDescriptor[][] {
  if (descriptors.length <= size) {
    return [descriptors];
  }
  const batches: FieldDescriptor[][] = [];
  for (let index = 0; index < descriptors.length; index += size) {
    batches.push(descriptors.slice(index, index + size));
  }
  return batches;
}

function parseSlot(slot: ClassificationSlotResponse): FieldSlot | undefined {
  if ((CLASSIFICATION_KNOWN_SLOTS as readonly string[]).includes(slot)) {
    return slot as FieldSlot;
  }
  return undefined;
}

export async function classifyFieldDescriptors(
  provider: ProviderConfig | null | undefined,
  descriptors: FieldDescriptor[],
): Promise<Map<string, FieldClassification>> {
  if (descriptors.length === 0) {
    return new Map();
  }

  if (!provider) {
    throw new NoProviderConfiguredError();
  }

  const batches = chunkDescriptors(descriptors, 12);
  const result = new Map<string, FieldClassification>();

  for (const batch of batches) {
    try {
      const messages = [
        {
          role: 'system' as const,
          content:
            'You map job application form fields to canonical resume slots. ' +
            'Only respond with JSON strictly matching the provided schema. ' +
            'Use field semantics, HTML input type, and autocomplete hints. ' +
            'If uncertain, return slot "unknown". Prefer given-name / family-name when available.',
        },
        {
          role: 'user' as const,
          content: JSON.stringify({
            fields: batch.map((descriptor) => ({
              id: descriptor.id,
              label: descriptor.label,
              type: descriptor.type,
              autocomplete: descriptor.autocomplete ?? null,
              required: Boolean(descriptor.required),
            })),
          }),
        },
      ];

      const raw = await invokeWithProvider(provider, messages, {
        responseSchema: FIELD_CLASSIFICATION_RESPONSE_SCHEMA,
        temperature: 0,
      });

      const parsed = JSON.parse(raw) as {
        results?: Array<{ id?: string; slot?: ClassificationSlotResponse; reason?: string }>;
      };

      if (!Array.isArray(parsed.results)) {
        continue;
      }

      for (const entry of parsed.results) {
        if (!entry?.id || typeof entry.slot !== 'string') {
          continue;
        }
        const slot = parseSlot(entry.slot as ClassificationSlotResponse);
        if (!slot) {
          continue;
        }
        result.set(entry.id, {
          slot,
          reason: typeof entry.reason === 'string' ? entry.reason : undefined,
        });
      }
    } catch (error) {
      if (
        error instanceof NoProviderConfiguredError ||
        error instanceof ProviderConfigurationError ||
        error instanceof ProviderAvailabilityError ||
        error instanceof ProviderInvocationError
      ) {
        throw error;
      }
      console.warn('Field classification failed', error);
    }
  }

  return result;
}
