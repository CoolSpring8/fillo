import { type ChangeEvent, type MouseEvent, useRef, useEffect } from 'react';
import {
  Alert,
  Button,
  Group,
  MantineProvider,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
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
}

export function OverlayApp({ state, highlightRect, popoverPosition, onPopoverMount }: OverlayAppProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onPopoverMount(popoverRef.current);
    return () => {
      onPopoverMount(null);
    };
  }, [onPopoverMount]);

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
    <MantineProvider theme={applyTheme} defaultColorScheme="light">
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
      {(editor) => renderPromptContent(t, tLoose, prompt, editor)}
    </PromptEditor>
  );
}

function renderPromptContent(
  t: typeof i18n.t,
  tLoose: (key: string, params?: unknown[]) => string,
  prompt: PromptContentProps['state']['prompt'],
  editor: PromptEditorState,
) {
  const normalizedOptions = editor.options;
  const disableFill = editor.value.trim().length === 0;
  const canRequestAi = typeof prompt.onRequestAi === 'function';
  const selectOptions = normalizedOptions.map((option: PromptOption) => ({
    value: option.slot,
    label: `${option.label} · ${truncate(option.value)}`,
  }));

  const handleOptionChange = (value: string | null) => {
    const normalizedValue = (value ?? '') as PromptOptionSlot | '';
    if (!normalizedValue) {
      editor.setSelectedSlot(null);
      editor.setValue('');
      editor.setAiError(null);
      return;
    }
    const selected = normalizedOptions.find((option) => option.slot === normalizedValue);
    editor.setSelectedSlot(selected?.slot ?? null);
    editor.setValue(selected?.value ?? '');
    editor.setAiError(null);
  };

  const handleValueChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    editor.setValue(event.target.value);
    editor.setAiError(null);
  };

  const handleInstructionChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    editor.setInstruction(event.target.value);
    if (editor.aiError) {
      editor.setAiError(null);
    }
  };

  const handleAskAi = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!canRequestAi) {
      return;
    }
    const trimmed = editor.instruction.trim();
    if (!trimmed) {
      editor.setAiError(tLoose('overlay.prompt.aiInstructionRequired'));
      return;
    }
    try {
      const result = await editor.requestAi();
      if (!result) {
        editor.setAiError(tLoose('overlay.prompt.aiError'));
        return;
      }
      const normalized = result.value?.trim?.() ?? '';
      if (!normalized) {
        editor.setAiError(tLoose('overlay.prompt.aiEmpty'));
        return;
      }
      editor.setValue(normalized);
      if (Object.prototype.hasOwnProperty.call(result, 'slot')) {
        editor.setSelectedSlot(result.slot ?? null);
      }
      editor.setInstruction('');
      editor.setAiError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      switch (message) {
        case 'instruction-missing':
        case 'Instruction required.':
          editor.setAiError(tLoose('overlay.prompt.aiInstructionRequired'));
          break;
        case 'Missing field context.':
          editor.setAiError(tLoose('overlay.prompt.aiError'));
          break;
        case 'AI returned an empty response.':
          editor.setAiError(tLoose('overlay.prompt.aiEmpty'));
          break;
        default:
          editor.setAiError(message || tLoose('overlay.prompt.aiError'));
          break;
      }
    }
  };

  const handleFill = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (disableFill) {
      return;
    }
    prompt.onFill(editor.value, editor.selectedSlot);
  };

  const handleSkip = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    prompt.onSkip();
  };

  return (
    <Stack gap="md">
      <Text fw={600} size="sm">
        {prompt.label.length > 0 ? prompt.label : t('overlay.prompt.heading')}
      </Text>
      {normalizedOptions.length > 0 ? (
        <Stack gap="xs">
          <Select
            data={selectOptions}
            value={editor.selectedSlot ?? null}
            placeholder={t('overlay.prompt.placeholder')}
            onChange={handleOptionChange}
            allowDeselect
            clearable
            comboboxProps={{ withinPortal: false }}
          />
          <Text size="xs" c="dimmed">
            {t('overlay.prompt.helper')}
          </Text>
        </Stack>
      ) : null}
      <Stack gap="xs">
        <Text fw={600} size="xs">
          {tLoose('overlay.prompt.inputLabel')}
        </Text>
        <Textarea
          id="apply-overlay-value"
          minRows={3}
          autosize
          value={editor.value}
          placeholder={tLoose('overlay.prompt.inputPlaceholder')}
          onChange={handleValueChange}
        />
      </Stack>
      {canRequestAi ? (
        <Stack gap="xs">
          <Text fw={600} size="xs">
            {tLoose('overlay.prompt.aiInstructionLabel')}
          </Text>
          <Textarea
            id="apply-overlay-instruction"
            minRows={2}
            autosize
            value={editor.instruction}
            placeholder={tLoose('overlay.prompt.aiInstructionPlaceholder')}
            onChange={handleInstructionChange}
          />
          <Group justify="space-between" align="center" gap="xs">
            <Text size="xs" c="dimmed">
              {tLoose('overlay.prompt.aiInstructionHint')}
            </Text>
            <Button
              type="button"
              variant="light"
              color="brand"
              size="xs"
              disabled={editor.aiLoading || editor.instruction.trim().length === 0}
              loading={editor.aiLoading}
              onClick={handleAskAi}
            >
              {editor.aiLoading
                ? tLoose('overlay.prompt.aiLoading')
                : tLoose('overlay.prompt.aiButton')}
            </Button>
          </Group>
          {editor.aiError ? (
            <Alert variant="light" color="red" radius="sm">
              {editor.aiError}
            </Alert>
          ) : null}
        </Stack>
      ) : null}
      <Group justify="flex-end" gap="xs">
        <Button
          type="button"
          variant="filled"
          color="brand"
          disabled={disableFill}
          onClick={handleFill}
        >
          {t('overlay.prompt.fill')}
        </Button>
        <Button type="button" variant="default" onClick={handleSkip}>
          {t('overlay.prompt.skip')}
        </Button>
      </Group>
    </Stack>
  );
}

function truncate(value: string, limit = 80): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}
