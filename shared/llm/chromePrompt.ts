import type { ChatMessage } from '../types';
import {
  ProviderAvailabilityError,
  ProviderInvocationError,
} from './errors';

export type LanguageModelAvailability = 'unavailable' | 'available' | 'downloadable' | 'downloading';

interface ChromeLanguageModelDownloadProgressEvent extends Event {
  loaded: number;
}

interface ChromeLanguageModelMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: ChromeLanguageModelDownloadProgressEvent) => void,
  ): void;
  removeEventListener?(
    type: 'downloadprogress',
    listener: (event: ChromeLanguageModelDownloadProgressEvent) => void,
  ): void;
}

interface ChromeLanguageModelCreateOptions {
  monitor?: (monitor: ChromeLanguageModelMonitor) => void;
  signal?: AbortSignal;
}

interface ChromeLanguageModel {
  availability?: () => Promise<LanguageModelAvailability>;
  create: (options?: ChromeLanguageModelCreateOptions) => Promise<ChromeLanguageModelSession>;
}

interface ChromeLanguageModelSession {
  prompt: (input: ChatMessage[] | string, options?: Record<string, unknown>) => Promise<string>;
  clone?: (options?: Record<string, unknown>) => Promise<ChromeLanguageModelSession>;
  destroy?: () => void;
}

declare global {
  interface Window {
    LanguageModel?: ChromeLanguageModel;
    ai?: {
      languageModel?: ChromeLanguageModel;
    };
  }
}

interface OnDeviceSessionHandle {
  session: ChromeLanguageModelSession;
  release: () => void;
  isShared: boolean;
}

export interface OnDeviceInvocationOptions {
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
}

export interface OnDeviceDownloadOptions {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

let sharedSessionPromise: Promise<ChromeLanguageModelSession> | null = null;
let sharedSession: ChromeLanguageModelSession | null = null;
let sharedSessionQueue: Promise<void> = Promise.resolve();

function getLanguageModel(): ChromeLanguageModel | undefined {
  const root = globalThis as typeof globalThis & {
    LanguageModel?: ChromeLanguageModel;
  };
  return root.LanguageModel;
}

function resetSharedSession(): void {
  try {
    sharedSession?.destroy?.();
  } catch {
    // ignore destroy failures
  }
  sharedSession = null;
  sharedSessionPromise = null;
  sharedSessionQueue = Promise.resolve();
}

async function ensureLanguageModel(kind: 'on-device'): Promise<ChromeLanguageModel> {
  const languageModel = getLanguageModel();
  if (!languageModel) {
    throw new ProviderAvailabilityError(kind, 'On-device model unavailable in this context.');
  }
  const availability = await ensureOnDeviceAvailability();
  if (availability !== 'available') {
    switch (availability) {
      case 'downloadable':
        throw new ProviderAvailabilityError(
          kind,
          'On-device model not downloaded. Use the download button in options to fetch Gemini Nano before continuing.',
          availability,
        );
      case 'downloading':
        throw new ProviderAvailabilityError(
          kind,
          'On-device model is still downloading. Please wait for the download to complete.',
          availability,
        );
      default:
        throw new ProviderAvailabilityError(
          kind,
          'On-device model unavailable. Enable Chrome built-in AI or choose another provider.',
          availability,
        );
    }
  }
  return languageModel;
}

async function ensureSharedSession(languageModel: ChromeLanguageModel): Promise<ChromeLanguageModelSession> {
  if (sharedSession) {
    return sharedSession;
  }
  if (!sharedSessionPromise) {
    sharedSessionPromise = languageModel
      .create()
      .catch((error) => {
        sharedSessionPromise = null;
        throw error;
      })
      .then((session) => {
        sharedSession = session;
        return session;
      });
  }
  sharedSession = await sharedSessionPromise;
  return sharedSession;
}

async function acquireSession(languageModel: ChromeLanguageModel): Promise<OnDeviceSessionHandle> {
  const base = await ensureSharedSession(languageModel);
  if (typeof base.clone === 'function') {
    try {
      const clone = await base.clone();
      return {
        session: clone,
        release: () => {
          try {
            clone.destroy?.();
          } catch {
            // noop
          }
        },
        isShared: false,
      };
    } catch (error) {
      console.warn('Chrome Prompt API clone() failed. Falling back to dedicated session.', error);
    }
  }

  // If clone is unavailable or failed, create a throwaway session to avoid mutating shared session state across concurrent calls.
  try {
    const session = await languageModel.create();
    return {
      session,
      release: () => {
        try {
          session.destroy?.();
        } catch {
          // noop
        }
      },
      isShared: false,
    };
  } catch (error) {
    // As a last resort, fall back to the shared session with queued access.
    console.warn('Falling back to shared session for Chrome Prompt API calls.', error);
    return {
      session: base,
      release: () => {
        // queue release handled separately
      },
      isShared: true,
    };
  }
}

function queueSharedSessionWork<T>(work: () => Promise<T>): Promise<T> {
  const previous = sharedSessionQueue;
  let resolveNext: (() => void) | null = null;
  sharedSessionQueue = new Promise<void>((resolve) => {
    resolveNext = resolve;
  });
  return previous
    .catch(() => {
      // ignore previous failure; continue regardless
    })
    .then(work)
    .finally(() => {
      resolveNext?.();
    });
}

export async function ensureOnDeviceAvailability(): Promise<LanguageModelAvailability> {
  const languageModel = getLanguageModel();
  if (!languageModel) {
    return 'unavailable';
  }
  if (!languageModel.availability) {
    return 'unavailable';
  }
  try {
    return await languageModel.availability();
  } catch {
    return 'unavailable';
  }
}

function clampProgress(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export async function downloadOnDeviceModel({
  onProgress,
  signal,
}: OnDeviceDownloadOptions = {}): Promise<void> {
  const languageModel = getLanguageModel();
  if (!languageModel) {
    throw new ProviderAvailabilityError('on-device', 'Chrome on-device AI is unavailable in this context.');
  }

  const progressListener = (event: ChromeLanguageModelDownloadProgressEvent) => {
    const progress = clampProgress(event.loaded);
    onProgress?.(progress);
  };

  let createdSession: ChromeLanguageModelSession | null = null;
  try {
    createdSession = await languageModel.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', progressListener);
      },
      signal,
    });
    onProgress?.(1);
  } catch (error) {
    onProgress?.(0);
    if (error instanceof ProviderAvailabilityError || error instanceof ProviderInvocationError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProviderInvocationError('on-device', `Failed to download on-device model: ${reason}`);
  } finally {
    try {
      createdSession?.destroy?.();
    } catch {
      // ignore destroy failures
    }
  }
}

export async function promptOnDevice(
  messages: ChatMessage[],
  { responseSchema, temperature = 0, signal }: OnDeviceInvocationOptions = {},
): Promise<string> {
  const languageModel = await ensureLanguageModel('on-device');
  const handle = await acquireSession(languageModel);

  const runPrompt = async () => {
    try {
      return await handle.session.prompt(messages, {
        responseConstraint: responseSchema,
        temperature,
        signal,
      });
    } catch (error) {
      resetSharedSession();
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderInvocationError('on-device', `On-device prompt failed: ${reason}`);
    }
  };

  if (handle.isShared) {
    return queueSharedSessionWork(runPrompt);
  }

  try {
    return await runPrompt();
  } finally {
    handle.release();
  }
}
