import { runInNewContext } from 'node:vm'

import {
  ErrorCoercer,
  ErrorEventCoercer,
  ObjectCoercer,
  PromiseRejectionEventCoercer,
  StringCoercer,
  PrimitiveCoercer,
} from './coercers'
import { StackFrame } from './types'
import { ErrorPropertiesBuilder } from './error-properties-builder'
import { chromeStackLineParser, createStackParser } from './parsers'

// Aggregate children share one flat exception list with per-entry relationship metadata.
describe('ErrorPropertiesBuilder AggregateError children', () => {
  const builder = new ErrorPropertiesBuilder(
    [
      new ErrorEventCoercer(),
      new PromiseRejectionEventCoercer(),
      new ErrorCoercer(),
      new ObjectCoercer(),
      new StringCoercer(),
      new PrimitiveCoercer(),
    ],
    createStackParser('web:javascript', chromeStackLineParser)
  )

  it('captures rejected alternatives and their frames from native Promise.any', async () => {
    const first = new TypeError('first alternative')
    const second = new RangeError('second alternative')
    const aggregate = await Promise.any([Promise.reject(first), Promise.reject(second)]).catch((error) => error)

    expect(aggregate).toBeInstanceOf(AggregateError)
    expect(aggregate.errors).toEqual([first, second])
    const exceptions = builder.buildFromUnknown(aggregate).$exception_list

    expect(exceptions[0].type).toBe('AggregateError')
    for (const child of [first, second]) {
      const directFrames = builder.buildFromUnknown(child).$exception_list[0].stacktrace?.frames
      expect(directFrames?.length).toBeGreaterThan(0)
      const captured = exceptions.find((exception) => exception.value === child.message)
      expect(captured).toBeDefined()
      expect(captured?.stacktrace?.frames).toEqual(directFrames)
    }
  })

  it('captures array-valued errors from a custom-named cross-realm aggregate', () => {
    const aggregate = runInNewContext(`(() => {
      const error = new AggregateError([new TypeError('cross-realm alternative')], 'group')
      error.name = 'CustomGroupError'
      return error
    })()`)
    expect(aggregate).not.toBeInstanceOf(Error)
    const exceptions = builder.buildFromUnknown(aggregate).$exception_list

    expect(exceptions[0]).toMatchObject({ type: 'CustomGroupError', value: 'group' })
    expect(exceptions).toContainEqual(expect.objectContaining({ type: 'TypeError', value: 'cross-realm alternative' }))
  })

  it.each(['ValidationError', 'AggregateError'])('does not treat a domain error named %s as an aggregate', (name) => {
    const cause = new Error('underlying cause')
    const domainError = Object.assign(new Error('invalid input', { cause }), {
      name,
      errors: [{ path: 'email', message: 'invalid email' }, new Error('validation detail')],
    })
    const exceptions = builder.buildFromUnknown(domainError).$exception_list

    expect(exceptions.map((exception) => exception.value)).toEqual(['invalid input', 'underlying cause'])
    expect(exceptions[1].mechanism).toMatchObject({ exception_id: 1, parent_id: 0, source: 'cause' })
  })

  it('does not read the errors accessor of an ordinary error', () => {
    const domainError = new Error('invalid input')
    const getErrors = vi.fn(() => [new Error('validation detail')])
    Object.defineProperty(domainError, 'errors', { get: getErrors })

    expect(builder.buildFromUnknown(domainError).$exception_list).toHaveLength(1)
    expect(getErrors).not.toHaveBeenCalled()
  })

  it('does not traverse domain-error details inside a native aggregate', () => {
    const domainError = Object.assign(new Error('invalid input'), { errors: [new Error('validation detail')] })
    const aggregate = new AggregateError([domainError, new Error('next member')], 'group')
    const exceptions = builder.buildFromUnknown(aggregate).$exception_list

    expect(exceptions.map((exception) => exception.value)).toEqual(['group', 'invalid input', 'next member'])
    expect(exceptions[2].mechanism).toMatchObject({ exception_id: 2, parent_id: 0, source: 'member' })
  })

  it('does not treat cross-realm validation errors as aggregates', () => {
    const domainError = runInNewContext(`(() => {
      class ValidationError extends Error {
        errors = [{ message: 'invalid email' }]
      }
      return new ValidationError('invalid input')
    })()`)

    expect(domainError).not.toBeInstanceOf(Error)
    expect(builder.buildFromUnknown(domainError).$exception_list).toHaveLength(1)
  })

  it('preserves custom-named cross-realm aggregate subclasses', () => {
    const aggregate = runInNewContext(`(() => {
      class CustomGroupError extends AggregateError {}
      const error = new CustomGroupError([new Error('member')], 'group')
      error.name = 'CustomGroupError'
      return error
    })()`)
    const exceptions = builder.buildFromUnknown(aggregate).$exception_list

    expect(aggregate).not.toBeInstanceOf(AggregateError)
    expect(exceptions.map((exception) => exception.value)).toEqual(['group', 'member'])
    expect(exceptions[1].mechanism).toMatchObject({ exception_id: 1, parent_id: 0, source: 'member' })
  })

  it('bounds aggregate detection of a cyclic proxy prototype without losing the root', () => {
    const errorBuilder = new ErrorPropertiesBuilder(
      [new ErrorCoercer()],
      createStackParser('web:javascript', chromeStackLineParser)
    )
    let inspections = 0
    const input: Error = new Proxy(new Error('malformed prototype'), {
      get: (target, key) => (key === Symbol.toStringTag ? 'Error' : Reflect.get(target, key)),
      getPrototypeOf: () => {
        inspections++
        return input
      },
    })

    expect(errorBuilder.buildFromUnknown(input).$exception_list).toMatchObject([{ value: 'malformed prototype' }])
    expect(inspections).toBeGreaterThan(0)
    expect(inspections).toBeLessThanOrEqual(101)
  })

  it('retains both the ordinary cause and aggregate alternatives', () => {
    const aggregate = new AggregateError([new Error('alternative')], 'group', { cause: new Error('cause') })
    const exceptions = builder.buildFromUnknown(aggregate, {
      mechanism: { handled: false, type: 'onunhandledrejection' },
    }).$exception_list

    expect(exceptions[0]).toMatchObject({ value: 'group', mechanism: { handled: false } })
    expect(exceptions).toContainEqual(
      expect.objectContaining({
        value: 'cause',
        mechanism: { type: 'chained', source: 'cause', synthetic: false, exception_id: 1, parent_id: 0 },
      })
    )
    expect(exceptions).toContainEqual(expect.objectContaining({ value: 'alternative' }))
  })

  it('keeps root, causes, then children in depth-first input order with their own stacks', () => {
    const cause = new Error('cause', { cause: new Error('cause origin') })
    const child = new Error('first', { cause: new Error('first cause') })
    const nested = new AggregateError([new Error('nested child')], 'nested', { cause: new Error('nested cause') })
    const aggregate = new AggregateError([child, nested, new Error('last')], 'root', { cause })
    const inputs = [
      aggregate,
      cause,
      cause.cause,
      child,
      child.cause,
      nested,
      nested.cause,
      nested.errors[0],
      aggregate.errors[2],
    ] as Error[]
    for (const [index, input] of inputs.entries()) {
      input.stack = `Error: ${input.message}\n    at frame${index} (https://example.com/file${index}.js:12:34)`
      Object.freeze(input)
    }
    Object.freeze(aggregate.errors)
    const properties = builder.buildFromUnknown(aggregate, {
      mechanism: { type: 'onunhandledrejection', handled: false },
    })
    expect(Object.keys(properties).sort()).toEqual(['$exception_level', '$exception_list'])
    expect(properties.$exception_list.map((exception) => exception.value)).toEqual(inputs.map((input) => input.message))
    properties.$exception_list.forEach((exception, index) => {
      expect(Object.keys(exception).sort()).toEqual(['mechanism', 'stacktrace', 'type', 'value'])
      expect(exception.mechanism).toEqual(
        index === 0
          ? { type: 'onunhandledrejection', handled: false, synthetic: false, exception_id: 0 }
          : {
              type: 'chained',
              source: ['cause', 'cause', 'member', 'cause', 'member', 'cause', 'member', 'member'][index - 1],
              synthetic: false,
              exception_id: index,
              parent_id: [0, 1, 0, 3, 0, 5, 5, 0][index - 1],
            }
      )
      expect(exception.stacktrace?.frames).toEqual([
        expect.objectContaining({ filename: `https://example.com/file${index}.js`, lineno: 12, colno: 34 }),
      ])
    })
  })

  it('retains deep ordinary cause chains without inventing nested handled state or repeating cycles', () => {
    let error = new Error('6')
    for (let index = 5; index >= 0; index--) {
      error = new Error(String(index), { cause: error })
    }
    const exceptions = builder.buildFromUnknown(error, { mechanism: { handled: false } }).$exception_list
    expect(exceptions.map((exception) => exception.value)).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    expect(exceptions.map((exception) => exception.mechanism?.handled)).toEqual([
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    error.cause = error
    expect(builder.buildFromUnknown(error).$exception_list.map((exception) => exception.value)).toEqual(['0'])
  })

  it('retains cause and member edges beyond the old depth bound', () => {
    const tooDeep = new AggregateError([new Error('deep child')], 'depth4', { cause: new Error('deep cause') })
    const depth3 = new Error('depth3', { cause: tooDeep })
    const depth2 = new AggregateError([depth3], 'depth2')
    const depth1 = new Error('depth1', { cause: depth2 })
    const root = new AggregateError([depth1, new Error('sibling')], 'root')
    expect(builder.buildFromUnknown(root).$exception_list.map((exception) => exception.value)).toEqual([
      'root',
      'depth1',
      'depth2',
      'depth3',
      'depth4',
      'deep cause',
      'deep child',
      'sibling',
    ])
  })

  it('omits ancestor cycles and emits shared children only in their first position', () => {
    const shared = new Error('shared')
    const root = new AggregateError([], 'root')
    const nested = new AggregateError([root, shared], 'nested', { cause: root })
    root.errors.push(root, nested, shared, shared)
    expect(builder.buildFromUnknown(root).$exception_list.map((exception) => exception.value)).toEqual([
      'root',
      'nested',
      'shared',
    ])
    expect(root.errors).toEqual([root, nested, shared, shared])
  })

  it('bounds wide aggregate output to 50 entries including root and causes', () => {
    const children = Array.from({ length: 1000 }, (_, index) => new Error(String(index)))
    const unread = vi.fn(() => {
      throw new Error('past the traversal budget')
    })
    Object.defineProperty(children, '48', { get: unread })
    const root = new AggregateError([], 'root', { cause: new Error('cause') })
    root.errors = children
    const exceptions = builder.buildFromUnknown(root).$exception_list
    expect(exceptions.map((exception) => exception.value)).toEqual([
      'root',
      'cause',
      ...Array.from({ length: 48 }, (_, index) => String(index)),
    ])
    expect(unread).not.toHaveBeenCalled()
    expect(builder.buildFromUnknown(new AggregateError([new Error('next')], 'next root')).$exception_list).toHaveLength(
      2
    )
  })

  it('shares the emission budget across nested groups', () => {
    const groups = Array.from(
      { length: 100 },
      (_, index) => new AggregateError([new Error(`child ${index}`)], `group ${index}`)
    )
    const exceptions = builder.buildFromUnknown(new AggregateError(groups, 'root')).$exception_list
    expect(exceptions).toHaveLength(50)
    expect(exceptions.slice(-3).map((exception) => exception.value)).toEqual(['group 23', 'child 23', 'group 24'])
  })

  it.each(['error event', 'rejection event', 'object'])(
    'unwraps an aggregate in an %s without duplicating entries',
    (kind) => {
      const aggregate = new AggregateError([new Error('child')], 'root')
      const input =
        kind === 'error event'
          ? { [Symbol.toStringTag]: 'ErrorEvent', error: aggregate }
          : kind === 'rejection event'
            ? new CustomEvent('unhandledrejection', { detail: { reason: aggregate } })
            : { error: aggregate }
      expect(builder.buildFromUnknown(input).$exception_list.map((exception) => exception.value)).toEqual([
        'root',
        'child',
      ])
    }
  )

  it('bounds self-referencing wrappers inside aggregate children', () => {
    const wrapper = { [Symbol.toStringTag]: 'ErrorEvent', error: undefined as unknown }
    wrapper.error = wrapper
    const root = new AggregateError([wrapper, new Error('last')], 'root')
    expect(builder.buildFromUnknown(root).$exception_list.map((exception) => exception.value)).toEqual([
      'root',
      'Unknown error',
      'last',
    ])
  })

  it.each([undefined, null, 'not an array', { length: 1, 0: new Error('not a child') }])(
    'ignores malformed errors collections: %s',
    (errors) => {
      const root = new AggregateError([], 'root')
      root.errors = errors as any
      expect(builder.buildFromUnknown(root).$exception_list.map((exception) => exception.value)).toEqual(['root'])
    }
  )

  it('ignores a throwing errors getter without losing the root or cause', () => {
    const root = new AggregateError([], 'root', { cause: new Error('cause') })
    Object.defineProperty(root, 'errors', {
      get() {
        throw new Error('unreadable')
      },
    })
    expect(builder.buildFromUnknown(root).$exception_list.map((exception) => exception.value)).toEqual([
      'root',
      'cause',
    ])
  })

  it('uses existing coercers for non-error members and fallback for unreadable members', () => {
    const values = ['text', 42, null, undefined, { message: 'object member' }]
    const root = new AggregateError(values, 'root')
    Object.defineProperty(root.errors, '5', {
      get() {
        throw new Error('unreadable')
      },
    })
    const malformed = new Error('malformed')
    Object.defineProperty(malformed, 'message', {
      get() {
        throw new Error('unreadable message')
      },
    })
    root.errors.push(malformed, new Error('last'))
    const exceptions = builder.buildFromUnknown(root, { syntheticException: new Error('capture site') }).$exception_list
    expect(exceptions.slice(1, 6)).toEqual(
      values.map((value, index) => ({
        ...builder.buildFromUnknown(value).$exception_list[0],
        mechanism: { type: 'chained', source: 'member', synthetic: true, exception_id: index + 1, parent_id: 0 },
      }))
    )
    expect(exceptions.slice(6).map((exception) => exception.value)).toEqual(['Unknown error', 'Unknown error', 'last'])
    expect(exceptions.slice(1, 8).every((exception) => !exception.stacktrace)).toBe(true)
  })

  it('applies chunk IDs and frame modifiers independently to every entry', async () => {
    const inputs = [new AggregateError([], 'root'), new Error('cause'), new Error('child')]
    inputs.forEach((input, index) => {
      input.stack = `Error\n    at f (https://example.com/chunk${index}.js:1:2)`
    })
    inputs[0].cause = inputs[1]
    ;(inputs[0] as AggregateError).errors.push(inputs[2])
    vi.stubGlobal('_posthogChunkIds', Object.fromEntries(inputs.map((input, index) => [input.stack, `chunk-${index}`])))
    const modifier = vi.fn(async (frames: StackFrame[]) => frames.map((frame) => ({ ...frame, module: 'modified' })))
    const modifiedBuilder = new ErrorPropertiesBuilder(
      [new ErrorCoercer()],
      createStackParser('web:javascript', chromeStackLineParser),
      [modifier]
    )
    try {
      const exceptions = await modifiedBuilder.modifyFrames(modifiedBuilder.buildFromUnknown(inputs[0]).$exception_list)
      expect(modifier).toHaveBeenCalledTimes(3)
      exceptions.forEach((exception, index) => {
        expect(exception.stacktrace?.frames).toEqual([
          expect.objectContaining({ chunk_id: `chunk-${index}`, module: 'modified' }),
        ])
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
