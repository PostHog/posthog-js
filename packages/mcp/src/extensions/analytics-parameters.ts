export interface AnalyticsInjectableJsonSchema {
  additionalProperties?: boolean
  allOf?: unknown
  anyOf?: unknown
  oneOf?: unknown
  properties?: Record<string, unknown>
  required?: string[]
  type?: string
}

export function hasAnalyticsParameter(
  schema: AnalyticsInjectableJsonSchema | undefined,
  parameterName: string
): boolean {
  return !!schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, parameterName)
}

export function canInjectAnalyticsParameter(
  schema: AnalyticsInjectableJsonSchema | undefined,
  parameterName: string
): boolean {
  return !hasAnalyticsParameter(schema, parameterName) && !schema?.oneOf && !schema?.allOf && !schema?.anyOf
}
