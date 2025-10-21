declare module '*.validate.cjs' {
  import type { ErrorObject } from 'ajv';

  export type JsonSchemaValidate = ((data: unknown) => boolean) & {
    errors?: ErrorObject[] | null;
  };

  const validate: JsonSchemaValidate;
  export = validate;
  export default validate;
}
