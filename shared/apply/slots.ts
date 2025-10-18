import type { FieldSlot } from './slotTypes';
import { listAvailableAdapters, matchSlotWithAdapters } from './adapters';

export function resolveSlotFromLabel(label: string, adapterIds?: string[]): FieldSlot | null {
  return matchSlotWithAdapters(label, adapterIds);
}

export function resolveSlotFromText(text: string, adapterIds?: string[]): FieldSlot | null {
  return matchSlotWithAdapters(text, adapterIds);
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
  if (value.includes('address-level1')) return 'state';
  if (value.includes('postal') || value.includes('zip')) return 'postalCode';
  if (value.includes('street-address')) return 'address';
  if (value.includes('organization-title')) return 'currentTitle';
  if (value.includes('organization')) return 'currentCompany';
  if (value.includes('bday')) return 'birthDate';
  if (value.includes('sex')) return 'gender';
  if (value.includes('url')) return 'website';
  return null;
}

export function getAllAdapterIds(): string[] {
  return listAvailableAdapters().map((adapter) => adapter.id);
}
