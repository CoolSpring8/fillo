import { useCallback, useEffect, useState } from 'react';
import { listAssociations, clearAllMemory, deleteAssociation } from '../../../shared/memory/store';
import type { MemoryEntry } from '../components/MemoryCard';

export interface MemoryState {
  loading: boolean;
  error?: string;
}

interface UseMemoryStoreParams {
  t: (key: string, substitutions?: unknown) => string;
}

interface UseMemoryStoreResult {
  memoryItems: MemoryEntry[];
  memoryState: MemoryState;
  refreshMemory: () => Promise<void>;
  clearMemory: () => Promise<void>;
  deleteMemory: (key: string) => Promise<void>;
  formatMemoryEntry: (entry: MemoryEntry) => string;
}

export function useMemoryStore({ t }: UseMemoryStoreParams): UseMemoryStoreResult {
  const [memoryItems, setMemoryItems] = useState<MemoryEntry[]>([]);
  const [memoryState, setMemoryState] = useState<MemoryState>({ loading: true });

  const refreshMemory = useCallback(async () => {
    setMemoryState({ loading: true, error: undefined });
    try {
      const list = await listAssociations();
      setMemoryItems(list);
      setMemoryState({ loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemoryState({ loading: false, error: message });
    }
  }, []);

  const clearMemory = useCallback(async () => {
    setMemoryState((state) => ({ ...state, loading: true, error: undefined }));
    try {
      await clearAllMemory();
      await refreshMemory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMemoryState({ loading: false, error: message });
    }
  }, [refreshMemory]);

  const deleteMemory = useCallback(
    async (key: string) => {
      setMemoryState((state) => ({ ...state, loading: true, error: undefined }));
      try {
        await deleteAssociation(key);
        await refreshMemory();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setMemoryState({ loading: false, error: message });
      }
    },
    [refreshMemory],
  );

  const formatMemoryEntry = useCallback(
    ({ key, association }: MemoryEntry) => {
      const parts: string[] = [key];
      const preferred = association.preferredSlot;
      if (preferred) {
        parts.push(t('options.memory.preferredSlot', [preferred]));
      }
      const last = association.lastValue?.trim();
      if (last && last.length > 0) {
        const limited = last.length <= 80 ? last : `${last.slice(0, 79)}…`;
        parts.push(t('options.memory.lastValue', [limited]));
      }
      return parts.join(' · ');
    },
    [t],
  );

  useEffect(() => {
    void refreshMemory();
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if ('memory:associations' in changes) {
        void refreshMemory();
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refreshMemory]);

  return {
    memoryItems,
    memoryState,
    refreshMemory,
    clearMemory,
    deleteMemory,
    formatMemoryEntry,
  };
}
