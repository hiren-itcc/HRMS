import type { z } from 'zod';

/**
 * Asking a zod schema about one field.
 *
 * `Field` has rendered the asterisk and the screen-reader `(required)` since
 * it was written; it just had to be told. It was told by hand, on 27 of 154
 * fields — so the other 127 looked optional, and any of the 27 could disagree
 * with the schema that actually rejects the submit. The schema already knows.
 *
 * Everything here is defensive on purpose. A field name that does not match
 * the schema is a bug worth finding, but not one worth blanking a form over:
 * an unknown path returns `undefined` and the field renders unmarked.
 */

/** Wrappers that hold another schema inside them. */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
  'lazy',
  'promise',
]);

// zod 4 keeps its structure on `_zod.def`, which carries no public type.
// biome-ignore lint/suspicious/noExplicitAny: reading zod's own internals
type AnySchema = any;

const defOf = (schema: AnySchema) => schema?._zod?.def;

/**
 * Strips the wrappers off a schema to reach the thing being described.
 *
 * `.refine()` is the one that matters here: in zod 4 it produces a `pipe`, so
 * an object schema with a cross-field rule on it — which most of the create
 * schemas have — is not an object until this unwraps it.
 */
function unwrap(schema: AnySchema): AnySchema {
  let current = schema;
  // Bounded rather than `while (true)`: a self-referential schema would
  // otherwise hang the render.
  for (let depth = 0; depth < 20; depth++) {
    const def = defOf(current);
    if (!def) return current;
    if (WRAPPERS.has(def.type)) {
      current = def.innerType ?? def.getter?.();
      continue;
    }
    if (def.type === 'pipe') {
      current = def.in;
      continue;
    }
    return current;
  }
  return current;
}

/**
 * The schema at a react-hook-form path — `city`, or `emergencyContacts.0.name`.
 *
 * Returned still wrapped, because the wrapper is the answer: `.optional()` is
 * exactly what the caller is asking about.
 */
export function schemaAt(schema: z.ZodType | undefined, path: string): z.ZodType | undefined {
  if (!schema || !path) return undefined;
  let current: AnySchema = unwrap(schema);

  for (const key of path.split('.')) {
    const def = defOf(current);
    if (!def) return undefined;
    if (def.type === 'object') {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      current = shape?.[key];
    } else if (def.type === 'array') {
      current = def.element;
    } else if (def.type === 'record') {
      current = def.valueType;
    } else {
      return undefined;
    }
    if (!current) return undefined;
    // Unwrap between steps so the *next* key can be looked up, but keep the
    // final one wrapped — see the doc comment.
    const next = unwrap(current);
    if (key !== path.split('.').at(-1)) current = next;
  }

  return current as z.ZodType;
}

/**
 * Whether the user must supply this field.
 *
 * Both halves are needed. `.optional()` and `.default()` report optional, but
 * `.nullable()` does not — and a nullable field is one the form may leave
 * empty, which is the same thing to somebody filling it in. Marking those
 * required would put an asterisk on every "no manager" select in the app.
 */
export function isRequiredField(schema: z.ZodType | undefined, path: string): boolean {
  const field = schemaAt(schema, path) as AnySchema;
  if (!field) return false;
  try {
    return !field.isOptional() && !field.isNullable();
  } catch {
    return false;
  }
}
