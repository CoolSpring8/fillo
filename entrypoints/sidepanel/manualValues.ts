import type { PromptOptionSlot } from '../../shared/apply/types';
import type { ProfileRecord } from '../../shared/types';

export interface ManualValueNode {
  id: string;
  path: string[];
  label: string;
  displayPath: string;
  value?: string;
  children?: ManualValueNode[];
}

export interface ManualValueLeaf {
  id: string;
  displayPath: string;
  slotKey: PromptOptionSlot;
  value: string;
}

interface BuildContext {
  seen: WeakSet<object>;
}

export interface ManualTreeConfig {
  resumeLabel: string;
}

const DEFAULT_CONFIG: ManualTreeConfig = {
  resumeLabel: 'Resume',
};

export function buildManualValueTree(
  profile: ProfileRecord | null | undefined,
  config: ManualTreeConfig = DEFAULT_CONFIG,
): ManualValueNode[] {
  if (!profile) {
    return [];
  }

  const { resumeLabel } = config;
  const context: BuildContext = { seen: new WeakSet() };
  const roots: ManualValueNode[] = [];

  const resumeNode = buildNode(profile.resume, ['resume'], resumeLabel, resumeLabel, context);
  if (resumeNode) {
    roots.push(resumeNode);
  }

  return roots;
}

export function flattenManualLeaves(nodes: ManualValueNode[]): ManualValueLeaf[] {
  const leaves: ManualValueLeaf[] = [];
  const visit = (node: ManualValueNode) => {
    if (typeof node.value === 'string' && node.value.trim().length > 0) {
      leaves.push({
        id: node.id,
        displayPath: node.displayPath,
        slotKey: `profile.${node.id}` as PromptOptionSlot,
        value: node.value,
      });
    }
    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return leaves;
}

function buildNode(
  value: unknown,
  path: string[],
  label: string,
  displayPath: string,
  context: BuildContext,
): ManualValueNode | null {
  if (!value) {
    return null;
  }

  if (isPrimitive(value)) {
    const text = formatPrimitive(value);
    if (!text) {
      return null;
    }
    return {
      id: formatId(path),
      path,
      label,
      displayPath,
      value: text,
    };
  }

  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (context.seen.has(record)) {
    return null;
  }
  context.seen.add(record);

  if (Array.isArray(record)) {
    const children: ManualValueNode[] = [];
    record.forEach((entry, index) => {
      const itemLabel = `#${index + 1}`;
      const itemPath = [...path, `[${index}]`];
      const itemDisplay = `${displayPath} · ${itemLabel}`;
      const child = buildNode(entry, itemPath, itemLabel, itemDisplay, context);
      if (child) {
        children.push(child);
      }
    });
    if (children.length === 0) {
      return null;
    }
    return {
      id: formatId(path),
      path,
      label,
      displayPath,
      children,
    };
  }

  const keys = Object.keys(record).sort();
  const children: ManualValueNode[] = [];
  for (const key of keys) {
    const childLabel = formatSegment(key);
    const childPath = [...path, key];
    const childDisplay = `${displayPath} · ${childLabel}`;
    const child = buildNode(record[key], childPath, childLabel, childDisplay, context);
    if (child) {
      children.push(child);
    }
  }
  if (children.length === 0) {
    return null;
  }
  return {
    id: formatId(path),
    path,
    label,
    displayPath,
    children,
  };
}

function formatId(path: string[]): string {
  return path.reduce((acc, segment) => {
    if (!segment) {
      return acc;
    }
    if (segment.startsWith('[')) {
      return `${acc}${segment}`;
    }
    return acc ? `${acc}.${segment}` : segment;
  }, '');
}

function isPrimitive(value: unknown): value is string | number | boolean | Date {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  );
}

function formatPrimitive(value: string | number | boolean | Date): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function formatSegment(segment: string): string {
  const spaced = segment.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const trimmed = spaced.trim();
  if (!trimmed) {
    return segment;
  }
  return trimmed
    .split(/\s+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}
