export const ACTIVE_PROFILE_STORAGE_KEY = 'popupActiveProfileId';

export async function getActiveProfileId(): Promise<string | null> {
  const stored = await browser.storage.local.get(ACTIVE_PROFILE_STORAGE_KEY);
  const raw = stored[ACTIVE_PROFILE_STORAGE_KEY];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

export async function setActiveProfileId(profileId: string | null): Promise<void> {
  const next = profileId && profileId.trim().length > 0 ? profileId.trim() : null;
  if (next) {
    await browser.storage.local.set({ [ACTIVE_PROFILE_STORAGE_KEY]: next });
    return;
  }
  await browser.storage.local.remove(ACTIVE_PROFILE_STORAGE_KEY);
}
