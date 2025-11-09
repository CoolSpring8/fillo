import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatProfileParsing,
  formatProfileSummary,
  resolveProfileName,
} from '../../../../entrypoints/options/hooks/profileUtils';
import type { ProfileRecord } from '../../../../shared/types';

const t = (key: string, args?: unknown) =>
  Array.isArray(args) ? `${key}:${args.join(',')}` : key;

const baseProfile: ProfileRecord = {
  id: 'profile-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  resume: {},
  rawText: 'hello',
  sourceFile: undefined,
};

describe('profile formatting helpers', () => {
  it('falls back to unnamed when basics are missing', () => {
    expect(resolveProfileName(baseProfile, t)).toBe('onboarding.manage.unnamed');
  });

  it('extracts the name from resume basics', () => {
    const profile: ProfileRecord = {
      ...baseProfile,
      resume: { basics: { name: 'Ada Lovelace' } },
    };
    expect(resolveProfileName(profile, t)).toBe('Ada Lovelace');
  });

  it('describes uploaded files in the summary', () => {
    const profile: ProfileRecord = {
      ...baseProfile,
      sourceFile: {
        name: 'resume.pdf',
        size: 1234,
        type: 'application/pdf',
        storageKey: 'profile-1/resume.pdf',
      },
    };
    expect(formatProfileSummary(profile, t)).toContain('resume.pdf');
  });

  it('renders provider metadata for OpenAI profiles', () => {
    const profile: ProfileRecord = {
      ...baseProfile,
      provider: { kind: 'openai', model: 'gpt-mini', apiBaseUrl: '' },
      parsedAt: '2024-02-01T00:00:00.000Z',
    };
    const parsing = formatProfileParsing(profile, t);
    expect(parsing).toContain('onboarding.manage.parsedOpenAIAt');
  });

  it('handles missing provider details', () => {
    expect(formatProfileParsing(baseProfile, t)).toBe('onboarding.manage.notParsed');
  });

  it('formats dates and keeps invalid input unchanged', () => {
    expect(formatDateTime('2024-01-01T00:00:00.000Z')).toContain('2024');
    expect(formatDateTime('invalid-date')).toBe('invalid-date');
  });
});
