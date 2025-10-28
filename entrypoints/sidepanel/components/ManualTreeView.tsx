import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Tree,
  getTreeExpandedState,
  useComputedColorScheme,
  useMantineTheme,
  useTree,
  type RenderTreeNodePayload,
  type TreeNodeData,
} from '@mantine/core';
import { ChevronDown, ChevronRight, ChevronUp, Copy, Search } from 'lucide-react';

import type { ManualValueNode } from '../../../shared/apply/manualValues';

interface ManualTreeViewProps {
  nodes: ManualValueNode[];
  tooltipLabel: string;
  branchCopyLabel: string;
  valueCopyLabel: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  previousMatchLabel: string;
  nextMatchLabel: string;
  onCopy: (label: string, value: string) => void;
}

type ManualTreeNodeData = TreeNodeData & { manualNode: ManualValueNode };

export function ManualTreeView({
  nodes,
  tooltipLabel,
  branchCopyLabel,
  valueCopyLabel,
  searchPlaceholder,
  searchAriaLabel,
  previousMatchLabel,
  nextMatchLabel,
  onCopy,
}: ManualTreeViewProps) {
  if (nodes.length === 0) {
    return null;
  }

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('light');
  const hoverBackground =
    colorScheme === 'dark'
      ? theme.colors.dark?.[6] ?? theme.colors.dark?.[5] ?? '#2c2e33'
      : theme.colors.gray?.[1] ?? theme.colors.gray?.[2] ?? '#f1f3f5';
  const treeData = useMemo<ManualTreeNodeData[]>(() => nodes.map(mapManualNodeToTreeNode), [nodes]);
  const expandedState = useMemo(() => getTreeExpandedState(treeData, '*'), [treeData]);
  const tree = useTree({ initialExpandedState: expandedState });
  const { setExpandedState, clearSelected, setHoveredNode } = tree;
  const [contextNodeId, setContextNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const flattenedNodes = useMemo(() => flattenManualNodes(nodes), [nodes]);
  const matches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [] as string[];
    }
    return flattenedNodes
      .filter((node) => {
        const labelMatch = node.label.toLowerCase().includes(query);
        const valueMatch =
          typeof node.value === 'string' && node.value.toLowerCase().includes(query);
        return labelMatch || valueMatch;
      })
      .map((node) => node.id);
  }, [flattenedNodes, searchQuery]);
  const matchesSet = useMemo(() => new Set(matches), [matches]);
  const matchesCount = matches.length;
  const hasMatches = matchesCount > 0;
  const activeMatchId = hasMatches
    ? matches[Math.min(activeMatchIndex, Math.max(matchesCount - 1, 0))]
    : null;
  const highlightColor =
    theme.colors.blue?.[colorScheme === 'dark' ? 3 : 6] ??
    (colorScheme === 'dark' ? '#4dabf7' : '#1c7ed6');
  const matchBackground =
    colorScheme === 'dark'
      ? theme.colors.blue?.[9] ?? '#1864ab'
      : theme.colors.blue?.[0] ?? '#e7f5ff';
  const activeMatchBackground =
    colorScheme === 'dark'
      ? theme.colors.blue?.[8] ?? '#1c7ed6'
      : theme.colors.blue?.[1] ?? '#d0ebff';
  const activeMatchBorderColor = highlightColor;
  const trimmedQuery = searchQuery.trim();
  const searchBarBackground =
    colorScheme === 'dark'
      ? theme.colors.dark?.[7] ?? theme.colors.dark?.[6] ?? '#1a1b1e'
      : theme.white ?? '#ffffff';
  const highlightText = useCallback(
    (text: string) => renderTextWithHighlight(text, trimmedQuery, highlightColor),
    [highlightColor, trimmedQuery],
  );

  useEffect(() => {
    setExpandedState(expandedState);
    clearSelected();
    setHoveredNode(null);
  }, [
    trimmedQuery,
    expandedState,
    setExpandedState,
    clearSelected,
    setHoveredNode,
  ]);

  useEffect(() => {
    setContextNodeId(null);
  }, [treeData]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [trimmedQuery]);

  useEffect(() => {
    setActiveMatchIndex((current) => {
      if (!hasMatches) {
        return 0;
      }
      return Math.min(current, matchesCount - 1);
    });
  }, [hasMatches, matchesCount]);

  useEffect(() => {
    if (!activeMatchId) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const selector =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? `[data-manual-node-id="${CSS.escape(activeMatchId)}"]`
        : `[data-manual-node-id="${activeMatchId.replace(/"/g, '\\"')}"]`;
    const element = document.querySelector(selector);
    element?.scrollIntoView({ block: 'center' });
  }, [activeMatchId]);

  const copyBranch = useCallback(
    (node: ManualValueNode) => {
      const text = buildManualBranchCopy(node);
      if (!text) {
        return;
      }
      onCopy(node.displayPath, text);
    },
    [onCopy],
  );

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.currentTarget.value);
  }, []);

  const handleNextMatch = useCallback(() => {
    if (!hasMatches) {
      return;
    }
    setActiveMatchIndex((current) => (current + 1) % matchesCount);
  }, [hasMatches, matchesCount]);

  const handlePreviousMatch = useCallback(() => {
    if (!hasMatches) {
      return;
    }
    setActiveMatchIndex((current) => (current - 1 + matchesCount) % matchesCount);
  }, [hasMatches, matchesCount]);

  const renderNode = useCallback(
    ({ node, elementProps, hasChildren, expanded }: RenderTreeNodePayload) => {
      const manualNode = (node as ManualTreeNodeData).manualNode;
      const isHovered = elementProps['data-hovered'] === true;
      const { className, style, onClick, ...rest } = elementProps;
      const isMatch = matchesSet.has(manualNode.id);
      const isActiveMatch = activeMatchId === manualNode.id;
      const backgroundColor = (() => {
        if (isActiveMatch) {
          return activeMatchBackground;
        }
        if (isMatch) {
          return matchBackground;
        }
        if (isHovered) {
          return hoverBackground;
        }
        return 'transparent';
      })();
      const borderColor = isActiveMatch ? activeMatchBorderColor : 'transparent';

      if (!hasChildren && typeof manualNode.value === 'string') {
        const value = manualNode.value;
        const { onContextMenu, ...restElementProps } = rest as typeof rest & {
          onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
        };
        const isMenuOpen = contextNodeId === manualNode.id;
        const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          onContextMenu?.(event);
          setContextNodeId(manualNode.id);
        };
        return (
          <Menu
            withinPortal
            opened={isMenuOpen}
            onClose={() => setContextNodeId((current) => (current === manualNode.id ? null : current))}
            closeOnItemClick
            closeOnEscape
          >
            <Menu.Target>
              <Tooltip label={tooltipLabel} position="right" withArrow openDelay={250}>
                <div
                  className={className}
                  style={{
                    ...style,
                    paddingBlock: '4px',
                    paddingInlineEnd: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '2px',
                    borderRadius: 'var(--mantine-radius-sm)',
                    border: '1px solid transparent',
                    backgroundColor,
                    borderColor,
                    transition: 'background-color 120ms ease, border-color 120ms ease',
                  }}
                  {...restElementProps}
                  data-manual-node-id={manualNode.id}
                  onClick={(event) => {
                    onCopy(manualNode.displayPath, value);
                    onClick?.(event);
                  }}
                  onContextMenu={handleContextMenu}
                >
                  <Text
                    fz="sm"
                    fw={500}
                    style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {highlightText(manualNode.label)}
                  </Text>
                  <Text
                    fz="xs"
                    c="dimmed"
                    style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {highlightText(value)}
                  </Text>
                </div>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<Copy size={14} aria-hidden />}
                onClick={() => {
                  onCopy(manualNode.displayPath, value);
                  setContextNodeId(null);
                }}
              >
                {valueCopyLabel}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        );
      }

      if (hasChildren) {
        const { onContextMenu, ...restElementProps } = rest as typeof rest & {
          onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
        };
        const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          onContextMenu?.(event);
          setContextNodeId(manualNode.id);
        };
        const nodeHasLeaves = manualNodeHasLeaf(manualNode);
        const isMenuOpen = contextNodeId === manualNode.id;
        return (
          <Menu
            withinPortal
            opened={isMenuOpen}
            onClose={() => setContextNodeId((current) => (current === manualNode.id ? null : current))}
            closeOnItemClick
            closeOnEscape
          >
            <Menu.Target>
              <div
                className={className}
                style={{
                  ...style,
                  paddingBlock: '4px',
                  paddingInlineEnd: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--mantine-spacing-xs)',
                  cursor: 'pointer',
                  borderRadius: 'var(--mantine-radius-sm)',
                  border: '1px solid transparent',
                  backgroundColor,
                  borderColor,
                  transition: 'background-color 120ms ease, border-color 120ms ease',
                }}
                onClick={onClick}
                onContextMenu={handleContextMenu}
                {...restElementProps}
                data-manual-node-id={manualNode.id}
              >
                <ChevronRight
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                  style={{
                    transition: 'transform 150ms ease',
                    transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    flexShrink: 0,
                  }}
                />
                <Text fw={600} fz="sm" style={{ margin: 0 }}>
                  {highlightText(manualNode.label)}
                </Text>
              </div>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<Copy size={14} aria-hidden />}
                onClick={() => {
                  copyBranch(manualNode);
                  setContextNodeId(null);
                }}
                disabled={!nodeHasLeaves}
              >
                {branchCopyLabel}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        );
      }

      return (
        <div
          className={className}
          style={{
            ...style,
            paddingBlock: '4px',
            paddingInlineEnd: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--mantine-spacing-xs)',
            cursor: 'pointer',
            borderRadius: 'var(--mantine-radius-sm)',
            border: '1px solid transparent',
            backgroundColor,
            borderColor,
            transition: 'background-color 120ms ease, border-color 120ms ease',
          }}
          onClick={onClick}
          {...rest}
          data-manual-node-id={manualNode.id}
        >
          <ChevronRight
            size={16}
            strokeWidth={2}
            aria-hidden
            style={{
              transition: 'transform 150ms ease',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              flexShrink: 0,
            }}
          />
          <Text fw={600} fz="sm" style={{ margin: 0 }}>
            {highlightText(manualNode.label)}
          </Text>
        </div>
      );
    },
    [
      activeMatchBackground,
      activeMatchBorderColor,
      activeMatchId,
      branchCopyLabel,
      contextNodeId,
      copyBranch,
      hoverBackground,
      matchBackground,
      matchesSet,
      highlightText,
      onCopy,
      tooltipLabel,
      valueCopyLabel,
    ],
  );

  return (
    <Stack gap={0} style={{ position: 'relative' }}>
      <Box
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          backgroundColor: searchBarBackground,
          paddingBottom: 'var(--mantine-spacing-xs)',
        }}
      >
        <TextInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          size="sm"
          leftSection={<Search size={16} strokeWidth={2} aria-hidden />}
          rightSection={
            <Group gap={4} wrap="nowrap">
              {hasMatches && (
                <Text size="xs" c="dimmed" fw={500}>
                  {`${Math.min(activeMatchIndex + 1, matchesCount)} / ${matchesCount}`}
                </Text>
              )}
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={previousMatchLabel}
                disabled={!hasMatches}
                onClick={handlePreviousMatch}
              >
                <ChevronUp size={16} strokeWidth={2} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={nextMatchLabel}
                disabled={!hasMatches}
                onClick={handleNextMatch}
              >
                <ChevronDown size={16} strokeWidth={2} />
              </ActionIcon>
            </Group>
          }
          rightSectionPointerEvents="auto"
          rightSectionWidth={hasMatches ? 144 : 112}
        />
      </Box>
      <Tree data={treeData} tree={tree} levelOffset="sm" renderNode={renderNode} />
    </Stack>
  );
}

function mapManualNodeToTreeNode(node: ManualValueNode): ManualTreeNodeData {
  return {
    value: node.id,
    label: node.label,
    manualNode: node,
    children: node.children?.map(mapManualNodeToTreeNode),
  };
}

function flattenManualNodes(nodes: ManualValueNode[]): ManualValueNode[] {
  const result: ManualValueNode[] = [];
  nodes.forEach((node) => {
    result.push(node);
    if (node.children && node.children.length > 0) {
      result.push(...flattenManualNodes(node.children));
    }
  });
  return result;
}

function renderTextWithHighlight(text: string, query: string, highlightColor: string): ReactNode {
  if (!query) {
    return text;
  }
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) {
    return text;
  }
  const normalizedText = text.toLowerCase();
  let searchIndex = 0;
  const segments: Array<{ value: string; match: boolean }> = [];
  let matchIndex = normalizedText.indexOf(normalizedQuery, searchIndex);

  while (matchIndex !== -1) {
    if (matchIndex > searchIndex) {
      segments.push({ value: text.slice(searchIndex, matchIndex), match: false });
    }
    segments.push({
      value: text.slice(matchIndex, matchIndex + query.length),
      match: true,
    });
    searchIndex = matchIndex + query.length;
    matchIndex = normalizedText.indexOf(normalizedQuery, searchIndex);
  }

  if (searchIndex < text.length) {
    segments.push({ value: text.slice(searchIndex), match: false });
  }

  return segments.map((segment, index) => {
    if (!segment.match) {
      return (
        <span key={`segment-${index}`} style={{ fontWeight: 'inherit', fontSize: 'inherit' }}>
          {segment.value}
        </span>
      );
    }
    return (
      <mark
        key={`segment-${index}`}
        style={{
          backgroundColor: 'transparent',
          color: highlightColor,
          fontWeight: 'inherit',
          fontSize: 'inherit',
        }}
      >
        {segment.value}
      </mark>
    );
  });
}

function manualNodeHasLeaf(node: ManualValueNode): boolean {
  if (typeof node.value === 'string' && node.value.trim().length > 0) {
    return true;
  }
  if (!node.children) {
    return false;
  }
  return node.children.some((child) => manualNodeHasLeaf(child));
}

function buildManualBranchCopy(node: ManualValueNode): string | null {
  const entries: Array<{ path: string; value: string }> = [];
  const visit = (current: ManualValueNode) => {
    if (typeof current.value === 'string' && current.value.trim().length > 0) {
      entries.push({ path: current.displayPath, value: current.value });
    }
    current.children?.forEach(visit);
  };
  visit(node);
  if (entries.length === 0) {
    return null;
  }
  return entries.map((entry) => entry.value).join('\n');
}
