import type { ErrorObject } from 'ajv';

export type JsonResumeValidate = ((data: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};

declare const validate: JsonResumeValidate;
export = validate;
export default validate;
