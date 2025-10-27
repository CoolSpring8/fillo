import { type ChangeEvent, type MouseEvent, useRef, useEffect } from 'react';
import type { HighlightRect, OverlayComponentState, PopoverPosition } from './types';
import { PromptEditor } from '../../shared/components/PromptEditor';
import type { PromptEditorState } from '../../shared/components/PromptEditor';
import type { PromptOption, PromptOptionSlot } from '../../../shared/apply/types';

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

  return (
    <>
      <div className="highlight" style={highlightStyle} />
      <div className="popover" ref={popoverRef} hidden={!isPopoverVisible} style={popoverStyle}>
        {state.mode === 'highlight' && state.label.trim().length > 0 ? (
          <div className="overlay-label">{state.label}</div>
        ) : null}
        {state.mode === 'prompt' ? <PromptContent state={state} /> : null}
      </div>
    </>
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

  const handleOptionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as PromptOptionSlot | '';
    if (!value) {
      editor.setSelectedSlot(null);
      editor.setValue('');
      editor.setAiError(null);
      return;
    }
    const selected = normalizedOptions.find((option) => option.slot === value);
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
    <>
      <div className="overlay-title">
        {prompt.label.length > 0 ? prompt.label : t('overlay.prompt.heading')}
      </div>
      {normalizedOptions.length > 0 ? (
        <div className="overlay-controls">
          <select
            className="overlay-select"
            value={editor.selectedSlot ?? ''}
            onChange={handleOptionChange}
          >
            <option value="">{t('overlay.prompt.placeholder')}</option>
            {normalizedOptions.map((option: PromptOption) => (
              <option key={option.slot} value={option.slot} data-value={option.value}>
                {`${option.label} · ${truncate(option.value)}`}
              </option>
            ))}
          </select>
          <div className="overlay-helper">{t('overlay.prompt.helper')}</div>
        </div>
      ) : null}
      <div className="overlay-section">
        <label className="overlay-field-label" htmlFor="apply-overlay-value">
          {tLoose('overlay.prompt.inputLabel')}
        </label>
        <textarea
          id="apply-overlay-value"
          className="overlay-textarea"
          rows={3}
          value={editor.value}
          placeholder={tLoose('overlay.prompt.inputPlaceholder')}
          onChange={handleValueChange}
        />
      </div>
      {canRequestAi ? (
        <div className="overlay-section">
          <label className="overlay-field-label" htmlFor="apply-overlay-instruction">
            {tLoose('overlay.prompt.aiInstructionLabel')}
          </label>
          <textarea
            id="apply-overlay-instruction"
            className="overlay-textarea"
            rows={2}
            value={editor.instruction}
            placeholder={tLoose('overlay.prompt.aiInstructionPlaceholder')}
            onChange={handleInstructionChange}
          />
          <div className="overlay-ai-footer">
            <div className="overlay-helper">{tLoose('overlay.prompt.aiInstructionHint')}</div>
            <button
              type="button"
              className="overlay-btn secondary"
              disabled={editor.aiLoading || editor.instruction.trim().length === 0}
              onClick={handleAskAi}
            >
              {editor.aiLoading ? tLoose('overlay.prompt.aiLoading') : tLoose('overlay.prompt.aiButton')}
            </button>
          </div>
          {editor.aiError ? <div className="overlay-error">{editor.aiError}</div> : null}
        </div>
      ) : null}
      <div className="overlay-actions">
        <button
          type="button"
          className="overlay-btn primary"
          disabled={disableFill}
          onClick={handleFill}
        >
          {t('overlay.prompt.fill')}
        </button>
        <button type="button" className="overlay-btn" onClick={handleSkip}>
          {t('overlay.prompt.skip')}
        </button>
      </div>
    </>
  );
}

function truncate(value: string, limit = 80): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}
