import type { ProfileRecord } from '../types';
import type { FieldSlot } from './slots';

export type SlotValueMap = Partial<Record<FieldSlot, string>>;

export function buildSlotValues(profile: ProfileRecord | null | undefined): SlotValueMap {
  if (!profile) {
    return {};
  }

  const slots: SlotValueMap = {};
  const resume = extractObject(profile.resume);
  const basics = extractObject(resume?.['basics']);

  if (typeof basics?.name === 'string') {
    slots.name = basics.name.trim();
  }

  if (typeof basics?.label === 'string') {
    slots.headline = basics.label.trim();
  }

  if (typeof basics?.summary === 'string') {
    slots.summary = basics.summary.trim();
  }

  if (typeof basics?.email === 'string') {
    slots.email = basics.email.trim();
  }

  if (typeof basics?.phone === 'string') {
    slots.phone = basics.phone.trim();
  }

  if (typeof basics?.url === 'string') {
    slots.website = basics.url.trim();
  }

  const location = extractObject(basics?.['location']);
  if (typeof location?.city === 'string') {
    slots.city = location.city.trim();
  }
  if (typeof location?.country === 'string') {
    slots.country = location.country.trim();
  }

  const nameParts = deriveNameParts(basics);
  if (nameParts.firstName && !slots.firstName) {
    slots.firstName = nameParts.firstName;
  }
  if (nameParts.lastName && !slots.lastName) {
    slots.lastName = nameParts.lastName;
  }

  const profiles = Array.isArray(basics?.['profiles']) ? (basics?.['profiles'] as unknown[]) : [];
  const profileUrls = collectProfiles(profiles);
  if (profileUrls.linkedin) {
    slots.linkedin = profileUrls.linkedin;
  }
  if (profileUrls.github) {
    slots.github = profileUrls.github;
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
