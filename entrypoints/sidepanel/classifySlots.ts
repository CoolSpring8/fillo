import type { FieldSlot } from '../../shared/apply/slots';
import {
  CLASSIFICATION_KNOWN_SLOTS,
  FIELD_CLASSIFICATION_RESPONSE_SCHEMA,
  type ClassificationSlotResponse,
} from '../../shared/schema/fieldClassificationResponse';

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

interface LanguageModel {
  create: () => Promise<LanguageModelSession>;
}

interface LanguageModelSession {
  prompt: (input: string, options?: Record<string, unknown>) => Promise<string>;
  destroy?: () => void;
}

function getLanguageModel(): LanguageModel | undefined {
  const lm = (window as unknown as { LanguageModel?: LanguageModel; ai?: { languageModel?: LanguageModel } })
    .LanguageModel;
  if (lm) {
    return lm;
  }
  return (window as unknown as { ai?: { languageModel?: LanguageModel } }).ai?.languageModel;
}

function formatMessages(messages: { role: 'system' | 'user'; content: string }[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');
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
  descriptors: FieldDescriptor[],
): Promise<Map<string, FieldClassification>> {
  if (descriptors.length === 0) {
    return new Map();
  }

  const model = getLanguageModel();
  if (!model) {
    return new Map();
  }

  const batches = chunkDescriptors(descriptors, 12);
  const result = new Map<string, FieldClassification>();

  for (const batch of batches) {
    let session: LanguageModelSession | undefined;
    try {
      session = await model.create();
      const prompt = formatMessages([
        {
          role: 'system',
          content:
            'You map job application form fields to canonical resume slots. ' +
            'Only respond with JSON strictly matching the provided schema. ' +
            'Use field semantics, HTML input type, and autocomplete hints. ' +
            'If uncertain, return slot "unknown". Prefer given-name / family-name when available.',
        },
        {
          role: 'user',
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
      ]);

      const raw = await session.prompt(prompt, {
        responseConstraint: FIELD_CLASSIFICATION_RESPONSE_SCHEMA,
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
      console.warn('Field classification failed', error);
    } finally {
      session?.destroy?.();
    }
  }

  return result;
}
