import type { ChatMessage } from '../types';
import type { OnDeviceTemplateOptions } from './runtime';
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
  seedMessagesCount: number;
}

export interface OnDeviceInvocationOptions {
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
  template?: OnDeviceTemplateOptions;
}

export interface OnDeviceDownloadOptions {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

let sharedSessionPromise: Promise<ChromeLanguageModelSession> | null = null;
let sharedSession: ChromeLanguageModelSession | null = null;
let sharedSessionQueue: Promise<void> = Promise.resolve();
const seededSessions = new Map<string, Promise<ChromeLanguageModelSession>>();

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
  resetSeededSessions();
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

function resetSeededSessions(): void {
  for (const entry of seededSessions.values()) {
    void entry
      .then((session) => {
        try {
          session.destroy?.();
        } catch {
          // ignore destroy failures
        }
      })
      .catch(() => {
        // ignore failures during cleanup
      });
  }
  seededSessions.clear();
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

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return error instanceof Error && error.name === 'AbortError';
}

async function ensureSeededSession(
  languageModel: ChromeLanguageModel,
  template: OnDeviceTemplateOptions,
  signal: AbortSignal | undefined,
): Promise<ChromeLanguageModelSession> {
  const existing = seededSessions.get(template.key);
  if (existing) {
    try {
      return await existing;
    } catch (error) {
      seededSessions.delete(template.key);
      throw error;
    }
  }

  const creation = (async () => {
    const session = await languageModel.create(signal ? { signal } : undefined);
    try {
      if (template.seedMessages.length > 0) {
        await session.prompt(template.seedMessages, {
          temperature: 0,
          signal,
        });
      }
      return session;
    } catch (error) {
      try {
        session.destroy?.();
      } catch {
        // ignore destroy failures
      }
      throw error;
    }
  })();

  seededSessions.set(template.key, creation);

  try {
    return await creation;
  } catch (error) {
    seededSessions.delete(template.key);
    throw error;
  }
}

async function acquireSession(
  languageModel: ChromeLanguageModel,
  template: OnDeviceTemplateOptions | undefined,
  signal: AbortSignal | undefined,
): Promise<OnDeviceSessionHandle> {
  const seedCount = template?.seedMessages.length ?? 0;
  if (template && seedCount > 0) {
    try {
      const seededSession = await ensureSeededSession(languageModel, template, signal);
      if (typeof seededSession.clone === 'function') {
        try {
          const cloneOptions = signal ? { signal } : undefined;
          const clone = await seededSession.clone(cloneOptions);
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
            seedMessagesCount: seedCount,
          };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          seededSessions.delete(template.key);
          try {
            seededSession.destroy?.();
          } catch {
            // ignore destroy failures
          }
          console.warn('Chrome Prompt API clone() from seeded session failed. Falling back to shared session.', error);
        }
      } else {
        seededSessions.delete(template.key);
        try {
          seededSession.destroy?.();
        } catch {
          // ignore destroy failures
        }
        console.warn('Chrome Prompt API clone() unavailable on seeded session. Falling back to shared session.');
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn('Failed to prepare seeded on-device session. Falling back to shared session.', error);
    }
  }

  const base = await ensureSharedSession(languageModel);
  if (typeof base.clone === 'function') {
    try {
      const cloneOptions = signal ? { signal } : undefined;
      const clone = await base.clone(cloneOptions);
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
        seedMessagesCount: 0,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn('Chrome Prompt API clone() failed. Falling back to dedicated session.', error);
    }
  }

  // If clone is unavailable or failed, create a throwaway session to avoid mutating shared session state across concurrent calls.
  try {
    const session = await languageModel.create(signal ? { signal } : undefined);
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
      seedMessagesCount: 0,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    // As a last resort, fall back to the shared session with queued access.
    console.warn('Falling back to shared session for Chrome Prompt API calls.', error);
    return {
      session: base,
      release: () => {
        // queue release handled separately
      },
      isShared: true,
      seedMessagesCount: 0,
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

function matchesSeedPrefix(messages: ChatMessage[], seed: readonly ChatMessage[]): boolean {
  if (seed.length === 0) {
    return true;
  }
  if (messages.length < seed.length) {
    return false;
  }
  for (let index = 0; index < seed.length; index += 1) {
    const message = messages[index];
    const expected = seed[index];
    if (!message || message.role !== expected.role || message.content !== expected.content) {
      return false;
    }
  }
  return true;
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
  { responseSchema, temperature = 0, signal, template }: OnDeviceInvocationOptions = {},
): Promise<string> {
  const languageModel = await ensureLanguageModel('on-device');
  const handle = await acquireSession(languageModel, template, signal);

  let effectiveMessages = messages;
  if (template && handle.seedMessagesCount > 0 && matchesSeedPrefix(messages, template.seedMessages)) {
    const trimmed = messages.slice(handle.seedMessagesCount);
    if (trimmed.length > 0) {
      effectiveMessages = trimmed;
    }
  }

  const runPrompt = async () => {
    try {
      return await handle.session.prompt(effectiveMessages, {
        responseConstraint: responseSchema,
        temperature,
        signal,
      });
    } catch (error) {
      resetSharedSession();
      if (isAbortError(error)) {
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
