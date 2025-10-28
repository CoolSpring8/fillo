import type { ChatMessage } from '../types';
import {
  ProviderAvailabilityError,
  ProviderInvocationError,
} from './errors';

export type LanguageModelAvailability = 'unavailable' | 'available' | 'downloadable' | 'downloading';

interface ChromeLanguageModel {
  availability?: () => Promise<LanguageModelAvailability>;
  create: (options?: Record<string, unknown>) => Promise<ChromeLanguageModelSession>;
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
          'On-device model not downloaded. Open the options page to download Gemini Nano before continuing.',
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
