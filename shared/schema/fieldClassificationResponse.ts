import type { FieldSlot } from '../apply/slots';

const KNOWN_SLOTS: readonly FieldSlot[] = [
  'name',
  'firstName',
  'lastName',
  'email',
  'phone',
  'city',
  'country',
  'state',
  'postalCode',
  'address',
  'birthDate',
  'gender',
  'website',
  'linkedin',
  'github',
  'summary',
  'headline',
  'currentCompany',
  'currentTitle',
  'currentLocation',
  'currentStartDate',
  'currentEndDate',
  'educationSchool',
  'educationDegree',
  'educationField',
  'educationStartDate',
  'educationEndDate',
  'educationGpa',
  'expectedSalary',
  'preferredLocation',
  'availabilityDate',
  'jobType',
  'skills',
] as const;

const FALLBACK_SLOTS = ['unknown', 'other'] as const;

export const FIELD_CLASSIFICATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          slot: { enum: [...KNOWN_SLOTS, ...FALLBACK_SLOTS] },
          reason: { type: 'string' },
        },
        required: ['id', 'slot'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

export type ClassificationSlotResponse = FieldSlot | (typeof FALLBACK_SLOTS)[number];

export const CLASSIFICATION_KNOWN_SLOTS = KNOWN_SLOTS;
