import { InconclusiveMatchError, matchFeatureFlagProperty } from '@posthog/core'
import type { FlagProperty, PropertyGroup } from './types.js'

export { InconclusiveMatchError }

export class RequiresServerEvaluation extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, RequiresServerEvaluation.prototype)
  }
}

// Convex historically accepted leading-zero SemVer identifiers and parseInt-compatible wildcard
// components. Keep that behavior explicit until product parity is decided.
export function matchProperty(
  property: FlagProperty,
  propertyValues: Record<string, any>,
  warnFunction?: (msg: string) => void
): boolean {
  return matchFeatureFlagProperty(property, propertyValues, {
    warnFunction,
    semverParsingPolicy: 'legacy-permissive',
  })
}

export function matchCohort(
  property: FlagProperty,
  propertyValues: Record<string, any>,
  cohortProperties: Record<string, PropertyGroup>,
  debugMode: boolean = false
): boolean {
  const cohortId = String(property.value)
  if (!(cohortId in cohortProperties)) {
    throw new RequiresServerEvaluation(
      `cohort ${cohortId} not found in local cohorts - likely a static cohort that requires server evaluation`
    )
  }
  return matchPropertyGroup(cohortProperties[cohortId], propertyValues, cohortProperties, debugMode)
}

export function matchPropertyGroup(
  propertyGroup: PropertyGroup,
  propertyValues: Record<string, any>,
  cohortProperties: Record<string, PropertyGroup>,
  debugMode: boolean = false
): boolean {
  if (!propertyGroup) return true

  const propertyGroupType = propertyGroup.type
  const properties = propertyGroup.values

  if (!properties || properties.length === 0) return true

  let errorMatchingLocally = false

  if ('values' in properties[0]) {
    for (const prop of properties as PropertyGroup[]) {
      try {
        const matches = matchPropertyGroup(prop, propertyValues, cohortProperties, debugMode)
        if (propertyGroupType === 'AND') {
          if (!matches) return false
        } else {
          if (matches) return true
        }
      } catch (err) {
        if (err instanceof RequiresServerEvaluation) throw err
        if (err instanceof InconclusiveMatchError) {
          if (debugMode) console.debug(`Failed to compute property ${prop} locally: ${err}`)
          errorMatchingLocally = true
        } else {
          throw err
        }
      }
    }

    if (errorMatchingLocally) {
      throw new InconclusiveMatchError("Can't match cohort without a given cohort property value")
    }
    return propertyGroupType === 'AND'
  } else {
    for (const prop of properties as FlagProperty[]) {
      try {
        let matches: boolean
        if (prop.type === 'cohort') {
          matches = matchCohort(prop, propertyValues, cohortProperties, debugMode)
        } else if (prop.type === 'flag') {
          if (debugMode) {
            console.warn(
              `[FEATURE FLAGS] Flag dependency filters are not supported in local evaluation. ` +
                `Skipping condition with dependency on flag '${prop.key || 'unknown'}'`
            )
          }
          // Mark the group as inconclusive so we don't silently grant cohort membership in an AND
          // group whose missing flag dependency would have evaluated to false (or deny it in an OR
          // group whose flag dependency would have matched). Falls through to the
          // InconclusiveMatchError throw at the end of the loop.
          errorMatchingLocally = true
          continue
        } else {
          matches = matchProperty(prop, propertyValues)
        }

        const negation = prop.negation || false
        if (propertyGroupType === 'AND') {
          if (!matches && !negation) return false
          if (matches && negation) return false
        } else {
          if (matches && !negation) return true
          if (!matches && negation) return true
        }
      } catch (err) {
        if (err instanceof RequiresServerEvaluation) throw err
        if (err instanceof InconclusiveMatchError) {
          if (debugMode) console.debug(`Failed to compute property ${prop} locally: ${err}`)
          errorMatchingLocally = true
        } else {
          throw err
        }
      }
    }

    if (errorMatchingLocally) {
      throw new InconclusiveMatchError("can't match cohort without a given cohort property value")
    }
    return propertyGroupType === 'AND'
  }
}
