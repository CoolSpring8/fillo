import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Kbd,
  Loader,
  MantineProvider,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import type { MantineTheme } from '@mantine/core';
import type { HighlightRect, OverlayComponentState, PopoverPosition } from './types';
import { PromptEditor } from '../../shared/components/PromptEditor';
import type { PromptEditorState } from '../../shared/components/PromptEditor';
import type { PromptOption, PromptOptionSlot } from '../../../shared/apply/types';
import { applyTheme } from '../../shared/theme';

interface OverlayAppProps {
  state: OverlayComponentState;
  highlightRect: HighlightRect | null;
  popoverPosition: PopoverPosition | null;
  onPopoverMount: (element: HTMLDivElement | null) => void;
  portalTarget: HTMLElement | null;
  mantineRoot: HTMLElement | null;
}

export function OverlayApp({
  state,
  highlightRect,
  popoverPosition,
  onPopoverMount,
  portalTarget,
  mantineRoot,
}: OverlayAppProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onPopoverMount(popoverRef.current);
    return () => {
      onPopoverMount(null);
    };
  }, [onPopoverMount]);

  const overlayTheme = useMemo(
    () => {
      const baseComponents = applyTheme.components ?? {};
      const basePortal = baseComponents.Portal ?? {};
      const basePortalDefaults = basePortal.defaultProps ?? {};

      return {
        ...applyTheme,
        components: {
          ...baseComponents,
          Portal: {
            ...basePortal,
            defaultProps: {
              ...basePortalDefaults,
              target: portalTarget ?? undefined,
            },
          },
        },
      } as MantineTheme;
    },
    [portalTarget],
  );

  const cssVariablesSelector = mantineRoot?.id ? `#${mantineRoot.id}` : ':host';
  const rootElementGetter = useCallback(() => mantineRoot ?? undefined, [mantineRoot]);

  const highlightStyle = highlightRect
    ? {
        display: 'block',
        opacity: 1,
        top: `${Math.round(highlightRect.top)}px`,
        left: `${Math.round(highlightRect.left)}px`,
        width: `${Math.round(highlightRect.width)}px`,
        height: `${Math.round(highlightRect.height)}px`,
      }
    : {
        display: 'none',
        opacity: 0,
      };

  const shouldShowPopover =
    state.mode === 'prompt' || (state.mode === 'highlight' && state.label.trim().length > 0);
  const isPopoverVisible = shouldShowPopover && Boolean(popoverPosition);
  const popoverStyle = popoverPosition
    ? {
        left: `${Math.round(popoverPosition.x)}px`,
        top: `${Math.round(popoverPosition.y)}px`,
      }
    : undefined;

  const shouldRenderPopoverContent =
    shouldShowPopover && (state.mode === 'prompt' || state.label.trim().length > 0);

  return (
    <MantineProvider
      theme={overlayTheme}
      defaultColorScheme="light"
      cssVariablesSelector={cssVariablesSelector}
      getRootElement={mantineRoot ? rootElementGetter : undefined}
    >
      <div className="highlight" style={highlightStyle} />
      <div className="popover" ref={popoverRef} hidden={!isPopoverVisible} style={popoverStyle}>
        {shouldRenderPopoverContent ? (
          <Paper shadow="lg" radius="md" withBorder p="md">
            {state.mode === 'prompt' ? (
              <PromptContent state={state} />
            ) : (
              <Text fw={600} size="sm">
                {state.label}
              </Text>
            )}
          </Paper>
        ) : null}
      </div>
    </MantineProvider>
  );
}

interface PromptContentProps {
  state: Extract<OverlayComponentState, { mode: 'prompt' }>;
}

function PromptContent({ state }: PromptContentProps) {
  const { t } = i18n;
  const tLoose = i18n.t as unknown as (key: string, params?: unknown[]) => string;
  const prompt = state.prompt;

  return (
    <PromptEditor
      options={prompt.options}
      defaultSlot={prompt.defaultSlot ?? null}
      defaultValue={prompt.defaultValue}
      preview={prompt.preview}
      onRequestAi={prompt.onRequestAi}
    >
      {(editor) => (
        <PromptForm t={t} tLoose={tLoose} prompt={prompt} editor={editor} />
      )}
    </PromptEditor>
  );
}

interface PromptFormProps {
  t: typeof i18n.t;
  tLoose: (key: string, params?: unknown[]) => string;
  prompt: PromptContentProps['state']['prompt'];
  editor: PromptEditorState;
}

interface SuggestionCandidate {
  value: string;
  slot: PromptOptionSlot | null;
  source: 'ai' | 'local' | 'preview';
  label?: string;
}

const AI_DEBOUNCE_MS = 350;

function PromptForm({ t, tLoose, prompt, editor }: PromptFormProps) {
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiSlot, setAiSlot] = useState<PromptOptionSlot | null>(null);
  const requestTokenRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canRequestAi = typeof prompt.onRequestAi === 'function';

  const localMatches = useMemo(
    () => rankLocalOptions(editor.options, editor.value, 3),
    [editor.options, editor.value],
  );

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
    setAiSuggestion(null);
    setAiSlot(null);
    requestTokenRef.current = 0;
  }, [prompt.requestId]);

  useEffect(() => {
    if (!canRequestAi) {
      setAiSuggestion(null);
      setAiSlot(null);
      return;
    }
    const trimmedValue = editor.value.trim();
    if (!trimmedValue) {
      setAiSuggestion(null);
      setAiSlot(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const token = ++requestTokenRef.current;
      editor.setAiError(null);
      editor
        .requestAi()
        .then((result) => {
          if (requestTokenRef.current !== token) {
            return;
          }
          if (!result) {
            setAiSuggestion(null);
            setAiSlot(null);
            return;
          }
          const normalized = result.value?.trim?.() ?? '';
          if (!normalized) {
            setAiSuggestion(null);
            setAiSlot(null);
            editor.setAiError(tLoose('overlay.prompt.aiEmpty'));
            return;
          }
          setAiSuggestion(normalized);
          setAiSlot(Object.prototype.hasOwnProperty.call(result, 'slot') ? result.slot ?? null : null);
        })
        .catch((error) => {
          if (requestTokenRef.current !== token) {
            return;
          }
          if (error instanceof Error && error.message === 'query-missing') {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          editor.setAiError(message || tLoose('overlay.prompt.aiError'));
          setAiSuggestion(null);
          setAiSlot(null);
        });
    }, AI_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      requestTokenRef.current += 1;
    };
  }, [canRequestAi, editor.value, editor.requestAi, editor.setAiError, tLoose]);

  const suggestionCandidate = useMemo<SuggestionCandidate | null>(() => {
    const trimmedValue = editor.value.trim().toLowerCase();
    const aiValue = aiSuggestion?.trim() ?? '';
    if (aiValue && aiValue.toLowerCase() !== trimmedValue) {
      return { value: aiValue, slot: aiSlot, source: 'ai' };
    }
    const fallbackMatch = localMatches.find((option) => {
      const normalized = option.value.trim();
      return normalized && normalized.toLowerCase() !== trimmedValue;
    });
    if (fallbackMatch) {
      return {
        value: fallbackMatch.value,
        slot: fallbackMatch.slot ?? null,
        source: 'local',
        label: fallbackMatch.label,
      };
    }
    const previewValue = prompt.preview?.trim() ?? '';
    if (previewValue && previewValue.toLowerCase() !== trimmedValue) {
      return {
        value: previewValue,
        slot: prompt.defaultSlot ?? null,
        source: 'preview',
      };
    }
    return null;
  }, [aiSuggestion, aiSlot, editor.value, localMatches, prompt.preview, prompt.defaultSlot]);

  const hasUserInput = editor.value.trim().length > 0;
  const canFill = hasUserInput || Boolean(suggestionCandidate?.value.trim().length);

  const handleValueChange = useCallback(
    (next: string) => {
      editor.setValue(next);
      setAiSuggestion(null);
      setAiSlot(null);
      if (editor.aiError) {
        editor.setAiError(null);
      }
    },
    [editor],
  );

  type FillCandidate = { value: string; slot: PromptOptionSlot | null };

  const resolveFillCandidate = useCallback(
    (preferSuggestion: boolean): FillCandidate | null => {
      if (preferSuggestion) {
        if (suggestionCandidate) {
          return {
            value: suggestionCandidate.value,
            slot: suggestionCandidate.slot ?? editor.selectedSlot ?? null,
          };
        }
        const fallback = localMatches[0];
        if (fallback) {
          return { value: fallback.value, slot: fallback.slot ?? editor.selectedSlot ?? null };
        }
      }
      const trimmedValue = editor.value.trim();
      if (trimmedValue.length > 0) {
        return { value: editor.value, slot: editor.selectedSlot ?? null };
      }
      if (suggestionCandidate) {
        return {
          value: suggestionCandidate.value,
          slot: suggestionCandidate.slot ?? editor.selectedSlot ?? null,
        };
      }
      const fallback = localMatches[0];
      if (fallback) {
        return { value: fallback.value, slot: fallback.slot ?? editor.selectedSlot ?? null };
      }
      return null;
    },
    [editor.value, editor.selectedSlot, suggestionCandidate, localMatches],
  );

  const commitFill = useCallback(
    (candidate: FillCandidate) => {
      const normalized = candidate.value.trim();
      if (!normalized) {
        return;
      }
      editor.setValue(candidate.value);
      editor.setSelectedSlot(candidate.slot);
      setAiSuggestion(null);
      setAiSlot(null);
      prompt.onFill(candidate.value, candidate.slot);
    },
    [editor, prompt],
  );

  const handleFill = useCallback(
    (event?: MouseEvent<HTMLButtonElement>) => {
      event?.preventDefault();
      const candidate = resolveFillCandidate(false);
      if (!candidate) {
        return;
      }
      commitFill(candidate);
    },
    [commitFill, resolveFillCandidate],
  );

  const handleSkip = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      prompt.onSkip();
    },
    [prompt],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Tab' && !event.shiftKey) {
        const candidate = resolveFillCandidate(true);
        if (!candidate) {
          return;
        }
        event.preventDefault();
        commitFill(candidate);
        return;
      }
      if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || (event.key === 'Enter' && event.altKey)) {
        const candidate = resolveFillCandidate(false);
        if (!candidate) {
          return;
        }
        event.preventDefault();
        commitFill(candidate);
      }
    },
    [commitFill, resolveFillCandidate],
  );

  const handleMatchFill = useCallback(
    (option: PromptOption) => {
      const normalized = option.value.trim();
      if (!normalized) {
        return;
      }
      commitFill({ value: option.value, slot: option.slot });
    },
    [commitFill],
  );

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.shiftKey) {
        return;
      }
      if (textareaRef.current && event.target instanceof Node && textareaRef.current.contains(event.target)) {
        return;
      }
      const candidate = resolveFillCandidate(true);
      if (!candidate) {
        return;
      }
      commitFill(candidate);
    };

    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [commitFill, resolveFillCandidate]);

  const suggestionSourceLabel = useMemo(() => {
    if (!suggestionCandidate) {
      return null;
    }
    return formatSuggestionSource(tLoose, suggestionCandidate);
  }, [suggestionCandidate, tLoose]);

  return (
    <Stack gap="md">
      <Text fw={600} size="sm">
        {prompt.label.length > 0 ? prompt.label : t('overlay.prompt.heading')}
      </Text>
      <Stack gap="xs">
        <PredictiveTextarea
          ref={textareaRef}
          value={editor.value}
          placeholder={tLoose('overlay.prompt.inputPlaceholder')}
          onChange={handleValueChange}
          onKeyDown={handleKeyDown}
        />
        <Group justify="space-between" align="center" gap="xs">
          <Group gap={6} align="center">
            {editor.aiLoading ? <Loader size="xs" color="brand" /> : null}
            <Text size="xs" c="dimmed">
              <Kbd>Tab</Kbd> {tLoose('overlay.prompt.tabHint')}
            </Text>
          </Group>
          {suggestionSourceLabel ? (
            <Badge size="xs" variant="light" color={suggestionCandidate?.source === 'ai' ? 'brand' : 'gray'}>
              {suggestionSourceLabel}
            </Badge>
          ) : null}
        </Group>
        {suggestionCandidate ? (
          <Text size="sm" c="dimmed">
            {formatSuggestionPreview(suggestionCandidate.value)}
          </Text>
        ) : null}
        {localMatches.length > 0 ? (
          <Group gap="xs">
            {localMatches.map((option) => (
              <Button
                key={`${option.slot}:${option.label}`}
                size="compact-sm"
                variant="light"
                onClick={() => handleMatchFill(option)}
              >
                {`${option.label} · ${truncate(option.value)}`}
              </Button>
            ))}
          </Group>
        ) : null}
        {editor.aiError ? (
          <Alert variant="light" color="red" radius="sm">
            {editor.aiError}
          </Alert>
        ) : null}
      </Stack>
      <Group justify="flex-end" gap="xs">
        <Button type="button" variant="filled" color="brand" disabled={!canFill} onClick={handleFill}>
          {t('overlay.prompt.fill')}
        </Button>
        <Button type="button" variant="default" onClick={handleSkip}>
          {t('overlay.prompt.skip')}
        </Button>
      </Group>
    </Stack>
  );
}

interface PredictiveTextareaProps {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}

const PredictiveTextarea = forwardRef<HTMLTextAreaElement, PredictiveTextareaProps>(
  ({ value, placeholder, onChange, onKeyDown }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

    const adjustHeight = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.style.height = 'auto';
      const next = Math.min(220, Math.max(84, textarea.scrollHeight));
      textarea.style.height = `${next}px`;
    }, []);

    useEffect(() => {
      adjustHeight();
    }, [value, adjustHeight]);

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value);
    };

    return (
      <div className="apply-overlay-input">
        <textarea
          ref={textareaRef}
          className="apply-overlay-input__control"
          value={value}
          placeholder={placeholder}
          spellCheck
          onChange={handleChange}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  },
);
PredictiveTextarea.displayName = 'PredictiveTextarea';

function rankLocalOptions(options: PromptOption[], value: string, limit: number): PromptOption[] {
  if (options.length === 0) {
    return [];
  }
  const normalizedQuery = value.trim().toLowerCase();
  if (!normalizedQuery) {
    return options.slice(0, limit);
  }
  const scored = options
    .map((option) => {
      const label = option.label.toLowerCase();
      const optionValue = option.value.toLowerCase();
      const labelIndex = label.indexOf(normalizedQuery);
      const valueIndex = optionValue.indexOf(normalizedQuery);
      const hasMatch = labelIndex >= 0 || valueIndex >= 0;
      const score = hasMatch
        ? Math.min(labelIndex >= 0 ? labelIndex : Number.POSITIVE_INFINITY, valueIndex >= 0 ? valueIndex + 100 : Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
      return { option, score };
    })
    .filter(({ score }) => Number.isFinite(score));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(({ option }) => option);
}

function formatSuggestionSource(tLoose: (key: string, params?: unknown[]) => string, candidate: SuggestionCandidate): string {
  switch (candidate.source) {
    case 'ai':
      return tLoose('overlay.prompt.source.ai');
    case 'local':
      return tLoose('overlay.prompt.source.local', [candidate.label ?? candidate.value]);
    case 'preview':
      return tLoose('overlay.prompt.source.preview');
    default:
      return '';
  }
}

function truncate(value: string, limit = 80): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}

function formatSuggestionPreview(suggestion: string): string {
  const normalized = suggestion.trim();
  if (!normalized) {
    return '';
  }
  return truncate(normalized, 160);
}
