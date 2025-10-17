export type FieldSlot =
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'city'
  | 'country'
  | 'website'
  | 'linkedin'
  | 'github'
  | 'summary'
  | 'headline';

const slotSynonyms: Record<FieldSlot, RegExp[]> = {
  name: [/^name$/, /^full\s*name$/i, /^your\s*name$/i],
  firstName: [/^first\s*name$/i, /^given[-\s]?name$/i],
  lastName: [/^last\s*name$/i, /^family[-\s]?name$/i, /^surname$/i],
  email: [/^e[-\s]?mail$/i, /^email\s*address$/i],
  phone: [/^phone/i, /^mobile$/i, /^telephone$/i],
  city: [/^city$/i, /^town$/i],
  country: [/^country$/i],
  website: [/^website$/i, /^portfolio$/i, /^personal\s*site$/i],
  linkedin: [/^linkedin/i],
  github: [/^github/i],
  summary: [/^summary$/i, /^about\s+you$/i, /^bio$/i],
  headline: [/^headline$/i, /^current\s*role$/i, /^title$/i],
};

export function resolveSlotFromLabel(label: string): FieldSlot | null {
  const normalized = label.trim().toLowerCase();
  for (const [slot, patterns] of Object.entries(slotSynonyms) as [FieldSlot, RegExp[]][]) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return slot;
    }
  }
  return null;
}

export function resolveSlotFromAutocomplete(token: string | undefined): FieldSlot | null {
  if (!token) {
    return null;
  }

  const value = token.toLowerCase();
  if (value.includes('email')) return 'email';
  if (value.includes('given-name')) return 'firstName';
  if (value.includes('additional-name')) return 'name';
  if (value.includes('family-name')) return 'lastName';
  if (value.includes('tel')) return 'phone';
  if (value.includes('address-level2')) return 'city';
  if (value.includes('country')) return 'country';
  if (value.includes('url')) return 'website';
  if (value.includes('organization-title')) return 'headline';
  return null;
}
