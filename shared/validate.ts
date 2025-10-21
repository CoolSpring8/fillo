import type { ErrorObject } from 'ajv';
import * as compiledValidateModule from '@/shared/schema/jsonresume-v1.validate.cjs';

type ResumeValidator = ((data: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};

const compiled = compiledValidateModule as unknown as {
  default?: ResumeValidator;
} & ResumeValidator;

const validate = (compiled.default ?? compiled) as ResumeValidator;

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateResume(resume: unknown): ValidationResult {
  const isValid = validate(resume);
  if (isValid) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: formatErrors(validate.errors),
  };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return ['Resume payload must be a JSON object.'];
  }

  return errors.map((error) => {
    const params = error.params as Record<string, unknown>;
    if (error.keyword === 'type' && params.type === 'object' && !error.instancePath) {
      return 'Resume payload must be a JSON object.';
    }
    if (error.keyword === 'required' && typeof params.missingProperty === 'string') {
      const path = error.instancePath ? `${error.instancePath}/` : '/';
      return `${path}${params.missingProperty} is required.`;
    }
    const path = error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/';
    return `${path}: ${error.message ?? 'Invalid value.'}`;
  });
}
