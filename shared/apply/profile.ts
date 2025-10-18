import type { ProfileRecord } from '../types';
import type { FieldSlot } from './slots';
import {
  coerceString,
  getValueByPath,
  normalizeDate,
  normalizeEnum,
  toPrimaryArray,
} from './value';

export type SlotValueMap = Partial<Record<FieldSlot, string>>;

interface SlotContext {
  profile: ProfileRecord;
  resume?: Record<string, unknown>;
  basics?: Record<string, unknown>;
  location?: Record<string, unknown>;
  work: Record<string, unknown>[];
  education: Record<string, unknown>[];
  custom?: Record<string, unknown>;
}

interface SlotDefinition {
  slot: FieldSlot;
  resolver: (context: SlotContext) => string | undefined;
}

const SLOT_DEFINITIONS: SlotDefinition[] = [
  { slot: 'name', resolver: ({ basics }) => readString(basics?.name) },
  {
    slot: 'firstName',
    resolver: ({ basics }) => deriveNameParts(basics).firstName,
  },
  {
    slot: 'lastName',
    resolver: ({ basics }) => deriveNameParts(basics).lastName,
  },
  { slot: 'headline', resolver: ({ basics }) => readString(basics?.label) },
  { slot: 'summary', resolver: ({ basics }) => readString(basics?.summary) },
  { slot: 'email', resolver: ({ basics }) => readString(basics?.email) },
  { slot: 'phone', resolver: ({ basics }) => readString(basics?.phone) },
  { slot: 'website', resolver: ({ basics }) => readString(basics?.url) },
  {
    slot: 'address',
    resolver: ({ location }) =>
      readString(location?.address) ??
      joinLocation([location?.address, location?.streetAddress]),
  },
  { slot: 'city', resolver: ({ location }) => readString(location?.city) },
  { slot: 'state', resolver: ({ location }) => readString(location?.region ?? location?.state) },
  { slot: 'country', resolver: ({ location }) => readString(location?.country) },
  { slot: 'postalCode', resolver: ({ location }) => readString(location?.postalCode ?? location?.zip) },
  {
    slot: 'birthDate',
    resolver: ({ basics }) => normalizeDate(basics?.birthdate ?? basics?.birthday),
  },
  {
    slot: 'gender',
    resolver: ({ basics }) =>
      normalizeEnum(basics?.gender, 'gender') ?? readString(basics?.gender),
  },
  {
    slot: 'linkedin',
    resolver: ({ basics }) => collectProfiles(toPrimaryArray(basics?.profiles)).linkedin,
  },
  {
    slot: 'github',
    resolver: ({ basics }) => collectProfiles(toPrimaryArray(basics?.profiles)).github,
  },
  {
    slot: 'currentCompany',
    resolver: ({ work }) => coerceString(getValueByPath(work, '0.name')),
  },
  {
    slot: 'currentTitle',
    resolver: ({ work }) => coerceString(getValueByPath(work, '0.position') ?? getValueByPath(work, '0.title')),
  },
  {
    slot: 'currentLocation',
    resolver: ({ work }) => composeLocation(extractObject(getValueByPath(work, '0.location'))),
  },
  {
    slot: 'currentStartDate',
    resolver: ({ work }) => normalizeDate(getValueByPath(work, '0.startDate')),
  },
  {
    slot: 'currentEndDate',
    resolver: ({ work }) => normalizeDate(getValueByPath(work, '0.endDate')),
  },
  {
    slot: 'educationSchool',
    resolver: ({ education }) =>
      coerceString(getValueByPath(education, '0.institution') ?? getValueByPath(education, '0.school')),
  },
  {
    slot: 'educationDegree',
    resolver: ({ education }) =>
      coerceString(getValueByPath(education, '0.studyType') ?? getValueByPath(education, '0.degree')),
  },
  {
    slot: 'educationField',
    resolver: ({ education }) =>
      coerceString(getValueByPath(education, '0.area') ?? getValueByPath(education, '0.major')),
  },
  {
    slot: 'educationStartDate',
    resolver: ({ education }) => normalizeDate(getValueByPath(education, '0.startDate')),
  },
  {
    slot: 'educationEndDate',
    resolver: ({ education }) => normalizeDate(getValueByPath(education, '0.endDate')),
  },
  {
    slot: 'educationGpa',
    resolver: ({ education }) => coerceString(getValueByPath(education, '0.score') ?? getValueByPath(education, '0.gpa')),
  },
  {
    slot: 'expectedSalary',
    resolver: ({ basics, custom }) =>
      coerceString(basics?.expectedSalary ?? basics?.salary ?? custom?.expectedSalary ?? custom?.salaryExpectation),
  },
  {
    slot: 'preferredLocation',
    resolver: ({ basics, custom }) => composeLocation(extractObject(custom?.preferredLocation) ?? extractObject(basics?.location)),
  },
  {
    slot: 'availabilityDate',
    resolver: ({ basics, custom }) =>
      normalizeDate(basics?.availabilityDate ?? basics?.startDate ?? custom?.availabilityDate),
  },
  {
    slot: 'jobType',
    resolver: ({ basics, custom }) =>
      normalizeEnum(basics?.employmentType ?? basics?.jobType ?? custom?.jobType, 'jobType') ??
      coerceString(basics?.employmentType ?? basics?.jobType ?? custom?.jobType),
  },
  {
    slot: 'skills',
    resolver: ({ resume }) => {
      const entries = toPrimaryArray(resume?.skills).map((entry) => extractObject(entry));
      if (entries.length === 0) {
        return undefined;
      }
      const tokens = entries
        .map((entry) => {
          if (!entry) {
            return undefined;
          }
          const name = coerceString(entry.name);
          const keywords = Array.isArray(entry.keywords)
            ? (entry.keywords as unknown[]).map((item) => coerceString(item)).filter(Boolean)
            : [];
          const combined = [name, ...keywords].filter(Boolean) as string[];
          if (combined.length === 0) {
            return undefined;
          }
          return combined.join(', ');
        })
        .filter(Boolean);
      if (tokens.length === 0) {
        return undefined;
      }
      return tokens.join(' | ');
    },
  },
];

export function buildSlotValues(profile: ProfileRecord | null | undefined): SlotValueMap {
  if (!profile) {
    return {};
  }

  const resume = extractObject(profile.resume);
  const basics = extractObject(resume?.basics);
  const location = extractObject(basics?.location);
  const work = toPrimaryArray(resume?.work).map((entry) => extractObject(entry) ?? {});
  const education = toPrimaryArray(resume?.education).map((entry) => extractObject(entry) ?? {});
  const custom = extractObject(profile.custom);

  const context: SlotContext = {
    profile,
    resume,
    basics,
    location,
    work,
    education,
    custom,
  };

  const slots: SlotValueMap = {};

  for (const definition of SLOT_DEFINITIONS) {
    if (slots[definition.slot]) {
      continue;
    }
    const value = definition.resolver(context);
    if (value) {
      slots[definition.slot] = value;
    }
  }

  return slots;
}

function extractObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function deriveNameParts(basics: Record<string, unknown> | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const result: { firstName?: string; lastName?: string } = {};
  if (!basics) {
    return result;
  }

  const firstName = readString(
    basics['firstName'] ?? basics['givenName'] ?? basics['given_name'] ?? basics['first_name'],
  );
  const lastName = readString(
    basics['lastName'] ??
      basics['familyName'] ??
      basics['family_name'] ??
      basics['surname'] ??
      basics['last_name'],
  );
  if (firstName) {
    result.firstName = firstName;
  }
  if (lastName) {
    result.lastName = lastName;
  }

  if (!result.firstName || !result.lastName) {
    const name = readString(basics['name']);
    if (name) {
      const parts = name.trim().split(/\s+/);
      if (parts.length > 0 && !result.firstName) {
        result.firstName = parts[0];
      }
      if (parts.length > 1 && !result.lastName) {
        result.lastName = parts[parts.length - 1];
      }
    }
  }

  return result;
}

function collectProfiles(entries: unknown[]): { linkedin?: string; github?: string } {
  const result: { linkedin?: string; github?: string } = {};
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const network = readString(record.network)?.toLowerCase();
    const url = readString(record.url) ?? buildProfileUrl(record);
    if (!network || !url) {
      continue;
    }
    if (!result.linkedin && network.includes('linkedin')) {
      result.linkedin = url;
    } else if (!result.github && network.includes('github')) {
      result.github = url;
    }
  }
  return result;
}

function buildProfileUrl(record: Record<string, unknown>): string | undefined {
  const network = readString(record.network);
  const username = readString(record.username ?? record.user ?? record.handle);
  if (!network || !username) {
    return undefined;
  }
  const lower = network.toLowerCase();
  if (lower.includes('linkedin')) {
    return `https://www.linkedin.com/in/${username.replace(/^\//, '')}`;
  }
  if (lower.includes('github')) {
    return `https://github.com/${username.replace(/^\//, '')}`;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function joinLocation(parts: Array<unknown>): string | undefined {
  const tokens = parts
    .map((part) => coerceString(part))
    .filter(Boolean) as string[];
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.join(', ');
}

function composeLocation(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }
  const tokens = [
    coerceString(record.city),
    coerceString(record.region ?? record.state),
    coerceString(record.country),
  ].filter(Boolean) as string[];
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.join(', ');
}
