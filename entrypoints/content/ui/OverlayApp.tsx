import {
  type ChangeEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PromptOptionSlot } from '../../../shared/apply/types';
import type { HighlightRect, OverlayComponentState, PopoverPosition } from './types';

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

  const highlightStyle = highlightRect?.visible
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
  const isPopoverVisible = shouldShowPopover && Boolean(popoverPosition?.visible);
  const popoverStyle = isPopoverVisible
    ? {
        left: `${Math.round(popoverPosition!.x)}px`,
        top: `${Math.round(popoverPosition!.y)}px`,
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
  const prompt = state.prompt;
  const normalizedOptions = useMemo(() => prompt.options ?? [], [prompt.options]);
  const [selectedSlot, setSelectedSlot] = useState<PromptOptionSlot | null>(prompt.defaultSlot ?? null);
  const [currentValue, setCurrentValue] = useState<string>(
    prompt.defaultValue ?? prompt.preview ?? '',
  );

  useEffect(() => {
    const options = prompt.options ?? [];
    let slot: PromptOptionSlot | null = prompt.defaultSlot ?? null;
    let value = prompt.defaultValue ?? prompt.preview ?? '';

    if (options.length > 0) {
      const existing = slot ? options.find((option) => option.slot === slot) : undefined;
      if (existing) {
        value = existing.value;
      } else if (!value && options.length === 1) {
        slot = options[0].slot;
        value = options[0].value;
      }
    }

    setSelectedSlot(slot);
    setCurrentValue(value);
  }, [prompt, state.version]);

  const previewText = currentValue.trim().length > 0
    ? currentValue
    : prompt.preview && prompt.preview.trim().length > 0
      ? prompt.preview
      : t('overlay.prompt.awaitingSelection');

  const disableFill = normalizedOptions.length > 0 && currentValue.trim().length === 0;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as PromptOptionSlot | '';
    if (!value) {
      setSelectedSlot(null);
      setCurrentValue('');
      return;
    }

    const selected = normalizedOptions.find((option) => option.slot === value);
    setSelectedSlot(selected?.slot ?? null);
    setCurrentValue(selected?.value ?? '');
  };

  const handleFill = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (disableFill) {
      return;
    }
    prompt.onFill(currentValue, selectedSlot);
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
            value={selectedSlot ?? ''}
            onChange={handleChange}
          >
            <option value="">{t('overlay.prompt.placeholder')}</option>
            {normalizedOptions.map((option) => (
              <option key={option.slot} value={option.slot} data-value={option.value}>
                {`${option.label} · ${truncate(option.value)}`}
              </option>
            ))}
          </select>
          <div className="overlay-helper">{t('overlay.prompt.helper')}</div>
        </div>
      ) : null}
      <div className="overlay-body">{previewText}</div>
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
