export const EXCEPTION_STEP_INTERNAL_FIELDS = {
  MESSAGE: '$message',
  TIMESTAMP: '$timestamp',
  TYPE: '$type',
  LEVEL: '$level',
} as const

const RESERVED_EXCEPTION_STEP_KEYS = new Set<string>(Object.values(EXCEPTION_STEP_INTERNAL_FIELDS))

export type ExceptionStep = {
  [EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: string
  [EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: string | number
  [EXCEPTION_STEP_INTERNAL_FIELDS.TYPE]?: string
  [EXCEPTION_STEP_INTERNAL_FIELDS.LEVEL]?: string
  [key: string]: unknown
}

export type ExceptionStepsConfig = {
  enabled?: boolean
  max_queue_size?: number
  max_bytes?: number
}

export type ResolvedExceptionStepsConfig = {
  enabled: boolean
  max_queue_size: number
  max_bytes: number
}

export const DEFAULT_EXCEPTION_STEPS_CONFIG: ResolvedExceptionStepsConfig = {
  enabled: true,
  max_queue_size: 20,
  max_bytes: 16384,
}

export function resolveExceptionStepsConfig(config?: ExceptionStepsConfig | null): ResolvedExceptionStepsConfig {
  if (!config) {
    return { ...DEFAULT_EXCEPTION_STEPS_CONFIG }
  }

  return {
    enabled: config.enabled ?? DEFAULT_EXCEPTION_STEPS_CONFIG.enabled,
    max_queue_size: normalizePositiveInteger(config.max_queue_size, DEFAULT_EXCEPTION_STEPS_CONFIG.max_queue_size),
    max_bytes: normalizePositiveInteger(config.max_bytes, DEFAULT_EXCEPTION_STEPS_CONFIG.max_bytes),
  }
}

export function stripReservedExceptionStepFields(properties?: Record<string, unknown> | null): {
  sanitizedProperties: Record<string, unknown>
  droppedKeys: string[]
} {
  if (!properties) {
    return { sanitizedProperties: {}, droppedKeys: [] }
  }

  const droppedKeys: string[] = []
  const sanitizedProperties = Object.keys(properties).reduce<Record<string, unknown>>((acc, key) => {
    if (RESERVED_EXCEPTION_STEP_KEYS.has(key)) {
      droppedKeys.push(key)
      return acc
    }
    acc[key] = properties[key]
    return acc
  }, {})

  return {
    sanitizedProperties,
    droppedKeys,
  }
}

export class ExceptionStepsBuffer {
  private _steps: ExceptionStep[] = []
  private _config: ResolvedExceptionStepsConfig

  constructor(config?: ExceptionStepsConfig | null) {
    this._config = resolveExceptionStepsConfig(config)
  }

  public setConfig(config?: ExceptionStepsConfig | null): void {
    this._config = resolveExceptionStepsConfig(config)
    this._trimToQueueSize()
  }

  public add(step: ExceptionStep): void {
    this._steps.push(step)
    this._trimToQueueSize()
  }

  public getAttachable(maxBytes: number = this._config.max_bytes): ExceptionStep[] {
    if (maxBytes <= 0) {
      return []
    }

    const attachableSteps: ExceptionStep[] = []
    let totalBytes = 0

    for (let i = this._steps.length - 1; i >= 0; i--) {
      const step = this._steps[i]
      const serializedStep = normalizeAndSerializeStep(step)
      if (!serializedStep) {
        continue
      }

      const bytes = getUtf8ByteLength(serializedStep.json)
      if (totalBytes + bytes > maxBytes) {
        break
      }

      attachableSteps.push(serializedStep.step)
      totalBytes += bytes
    }

    return attachableSteps.reverse()
  }

  public clear(): void {
    this._steps = []
  }

  public size(): number {
    return this._steps.length
  }

  private _trimToQueueSize(): void {
    if (this._config.max_queue_size <= 0) {
      this._steps = []
      return
    }

    while (this._steps.length > this._config.max_queue_size) {
      this._steps.shift()
    }
  }
}

function normalizePositiveInteger(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return fallback
  }

  const normalized = Math.floor(input)
  if (normalized < 0) {
    return fallback
  }

  return normalized
}

function normalizeAndSerializeStep(step: ExceptionStep): { step: ExceptionStep; json: string } | undefined {
  const json = safeStringify(step)
  if (!json) {
    return undefined
  }

  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }

    const parsedStep = parsed as Record<string, unknown>
    const message = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]
    const timestamp = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]

    if (typeof message !== 'string' || message.trim().length === 0) {
      return undefined
    }

    if (typeof timestamp !== 'string' && typeof timestamp !== 'number') {
      return undefined
    }

    const type = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.TYPE]
    if (type != null && typeof type !== 'string') {
      delete parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.TYPE]
    }

    const level = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.LEVEL]
    if (level != null && typeof level !== 'string') {
      delete parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.LEVEL]
    }

    return {
      step: parsedStep as ExceptionStep,
      json,
    }
  } catch {
    return undefined
  }
}

function safeStringify(value: unknown): string | undefined {
  const seen = new WeakSet<object>()

  try {
    return JSON.stringify(value, (_key, replacementValue: unknown) => {
      if (typeof replacementValue === 'bigint') {
        return replacementValue.toString()
      }

      if (typeof replacementValue === 'function' || typeof replacementValue === 'symbol') {
        return undefined
      }

      if (replacementValue instanceof Date) {
        return replacementValue.toISOString()
      }

      if (replacementValue instanceof Error) {
        return {
          name: replacementValue.name,
          message: replacementValue.message,
          stack: replacementValue.stack,
        }
      }

      if (replacementValue && typeof replacementValue === 'object') {
        if (seen.has(replacementValue)) {
          return '[Circular]'
        }
        seen.add(replacementValue)
      }

      return replacementValue
    })
  } catch {
    return undefined
  }
}

export function getUtf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length
  }

  const encoded = encodeURIComponent(value)
  let byteLength = 0
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      byteLength += 1
      i += 2
    } else {
      byteLength += 1
    }
  }

  return byteLength
}
