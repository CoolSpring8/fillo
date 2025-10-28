import { buildManualValueTree, flattenManualLeaves, type ManualValueNode } from './manualValues';
import { buildSlotValues, type SlotValueMap } from './profile';
import type { PromptOption, PromptOptionSlot } from './types';
import type { FieldSlot } from './slotTypes';
import type { ProfileRecord } from '../types';

interface ProfilePromptOptionsConfig {
  formatSlotLabel: (slot: FieldSlot) => string;
  manualTree?: ManualValueNode[];
  resumeLabel?: string;
}

export function buildProfilePromptOptions(
  profile: ProfileRecord | null | undefined,
  config: ProfilePromptOptionsConfig,
): PromptOption[] {
  if (!profile) {
    return [];
  }

  const slotValues = buildSlotValues(profile);
  const manualTree = config.manualTree ?? buildManualValueTree(profile, { resumeLabel: config.resumeLabel ?? 'Resume' });
  const manualLeaves = flattenManualLeaves(manualTree);

  const seen = new Set<PromptOptionSlot>();
  const options: PromptOption[] = [];

  const addOption = (slot: PromptOptionSlot, label: string, rawValue: string | undefined) => {
    if (!rawValue) {
      return;
    }
    const normalized = rawValue.trim();
    if (!normalized || seen.has(slot)) {
      return;
    }
    seen.add(slot);
    options.push({ slot, label, value: normalized });
  };

  addSlotValues(slotValues, config.formatSlotLabel, addOption);
  manualLeaves.forEach((leaf) => addOption(leaf.slotKey, leaf.displayPath, leaf.value));

  return options;
}

function addSlotValues(
  slotValues: SlotValueMap,
  formatSlotLabel: (slot: FieldSlot) => string,
  addOption: (slot: PromptOptionSlot, label: string, rawValue: string | undefined) => void,
): void {
  (Object.entries(slotValues) as Array<[FieldSlot, string | undefined]>).forEach(([slot, value]) => {
    addOption(slot, formatSlotLabel(slot), value);
  });
}
