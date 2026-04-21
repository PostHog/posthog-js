import {
  EXCEPTION_STEP_INTERNAL_FIELDS,
  ExceptionStep,
  ExceptionStepsBuffer,
  getUtf8ByteLength,
  resolveExceptionStepsConfig,
  stripReservedExceptionStepFields,
} from './exception-steps'

describe('exception steps', () => {
  describe('resolveExceptionStepsConfig', () => {
    it('uses defaults when no config is passed', () => {
      expect(resolveExceptionStepsConfig()).toEqual({
        enabled: true,
        max_queue_size: 20,
        max_bytes: 32768,
      })
    })

    it('falls back to defaults for invalid values', () => {
      expect(resolveExceptionStepsConfig({ max_queue_size: -1, max_bytes: Number.NaN })).toEqual({
        enabled: true,
        max_queue_size: 20,
        max_bytes: 32768,
      })
    })
  })

  describe('stripReservedExceptionStepFields', () => {
    it('strips reserved fields and keeps custom properties', () => {
      const result = stripReservedExceptionStepFields({
        [EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: 'should-strip',
        [EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: 'should-strip',
        custom: true,
      })

      expect(result).toEqual({
        sanitizedProperties: { custom: true },
        droppedKeys: [EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE, EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP],
      })
    })
  })

  describe('ExceptionStepsBuffer', () => {
    const makeStep = (message: string): ExceptionStep => ({
      [EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: message,
      [EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: '2026-01-01T00:00:00.000Z',
    })

    it.each([
      {
        desc: 'evicts oldest steps when queue size is exceeded',
        config: { max_queue_size: 2 },
        steps: [makeStep('one'), makeStep('two'), makeStep('three')],
        maxBytes: 10000,
        expected: ['two', 'three'],
      },
      {
        desc: 'keeps the most recent steps when max bytes are constrained',
        config: { max_queue_size: 10 },
        steps: [makeStep('one'), makeStep('two')],
        maxBytes: getUtf8ByteLength(JSON.stringify(makeStep('one'))),
        expected: ['two'],
      },
      {
        desc: 'skips malformed steps that cannot be normalized',
        config: { max_queue_size: 10 },
        steps: [{ $message: '', $timestamp: '2026-01-01T00:00:00.000Z' } as ExceptionStep, makeStep('valid')],
        maxBytes: 10000,
        expected: ['valid'],
      },
    ])('$desc', ({ config, steps, maxBytes, expected }) => {
      const buffer = new ExceptionStepsBuffer(config)
      for (const step of steps) {
        buffer.add(step)
      }
      expect(buffer.getAttachable(maxBytes).map((s) => s.$message)).toEqual(expected)
    })

    it('clears all steps', () => {
      const buffer = new ExceptionStepsBuffer({ max_queue_size: 10 })
      buffer.add(makeStep('one'))
      buffer.clear()
      expect(buffer.size()).toBe(0)
    })
  })
})
