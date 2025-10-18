import { describe, expect, it } from 'vitest';
import { getValueByPath, normalizeDate, normalizeEnum, coerceString } from '../../../shared/apply/value';

describe('value helpers', () => {
  describe('getValueByPath', () => {
    const source = {
      basics: {
        name: 'Ada Lovelace',
        location: {
          city: 'London',
        },
      },
      work: [
        {
          company: 'Analytical Engines',
          startDate: '1835-01-01',
        },
      ],
    };

    it('reads dotted paths', () => {
      expect(getValueByPath(source, 'basics.name')).toBe('Ada Lovelace');
    });

    it('reads array bracket paths', () => {
      expect(getValueByPath(source, 'work[0].company')).toBe('Analytical Engines');
    });

    it('returns undefined for missing segments', () => {
      expect(getValueByPath(source, 'work[1].company')).toBeUndefined();
    });
  });

  describe('normalizeDate', () => {
    it('accepts ISO strings', () => {
      expect(normalizeDate('2020-02-03')).toBe('2020-02-03');
    });

    it('pads shorthand values', () => {
      expect(normalizeDate('2020/3/7')).toBe('2020-03-07');
    });

    it('uses year only when provided', () => {
      expect(normalizeDate('1999')).toBe('1999-01-01');
    });

    it('returns undefined for junk', () => {
      expect(normalizeDate('unknown date')).toBeUndefined();
    });
  });

  describe('normalizeEnum', () => {
    it('normalizes gender synonyms', () => {
      expect(normalizeEnum('Female', 'gender')).toBe('female');
      expect(normalizeEnum('男', 'gender')).toBe('male');
    });

    it('returns undefined when no match', () => {
      expect(normalizeEnum('mystery', 'gender')).toBeUndefined();
    });
  });

  describe('coerceString', () => {
    it('trims strings and ignores blanks', () => {
      expect(coerceString('  hello ')).toBe('hello');
      expect(coerceString('   ')).toBeUndefined();
    });

    it('coerces numbers', () => {
      expect(coerceString(42)).toBe('42');
    });
  });
});
