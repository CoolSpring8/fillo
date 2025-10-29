export type ProviderKind = 'on-device' | 'openai';

export interface OnDeviceProviderConfig {
  kind: 'on-device';
}

export interface OpenAIProviderConfig {
  kind: 'openai';
  apiKey: string;
  model: string;
  apiBaseUrl: string;
}

export type ProviderConfig = OnDeviceProviderConfig | OpenAIProviderConfig;

export type ProviderSnapshot =
  | OnDeviceProviderConfig
  | {
      kind: 'openai';
      model: string;
      apiBaseUrl: string;
    };

export interface StoredFileReference {
  name: string;
  type: string;
  size: number;
  storageKey: string;
}

export type ResumeExtractionResult = Record<string, unknown>;

export interface ProfileRecord {
  id: string;
  createdAt: string;
  provider?: ProviderSnapshot;
  parsedAt?: string;
  sourceFile?: StoredFileReference;
  rawText: string;
  resume?: unknown;
  validation?: {
    valid: boolean;
    errors?: string[];
  };
}

export interface AppSettings {
  provider: ProviderConfig;
  adapters: string[];
  autoFallback: 'skip' | 'pause';
  highlightOverlay: boolean;
}

export type ChatMessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}
