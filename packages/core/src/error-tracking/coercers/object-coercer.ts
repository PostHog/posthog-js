import { isEmptyString, isError, isEvent, isString } from '@/utils'
import { CoercingContext, ErrorTrackingCoercer, ExceptionLike, SeverityLevel, severityLevels } from '../types'

type ObjectLike = Record<string, unknown>

export class ObjectCoercer implements ErrorTrackingCoercer<ObjectLike> {
  match(candidate: unknown): candidate is ObjectLike {
    return typeof candidate === 'object' && candidate !== null
  }

  coerce(candidate: ObjectLike, ctx: CoercingContext): ExceptionLike | undefined {
    const errorProperty = this.getErrorPropertyFromObject(candidate)
    if (errorProperty) {
      return ctx.coerceUnknown(errorProperty)
    } else {
      return {
        type: this.getType(candidate),
        value: this.getValue(candidate),
        stack: ctx.syntheticException?.stack,
        level: this.isSeverityLevel(candidate.level) ? candidate.level : 'error',
        synthetic: true,
      }
    }
  }

  getType(err: Record<string, unknown>): string {
    return isEvent(err) ? err.constructor.name : 'Error'
  }

  getValue(err: object) {
    if ('name' in err && typeof err.name === 'string') {
      let message = `'${err.name}' captured as exception`

      if ('message' in err && typeof err.message === 'string') {
        message += ` with message '${err.message}'`
      }

      return message
    } else if ('message' in err && typeof err.message === 'string') {
      return err.message
    }

    const className = this.getObjectClassName(err)
    const keys = this.extractExceptionKeysForMessage(err)

    return `${className && className !== 'Object' ? `'${className}'` : 'Object'} captured as exception with keys: ${keys}`
  }

  /**
   * Given any captured exception, extract its keys and create a sorted
   * and truncated list that will be used inside the event message.
   * eg. `Non-error exception captured with keys: foo, bar, baz`
   */
  private extractExceptionKeysForMessage(err: object, maxLength = 40): string {
    const keys = Object.keys(err)
    keys.sort()

    if (!keys.length) {
      return '[object has no keys]'
    }

    for (let i = keys.length; i > 0; i--) {
      const serialized = keys.slice(0, i).join(', ')
      if (serialized.length > maxLength) {
        continue
      }
      if (i === keys.length) {
        return serialized
      }
      return serialized.length <= maxLength ? serialized : `${serialized.slice(0, maxLength)}...`
    }

    return ''
  }

  private isSeverityLevel(x: unknown): x is SeverityLevel {
    return isString(x) && !isEmptyString(x) && severityLevels.indexOf(x as SeverityLevel) >= 0
  }

  /** If a plain object has a property that is an `Error`, return this error. */
  private getErrorPropertyFromObject(obj: Record<string, unknown>): Error | undefined {
    for (const prop in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        const value = obj[prop]
        if (isError(value)) {
          return value
        }
      }
    }

    return undefined
  }

  private getObjectClassName(obj: unknown): string | undefined {
    try {
      const prototype: unknown | null = Object.getPrototypeOf(obj)
      return prototype ? prototype.constructor.name : undefined
    } catch (e) {
      return undefined
    }
  }
}
