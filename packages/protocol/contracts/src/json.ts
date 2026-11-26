/**
 * Responsibilities: Define JSON value types and a minimal JSON Schema subset used for action parameters.
 * Contracts: `validateJson` reports every violation with a dotted path; an empty list means the value conforms.
 * Constraints: Supports only the keywords declared in `JsonSchema`; unknown keywords are ignored by design.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** Supported JSON Schema subset for action parameters and tool arguments. */
export interface JsonSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: readonly JsonPrimitive[]
  minimum?: number
  maximum?: number
  items?: JsonSchema
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  additionalProperties?: boolean
}

/** Object schema used for the parameters of one action. */
export interface JsonObjectSchema extends JsonSchema {
  type: 'object'
}

/** One schema violation. */
export interface JsonViolation {
  path: string
  message: string
}

/** Narrow an unknown value to a plain JSON object. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typeMatches(schema: JsonSchema, value: JsonValue): boolean {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isJsonObject(value)
  }
}

/**
 * Validate a JSON value against the supported schema subset.
 * @param schema - schema to check against.
 * @param value - candidate value.
 * @param path - path prefix used in violation reports.
 * @returns every violation found; empty when the value conforms.
 */
export function validateJson(schema: JsonSchema, value: JsonValue, path = '$'): JsonViolation[] {
  if (!typeMatches(schema, value)) {
    return [{ path, message: `expected ${schema.type}` }]
  }
  const violations: JsonViolation[] = []
  if (schema.enum !== undefined && !schema.enum.includes(value as JsonPrimitive)) {
    violations.push({ path, message: `expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}` })
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) violations.push({ path, message: `must be >= ${schema.minimum}` })
    if (schema.maximum !== undefined && value > schema.maximum) violations.push({ path, message: `must be <= ${schema.maximum}` })
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => violations.push(...validateJson(schema.items as JsonSchema, item, `${path}[${index}]`)))
  }
  if (isJsonObject(value)) {
    const properties = schema.properties ?? {}
    for (const key of schema.required ?? []) {
      if (!(key in value)) violations.push({ path: `${path}.${key}`, message: 'is required' })
    }
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key]
      if (property !== undefined) violations.push(...validateJson(property, item, `${path}.${key}`))
      else if (schema.additionalProperties === false) violations.push({ path: `${path}.${key}`, message: 'is not allowed' })
    }
  }
  return violations
}
