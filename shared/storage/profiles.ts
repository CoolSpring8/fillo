import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { ProfileRecord, StoredFileReference } from '../types';

const INDEX_KEY = 'profiles:index';
const PROFILE_KEY_PREFIX = 'profiles:';
const FILE_KEY_PREFIX = 'file:';

export async function listProfiles(): Promise<ProfileRecord[]> {
  const stored = await browser.storage.local.get(INDEX_KEY);
  const index: string[] = stored[INDEX_KEY] ?? [];
  if (index.length === 0) {
    return [];
  }

  const keys = index.map((id) => PROFILE_KEY_PREFIX + id);
  const entries = await browser.storage.local.get(keys);

  return index
    .map((id) => entries[PROFILE_KEY_PREFIX + id] as ProfileRecord | undefined)
    .filter((p): p is ProfileRecord => Boolean(p));
}

export async function getProfile(id: string): Promise<ProfileRecord | undefined> {
  const entry = await browser.storage.local.get(PROFILE_KEY_PREFIX + id);
  return entry[PROFILE_KEY_PREFIX + id] as ProfileRecord | undefined;
}

export async function saveProfile(profile: ProfileRecord): Promise<void> {
  const stored = await browser.storage.local.get(INDEX_KEY);
  const index: string[] = stored[INDEX_KEY] ?? [];

  if (!index.includes(profile.id)) {
    index.push(profile.id);
  }

  await browser.storage.local.set({
    [INDEX_KEY]: index,
    [PROFILE_KEY_PREFIX + profile.id]: profile,
  });
}

export async function deleteProfile(id: string): Promise<void> {
  const stored = await browser.storage.local.get(INDEX_KEY);
  const index: string[] = stored[INDEX_KEY] ?? [];
  const next = index.filter((entry) => entry !== id);

  await browser.storage.local.remove(PROFILE_KEY_PREFIX + id);
  await browser.storage.local.set({ [INDEX_KEY]: next });
  await idbDel(FILE_KEY_PREFIX + id);
}

export async function storeFile(id: string, file: File): Promise<StoredFileReference> {
  const storageKey = FILE_KEY_PREFIX + id;
  const buffer = await file.arrayBuffer();
  await idbSet(storageKey, buffer);
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    storageKey,
  };
}

export async function getFileBuffer(id: string): Promise<ArrayBuffer | undefined> {
  const buffer = await idbGet<ArrayBuffer>(FILE_KEY_PREFIX + id);
  return buffer ?? undefined;
}
