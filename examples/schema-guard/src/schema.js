function success(value) {
  return { ok: true, value };
}

function failure(issues) {
  return { ok: false, issues: Array.isArray(issues) ? issues : [issues] };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function formatPath(path) {
  if (!path.length) {
    return '$';
  }

  return `$${path
    .map((segment) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }

      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
        return `.${segment}`;
      }

      return `["${String(segment).replaceAll('"', '\\"')}"]`;
    })
    .join('')}`;
}

function makeIssue(path, code, message, extras = {}) {
  return {
    path: formatPath(path),
    code,
    message,
    ...extras,
  };
}

function resolveMessage(candidate, context, fallback) {
  if (typeof candidate === 'function') {
    return candidate(context);
  }

  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }

  return fallback;
}

function schemaMessage(options, key, context, fallback) {
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    if (options.messages && Object.prototype.hasOwnProperty.call(options.messages, key)) {
      return resolveMessage(options.messages[key], context, fallback);
    }

    if (key === 'type' && Object.prototype.hasOwnProperty.call(options, 'message')) {
      return resolveMessage(options.message, context, fallback);
    }
  }

  return fallback;
}

export class SchemaGuardError extends Error {
  constructor(issues, message = 'Schema validation failed') {
    super(message);
    this.name = 'SchemaGuardError';
    this.issues = issues;
  }
}

export function formatIssues(issues) {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
}

class BaseSchema {
  constructor(kind, parser, metadata = {}) {
    this.kind = kind;
    this._parser = parser;
    this.isOptional = metadata.isOptional ?? false;
    this.description = metadata.description ?? null;
  }

  _run(value, path, root) {
    return this._parser(value, path, root);
  }

  safeParse(value) {
    const result = this._run(value, [], value);
    if (result.ok) {
      return { success: true, data: result.value };
    }

    return { success: false, issues: result.issues };
  }

  parse(value) {
    const result = this.safeParse(value);
    if (result.success) {
      return result.data;
    }

    throw new SchemaGuardError(result.issues, formatIssues(result.issues));
  }

  optional() {
    return optional(this);
  }

  nullable() {
    return nullable(this);
  }

  default(defaultValue) {
    return new BaseSchema(
      `${this.kind}.default`,
      (value, path, root) => {
        if (value === undefined) {
          return success(typeof defaultValue === 'function' ? defaultValue() : defaultValue);
        }

        return this._run(value, path, root);
      },
      { description: this.description },
    );
  }

  refine(check, message = 'Validation failed') {
    return new BaseSchema(
      `${this.kind}.refine`,
      (value, path, root) => {
        const parsed = this._run(value, path, root);
        if (!parsed.ok) {
          return parsed;
        }

        try {
          if (check(parsed.value)) {
            return parsed;
          }
        } catch (error) {
          return failure(
            makeIssue(path, 'custom', resolveMessage(message, { value: parsed.value, error }, error.message), {
              received: parsed.value,
            }),
          );
        }

        return failure(
          makeIssue(path, 'custom', resolveMessage(message, { value: parsed.value, path: formatPath(path), root }, 'Validation failed'), {
            received: parsed.value,
          }),
        );
      },
      { description: this.description, isOptional: this.isOptional },
    );
  }

  transform(mapper) {
    return new BaseSchema(
      `${this.kind}.transform`,
      (value, path, root) => {
        const parsed = this._run(value, path, root);
        if (!parsed.ok) {
          return parsed;
        }

        try {
          return success(mapper(parsed.value));
        } catch (error) {
          return failure(
            makeIssue(path, 'transform', error.message || 'Transform failed', {
              received: parsed.value,
            }),
          );
        }
      },
      { description: this.description, isOptional: this.isOptional },
    );
  }

  pipe(nextSchema) {
    return new BaseSchema(
      `${this.kind}.pipe`,
      (value, path, root) => {
        const parsed = this._run(value, path, root);
        if (!parsed.ok) {
          return parsed;
        }

        return nextSchema._run(parsed.value, path, root);
      },
      { description: this.description, isOptional: this.isOptional && nextSchema.isOptional },
    );
  }

  describe(description) {
    return new BaseSchema(this.kind, this._parser, {
      description,
      isOptional: this.isOptional,
    });
  }
}

export function string(options = {}) {
  return new BaseSchema('string', (value, path) => {
    if (typeof value !== 'string') {
      return failure(
        makeIssue(
          path,
          'type',
          schemaMessage(options, 'type', { expected: 'string', received: value }, 'Expected string'),
          { expected: 'string', received: value },
        ),
      );
    }

    if (options.minLength !== undefined && value.length < options.minLength) {
      return failure(
        makeIssue(
          path,
          'min_length',
          schemaMessage(
            options,
            'minLength',
            { value, minLength: options.minLength },
            `Expected at least ${options.minLength} characters`,
          ),
          { expected: `length >= ${options.minLength}`, received: value.length },
        ),
      );
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      return failure(
        makeIssue(
          path,
          'max_length',
          schemaMessage(
            options,
            'maxLength',
            { value, maxLength: options.maxLength },
            `Expected at most ${options.maxLength} characters`,
          ),
          { expected: `length <= ${options.maxLength}`, received: value.length },
        ),
      );
    }

    if (options.pattern && !options.pattern.test(value)) {
      return failure(
        makeIssue(
          path,
          'pattern',
          schemaMessage(options, 'pattern', { value, pattern: options.pattern }, 'String does not match required pattern'),
          { expected: String(options.pattern), received: value },
        ),
      );
    }

    return success(value);
  });
}

export function number(options = {}) {
  return new BaseSchema('number', (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return failure(
        makeIssue(
          path,
          'type',
          schemaMessage(options, 'type', { expected: 'number', received: value }, 'Expected finite number'),
          { expected: 'number', received: value },
        ),
      );
    }

    if (options.integer && !Number.isInteger(value)) {
      return failure(
        makeIssue(
          path,
          'integer',
          schemaMessage(options, 'integer', { value }, 'Expected integer'),
          { expected: 'integer', received: value },
        ),
      );
    }

    if (options.min !== undefined && value < options.min) {
      return failure(
        makeIssue(
          path,
          'min',
          schemaMessage(options, 'min', { value, min: options.min }, `Expected number >= ${options.min}`),
          { expected: `>= ${options.min}`, received: value },
        ),
      );
    }

    if (options.max !== undefined && value > options.max) {
      return failure(
        makeIssue(
          path,
          'max',
          schemaMessage(options, 'max', { value, max: options.max }, `Expected number <= ${options.max}`),
          { expected: `<= ${options.max}`, received: value },
        ),
      );
    }

    return success(value);
  });
}

export function boolean(options = {}) {
  return new BaseSchema('boolean', (value, path) => {
    if (typeof value !== 'boolean') {
      return failure(
        makeIssue(
          path,
          'type',
          schemaMessage(options, 'type', { expected: 'boolean', received: value }, 'Expected boolean'),
          { expected: 'boolean', received: value },
        ),
      );
    }

    return success(value);
  });
}

export function literal(expectedValue, options = {}) {
  return new BaseSchema('literal', (value, path) => {
    if (value !== expectedValue) {
      return failure(
        makeIssue(
          path,
          'literal',
          schemaMessage(options, 'literal', { expected: expectedValue, received: value }, `Expected literal ${JSON.stringify(expectedValue)}`),
          { expected: expectedValue, received: value },
        ),
      );
    }

    return success(value);
  });
}

export function enumValue(values, options = {}) {
  return new BaseSchema('enum', (value, path) => {
    if (!values.includes(value)) {
      return failure(
        makeIssue(
          path,
          'enum',
          schemaMessage(options, 'enum', { expected: values, received: value }, `Expected one of ${values.map((entry) => JSON.stringify(entry)).join(', ')}`),
          { expected: values, received: value },
        ),
      );
    }

    return success(value);
  });
}

export function array(itemSchema, options = {}) {
  return new BaseSchema('array', (value, path, root) => {
    if (!Array.isArray(value)) {
      return failure(
        makeIssue(
          path,
          'type',
          schemaMessage(options, 'type', { expected: 'array', received: value }, 'Expected array'),
          { expected: 'array', received: value },
        ),
      );
    }

    if (options.minLength !== undefined && value.length < options.minLength) {
      return failure(
        makeIssue(
          path,
          'min_length',
          schemaMessage(options, 'minLength', { value, minLength: options.minLength }, `Expected at least ${options.minLength} items`),
          { expected: `length >= ${options.minLength}`, received: value.length },
        ),
      );
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      return failure(
        makeIssue(
          path,
          'max_length',
          schemaMessage(options, 'maxLength', { value, maxLength: options.maxLength }, `Expected at most ${options.maxLength} items`),
          { expected: `length <= ${options.maxLength}`, received: value.length },
        ),
      );
    }

    const parsedItems = [];
    const issues = [];
    for (let index = 0; index < value.length; index += 1) {
      const parsed = itemSchema._run(value[index], [...path, index], root);
      if (parsed.ok) {
        parsedItems.push(parsed.value);
      } else {
        issues.push(...parsed.issues);
      }
    }

    if (issues.length) {
      return failure(issues);
    }

    return success(parsedItems);
  });
}

export function object(shape, options = {}) {
  return new BaseSchema('object', (value, path, root) => {
    if (!isPlainObject(value)) {
      return failure(
        makeIssue(
          path,
          'type',
          schemaMessage(options, 'type', { expected: 'object', received: value }, 'Expected plain object'),
          { expected: 'object', received: value },
        ),
      );
    }

    const output = {};
    const issues = [];

    for (const [key, schema] of Object.entries(shape)) {
      const parsed = schema._run(value[key], [...path, key], root);
      if (parsed.ok) {
        if (parsed.value !== undefined) {
          output[key] = parsed.value;
        }
      } else {
        issues.push(...parsed.issues);
      }
    }

    if (!options.allowUnknown) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(shape, key)) {
          issues.push(
            makeIssue(
              [...path, key],
              'unknown_key',
              schemaMessage(options, 'unknownKey', { key }, `Unknown key "${key}"`),
              { received: key },
            ),
          );
        }
      }
    } else {
      for (const [key, entryValue] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(output, key) && !Object.prototype.hasOwnProperty.call(shape, key)) {
          output[key] = entryValue;
        }
      }
    }

    if (issues.length) {
      return failure(issues);
    }

    return success(output);
  });
}

export function union(schemas, options = {}) {
  return new BaseSchema('union', (value, path, root) => {
    const branchIssues = [];
    for (const schema of schemas) {
      const parsed = schema._run(value, path, root);
      if (parsed.ok) {
        return parsed;
      }
      branchIssues.push(parsed.issues);
    }

    return failure(
      makeIssue(
        path,
        'union',
        schemaMessage(options, 'union', { received: value }, `Expected value matching one of ${schemas.length} schemas`),
        { received: value, branches: branchIssues.map((issues) => issues.map((issue) => issue.message)) },
      ),
    );
  });
}

export function any() {
  return new BaseSchema('any', (value) => success(value));
}

export function optional(schema) {
  return new BaseSchema(
    `${schema.kind}.optional`,
    (value, path, root) => {
      if (value === undefined) {
        return success(undefined);
      }

      return schema._run(value, path, root);
    },
    { isOptional: true, description: schema.description },
  );
}

export function nullable(schema) {
  return new BaseSchema(
    `${schema.kind}.nullable`,
    (value, path, root) => {
      if (value === null) {
        return success(null);
      }

      return schema._run(value, path, root);
    },
    { description: schema.description, isOptional: schema.isOptional },
  );
}

export const sg = {
  any,
  array,
  boolean,
  enum: enumValue,
  literal,
  nullable,
  number,
  object,
  optional,
  string,
  union,
};
