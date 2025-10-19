import type { ProviderKind } from '../types';

export class ProviderConfigurationError extends Error {
  readonly kind: ProviderKind;

  constructor(kind: ProviderKind, message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
    this.kind = kind;
  }
}

export class ProviderAvailabilityError extends Error {
  readonly kind: ProviderKind;
  readonly availability?: string;

  constructor(kind: ProviderKind, message: string, availability?: string) {
    super(message);
    this.name = 'ProviderAvailabilityError';
    this.kind = kind;
    this.availability = availability;
  }
}

export class ProviderInvocationError extends Error {
  readonly kind: ProviderKind;

  constructor(kind: ProviderKind, message: string) {
    super(message);
    this.name = 'ProviderInvocationError';
    this.kind = kind;
  }
}

export class NoProviderConfiguredError extends Error {
  constructor() {
    super('No AI provider configured. Please configure a provider in the options page before continuing.');
    this.name = 'NoProviderConfiguredError';
  }
}
