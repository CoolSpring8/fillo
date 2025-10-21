import { describe, expect, it } from 'vitest';
import type { ProfileRecord } from '../../../shared/types';
import { buildSlotValues } from '../../../shared/apply/profile';

const baseProfile: ProfileRecord = {
  id: 'profile-1',
  createdAt: new Date('2024-01-01').toISOString(),
  sourceFile: {
    name: 'resume.pdf',
    size: 1234,
    type: 'application/pdf',
    storageKey: 'file:profile-1',
  },
  rawText: 'Sample resume',
  resume: {
    basics: {
      name: 'Ada Lovelace',
      label: 'Mathematician',
      summary: 'Analyst and visionary',
      email: 'ada@example.com',
      phone: '+44 100 200 300',
      url: 'https://ada.example.com',
      gender: 'Female',
      birthdate: '1815-12-10',
      location: {
        address: '1 Example Street',
        city: 'London',
        country: 'United Kingdom',
      },
      profiles: [
        { network: 'LinkedIn', url: 'https://linkedin.com/in/ada' },
        { network: 'GitHub', username: 'ada' },
      ],
    },
    work: [
      {
        name: 'Analytical Engines',
        position: 'Lead Analyst',
        location: {
          city: 'London',
          country: 'United Kingdom',
        },
        startDate: '1835-01-01',
      },
    ],
    education: [
      {
        institution: 'University of Imagination',
        studyType: 'Bachelors',
        area: 'Mathematics',
        startDate: '1830-01-01',
        endDate: '1834-01-01',
        gpa: '3.9',
      },
    ],
    skills: [
      {
        name: 'Mathematics',
        keywords: ['Calculus', 'Logic'],
      },
    ],
    meta: {
      custom: {
        expectedSalary: '100000',
        preferredLocation: {
          city: 'London',
          country: 'United Kingdom',
        },
        availabilityDate: '2024-03-01',
        jobType: 'Full time',
      },
    },
  },
};

describe('buildSlotValues', () => {
  it('extracts primary basics fields', () => {
    const slots = buildSlotValues(baseProfile);
    expect(slots.name).toBe('Ada Lovelace');
    expect(slots.firstName).toBe('Ada');
    expect(slots.headline).toBe('Mathematician');
    expect(slots.email).toBe('ada@example.com');
    expect(slots.city).toBe('London');
    expect(slots.gender).toBe('female');
    expect(slots.birthDate).toBe('1815-12-10');
    expect(slots.linkedin).toBe('https://linkedin.com/in/ada');
    expect(slots.github).toBe('https://github.com/ada');
  });

  it('maps work and education details', () => {
    const slots = buildSlotValues(baseProfile);
    expect(slots.currentCompany).toBe('Analytical Engines');
    expect(slots.currentTitle).toBe('Lead Analyst');
    expect(slots.currentStartDate).toBe('1835-01-01');
    expect(slots.currentLocation).toBe('London, United Kingdom');
    expect(slots.educationSchool).toBe('University of Imagination');
    expect(slots.educationDegree).toBe('Bachelors');
    expect(slots.educationField).toBe('Mathematics');
    expect(slots.educationEndDate).toBe('1834-01-01');
    expect(slots.educationGpa).toBe('3.9');
  });

  it('prefers custom intent values when available', () => {
    const slots = buildSlotValues(baseProfile);
    expect(slots.expectedSalary).toBe('100000');
    expect(slots.preferredLocation).toBe('London, United Kingdom');
    expect(slots.availabilityDate).toBe('2024-03-01');
    expect(slots.jobType).toBe('full-time');
  });

  it('supports legacy profile.custom data', () => {
    const legacyProfile: ProfileRecord = {
      ...baseProfile,
      resume: {
        ...(baseProfile.resume as Record<string, unknown>),
        meta: undefined,
      },
    };
    (legacyProfile as { custom?: Record<string, unknown> }).custom = {
      expectedSalary: '95000',
    };

    const slots = buildSlotValues(legacyProfile);
    expect(slots.expectedSalary).toBe('95000');
  });

  it('formats skills into a readable string', () => {
    const slots = buildSlotValues(baseProfile);
    expect(slots.skills).toBe('Mathematics, Calculus, Logic');
  });

  it('handles missing resume gracefully', () => {
    const emptyProfile: ProfileRecord = {
      ...baseProfile,
      resume: undefined,
    };
    const slots = buildSlotValues(emptyProfile);
    expect(Object.keys(slots).length).toBe(0);
  });
});
