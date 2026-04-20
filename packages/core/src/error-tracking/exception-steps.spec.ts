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

    it('evicts oldest steps when queue size is exceeded', () => {
      const buffer = new ExceptionStepsBuffer({ max_queue_size: 2 })
      buffer.add(makeStep('one'))
      buffer.add(makeStep('two'))
      buffer.add(makeStep('three'))

      const attachable = buffer.getAttachable(10000)
      expect(attachable.map((s) => s.$message)).toEqual(['two', 'three'])
    })

    it('keeps the most recent steps when max bytes are constrained', () => {
      const buffer = new ExceptionStepsBuffer({ max_queue_size: 10 })
      const one = makeStep('one')
      const two = makeStep('two')

      buffer.add(one)
      buffer.add(two)

      const oneSize = getUtf8ByteLength(JSON.stringify(one))
      expect(buffer.getAttachable(oneSize).map((s) => s.$message)).toEqual(['two'])
    })

    it('skips malformed steps that cannot be normalized', () => {
      const buffer = new ExceptionStepsBuffer({ max_queue_size: 10 })
      buffer.add({ $message: '', $timestamp: '2026-01-01T00:00:00.000Z' })
      buffer.add(makeStep('valid'))

      expect(buffer.getAttachable(10000).map((s) => s.$message)).toEqual(['valid'])
    })

    it('clears all steps', () => {
      const buffer = new ExceptionStepsBuffer({ max_queue_size: 10 })
      buffer.add(makeStep('one'))
      buffer.clear()
      expect(buffer.size()).toBe(0)
    })
  })
})
