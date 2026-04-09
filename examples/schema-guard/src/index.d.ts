export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  expected?: unknown;
  received?: unknown;
  branches?: string[][];
}

export type SafeParseSuccess<T> = {
  success: true;
  data: T;
};

export type SafeParseFailure = {
  success: false;
  issues: ValidationIssue[];
};

export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

export interface RefinementContext<T> {
  value: T;
  path?: string;
  root?: unknown;
  error?: Error;
}

export interface Schema<T> {
  readonly kind: string;
  readonly description: string | null;
  parse(value: unknown): T;
  safeParse(value: unknown): SafeParseResult<T>;
  optional(): Schema<T | undefined>;
  nullable(): Schema<T | null>;
  default(defaultValue: Exclude<T, undefined> | (() => Exclude<T, undefined>)): Schema<Exclude<T, undefined>>;
  refine(check: (value: T) => boolean, message?: string | ((context: RefinementContext<T>) => string)): Schema<T>;
  transform<U>(mapper: (value: T) => U): Schema<U>;
  pipe<U>(nextSchema: Schema<U>): Schema<U>;
  describe(description: string): Schema<T>;
}

export type Infer<TSchema extends Schema<any>> = TSchema extends Schema<infer TValue> ? TValue : never;

type SchemaShape = Record<string, Schema<any>>;
type OptionalKeys<TShape extends SchemaShape> = {
  [TKey in keyof TShape]: undefined extends Infer<TShape[TKey]> ? TKey : never;
}[keyof TShape];
type RequiredKeys<TShape extends SchemaShape> = Exclude<keyof TShape, OptionalKeys<TShape>>;

type ObjectInfer<TShape extends SchemaShape> = {
  [TKey in RequiredKeys<TShape>]: Infer<TShape[TKey]>;
} & {
  [TKey in OptionalKeys<TShape>]?: Exclude<Infer<TShape[TKey]>, undefined>;
};

export class SchemaGuardError extends Error {
  constructor(issues: ValidationIssue[], message?: string);
  issues: ValidationIssue[];
}

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  message?: string | ((context: Record<string, unknown>) => string);
  messages?: Partial<Record<'type' | 'minLength' | 'maxLength' | 'pattern', string | ((context: Record<string, unknown>) => string)>>;
}

export interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
  message?: string | ((context: Record<string, unknown>) => string);
  messages?: Partial<Record<'type' | 'min' | 'max' | 'integer', string | ((context: Record<string, unknown>) => string)>>;
}

export interface ArrayOptions {
  minLength?: number;
  maxLength?: number;
  message?: string | ((context: Record<string, unknown>) => string);
  messages?: Partial<Record<'type' | 'minLength' | 'maxLength', string | ((context: Record<string, unknown>) => string)>>;
}

export interface ObjectOptions {
  allowUnknown?: boolean;
  message?: string | ((context: Record<string, unknown>) => string);
  messages?: Partial<Record<'type' | 'unknownKey', string | ((context: Record<string, unknown>) => string)>>;
}

export function formatIssues(issues: ValidationIssue[]): string;
export function string(options?: StringOptions): Schema<string>;
export function number(options?: NumberOptions): Schema<number>;
export function boolean(options?: { message?: string }): Schema<boolean>;
export function literal<TValue extends string | number | boolean | null>(expectedValue: TValue, options?: { message?: string; messages?: Partial<Record<'literal', string>> }): Schema<TValue>;
export function enumValue<const TValue extends readonly (string | number | boolean)[]>(values: TValue, options?: { message?: string; messages?: Partial<Record<'enum', string>> }): Schema<TValue[number]>;
export function array<TSchema extends Schema<any>>(itemSchema: TSchema, options?: ArrayOptions): Schema<Array<Infer<TSchema>>>;
export function object<TShape extends SchemaShape>(shape: TShape, options?: ObjectOptions): Schema<ObjectInfer<TShape>>;
export function union<TSchemas extends readonly Schema<any>[]>(schemas: TSchemas, options?: { message?: string; messages?: Partial<Record<'union', string>> }): Schema<Infer<TSchemas[number]>>;
export function any(): Schema<unknown>;
export function optional<TSchema extends Schema<any>>(schema: TSchema): Schema<Infer<TSchema> | undefined>;
export function nullable<TSchema extends Schema<any>>(schema: TSchema): Schema<Infer<TSchema> | null>;

export const sg: {
  any: typeof any;
  array: typeof array;
  boolean: typeof boolean;
  enum: typeof enumValue;
  literal: typeof literal;
  nullable: typeof nullable;
  number: typeof number;
  object: typeof object;
  optional: typeof optional;
  string: typeof string;
  union: typeof union;
};
