export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateResume(resume: unknown): ValidationResult {
  if (resume !== null && typeof resume === 'object' && !Array.isArray(resume)) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: ['Resume payload must be a JSON object.'],
  };
}
