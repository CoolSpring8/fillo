export type EnumKind =
  | 'gender'
  | 'maritalStatus'
  | 'educationLevel'
  | 'experienceLevel'
  | 'jobType';

const ENUM_TABLE: Record<EnumKind, Record<string, string>> = {
  gender: {
    male: 'male',
    m: 'male',
    man: 'male',
    男: 'male',
    female: 'female',
    f: 'female',
    woman: 'female',
    女: 'female',
    other: 'other',
    unspecified: 'other',
  },
  maritalStatus: {
    single: 'single',
    unmarried: 'single',
    未婚: 'single',
    married: 'married',
    已婚: 'married',
    divorced: 'divorced',
  },
  educationLevel: {
    doctoral: 'doctoral',
    phd: 'doctoral',
    doctor: 'doctoral',
    "master's": 'masters',
    master: 'masters',
    masters: 'masters',
    postgraduate: 'masters',
    "bachelor's": 'bachelors',
    bachelor: 'bachelors',
    university: 'bachelors',
    college: 'bachelors',
    associate: 'associate',
    diploma: 'associate',
    highschool: 'highschool',
    'high school': 'highschool',
  },
  experienceLevel: {
    intern: 'internship',
    internship: 'internship',
    entry: 'entry',
    junior: 'entry',
    mid: 'mid',
    senior: 'senior',
    lead: 'lead',
    manager: 'management',
    director: 'management',
  },
  jobType: {
    fulltime: 'full-time',
    'full time': 'full-time',
    全职: 'full-time',
    parttime: 'part-time',
    'part time': 'part-time',
    兼职: 'part-time',
    contract: 'contract',
    freelance: 'contract',
    temporary: 'contract',
    internship: 'internship',
  },
};

export function getValueByPath<T = unknown>(source: unknown, path: string): T | undefined {
  if (!source || typeof path !== 'string' || !path.trim()) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(source as Record<string, unknown>, path)) {
    return (source as Record<string, unknown>)[path] as T;
  }
  const normalized = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: any = source;
  for (const key of normalized) {
    if (current == null) {
      return undefined;
    }
    current = current[key];
  }
  return current as T | undefined;
}

export function normalizeDate(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const sanitized = trimmed.replace(/[./]/g, '-').replace(/\s+/g, '-').toLowerCase();
  if (/^\d{4}$/.test(sanitized)) {
    return `${sanitized}-01-01`;
  }
  const yearMonthMatch = sanitized.match(/^(\d{4})-(\d{1,2})$/);
  if (yearMonthMatch) {
    return `${yearMonthMatch[1]}-${pad(yearMonthMatch[2])}-01`;
  }
  const fullMatch = sanitized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (fullMatch) {
    return `${fullMatch[1]}-${pad(fullMatch[2])}-${pad(fullMatch[3])}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDate(parsed);
  }
  return undefined;
}

export function normalizeEnum(value: unknown, kind: EnumKind): string | undefined {
  if (!value) {
    return undefined;
  }
  const table = ENUM_TABLE[kind];
  if (!table) {
    return undefined;
  }
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
    return table[key];
  }
  return undefined;
}

export function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function toPrimaryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return [value];
  }
  return [];
}

export function extractFirst<T>(value: unknown): T | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? (value[0] as T) : undefined;
  }
  return value as T;
}

function pad(value: string | undefined): string {
  if (!value) {
    return '01';
  }
  const normalized = value.replace(/\D/g, '');
  if (!normalized) {
    return '01';
  }
  return normalized.length === 1 ? `0${normalized}` : normalized.slice(0, 2);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
