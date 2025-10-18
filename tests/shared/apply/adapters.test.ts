import { describe, expect, it } from 'vitest';
import { resolveSlotFromLabel, resolveSlotFromText, getAllAdapterIds } from '../../../shared/apply/slots';

describe('field adapters', () => {
  it('matches English labels by default', () => {
    expect(resolveSlotFromLabel('Email address')).toBe('email');
  });

  it('matches Chinese labels when adapters active', () => {
    const adapters = getAllAdapterIds();
    expect(resolveSlotFromLabel('联系邮箱', adapters)).toBe('email');
    expect(resolveSlotFromLabel('联系电话', adapters)).toBe('phone');
  });

  it('identifies Chinese context strings', () => {
    const adapters = getAllAdapterIds();
    expect(resolveSlotFromText('现公司：示例企业', adapters)).toBe('currentCompany');
  });

  it('falls back when adapter excluded', () => {
    expect(resolveSlotFromLabel('联系电话', ['en-default'])).toBeNull();
  });
});
