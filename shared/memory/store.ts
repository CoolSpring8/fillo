import { browser } from 'wxt/browser';
import type { ScannedField } from '../apply/types';
import type { MemoryAssociation, MemoryMap } from './types';
import type { PromptOptionSlot } from '../apply/types';

const STORAGE_KEY = 'memory:associations';

export async function loadMemory(): Promise<MemoryMap> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const map = stored[STORAGE_KEY] as MemoryMap | undefined;
  return map ?? {};
}

export async function saveMemory(map: MemoryMap): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: map });
}

export function computeSignatureKey(field: ScannedField): string {
  const parts: string[] = [];
  const norm = normalize(field.label);
  parts.push(`l:${norm}`);
  parts.push(`k:${field.kind}`);
  if (field.autocomplete) parts.push(`a:${normalize(field.autocomplete)}`);
  const name = field.attributes?.name ? normalize(field.attributes.name) : '';
  if (name) parts.push(`n:${name}`);
  const id = field.attributes?.id ? normalize(field.attributes.id) : '';
  if (id) parts.push(`i:${id}`);
  return parts.join('|');
}

export async function getAssociationFor(field: ScannedField): Promise<MemoryAssociation | undefined> {
  const map = await loadMemory();
  return map[computeSignatureKey(field)];
}

export async function setAssociation(
  signatureKey: string,
  update: Partial<MemoryAssociation>,
): Promise<void> {
  const map = await loadMemory();
  const prev = map[signatureKey] ?? { updatedAt: new Date().toISOString() };
  const next: MemoryAssociation = {
    ...prev,
    ...update,
    updatedAt: new Date().toISOString(),
  };
  map[signatureKey] = next;
  await saveMemory(map);
}

export async function learnAccept(
  field: ScannedField,
  params: { slot?: PromptOptionSlot | null; value?: string | null },
): Promise<void> {
  const key = computeSignatureKey(field);
  const map = await loadMemory();
  const prev = map[key] ?? { updatedAt: new Date().toISOString(), accepted: 0, rejected: 0 };
  const next: MemoryAssociation = {
    ...prev,
    preferredSlot: params.slot ?? prev.preferredSlot ?? null,
    lastValue: params.value ?? prev.lastValue ?? null,
    accepted: (prev.accepted ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  map[key] = next;
  await saveMemory(map);
}

export async function learnReject(
  field: ScannedField,
  _params?: { slot?: PromptOptionSlot | null; value?: string | null },
): Promise<void> {
  const key = computeSignatureKey(field);
  const map = await loadMemory();
  const prev = map[key] ?? { updatedAt: new Date().toISOString(), accepted: 0, rejected: 0 };
  const next: MemoryAssociation = {
    ...prev,
    rejected: (prev.rejected ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  map[key] = next;
  await saveMemory(map);
}

export async function listAssociations(): Promise<Array<{ key: string; association: MemoryAssociation }>> {
  const map = await loadMemory();
  return Object.entries(map).map(([key, association]) => ({ key, association }));
}

export async function deleteAssociation(key: string): Promise<void> {
  const map = await loadMemory();
  delete map[key];
  await saveMemory(map);
}

export async function clearAllMemory(): Promise<void> {
  await saveMemory({});
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

