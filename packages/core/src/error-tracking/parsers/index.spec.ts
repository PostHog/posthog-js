import { createDefaultStackParser } from './index'

describe('createDefaultStackParser repeated cycle collapsing', () => {
  const parse = createDefaultStackParser()

  const OVERFLOW = 'RangeError: Maximum call stack size exceeded'

  const frame = (func: string, line: number, column: number = 10): string =>
    `    at ${func} (https://posthog.com/app.js:${line}:${column})`

  function recursion(cycle: string[], repeats: number): string[] {
    const frames: string[] = []

    for (let i = 0; i < repeats; i++) {
      cycle.forEach((func, index) => frames.push(frame(func, index + 1)))
    }

    return frames
  }

  // The runtime lists the innermost frame first and cuts the stack wherever the depth ran out, so
  // `dropInnermost` is how many frames of the cycle that cut took off the innermost end.
  function overflowStack(cycle: string[], repeats: number, dropInnermost: number = 0): string {
    return [
      OVERFLOW,
      ...recursion(cycle, repeats).slice(dropInnermost),
      frame('handleClick', 90),
      frame('main', 91),
    ].join('\n')
  }

  function names(stack: string): (string | undefined)[] {
    return parse(stack).map((f) => f.function)
  }

  it('keeps one copy of a recursion cycle', () => {
    expect(names(overflowStack(['a', 'b'], 30))).toEqual(['main', 'handleClick', 'b', 'a'])
  })

  it('keeps one copy when a single function calls itself', () => {
    expect(names(overflowStack(['a'], 60))).toEqual(['main', 'handleClick', 'a'])
  })

  it('keeps the outer frames a recursion used to push past the frame limit', () => {
    // Without collapsing, the frame limit is spent on the cycle and the frames that name the
    // caller never reach the event.
    const frames = names(overflowStack(['a', 'b'], 400))
    expect(frames).toContain('main')
    expect(frames).toContain('handleClick')
  })

  it('gives the same frames wherever the runtime cut the recursion', () => {
    // The overflow can happen in either function of the pair, which used to change the frames and
    // so open a new issue for every throw.
    const pair = names(overflowStack(['a', 'b'], 30))
    expect(names(overflowStack(['a', 'b'], 30, 1))).toEqual(pair)

    const triple = names(overflowStack(['a', 'b', 'c'], 30))
    expect(names(overflowStack(['a', 'b', 'c'], 30, 1))).toEqual(triple)
    expect(names(overflowStack(['a', 'b', 'c'], 30, 2))).toEqual(triple)
  })

  it('gives the same frames when the runtime cut everything outside the recursion', () => {
    // The runtime keeps the innermost frames, so a deep recursion can push every other frame out of
    // the stack. Nothing then says which function of the cycle ran out of stack first.
    const recursionOnly = (dropInnermost: number): (string | undefined)[] =>
      names([OVERFLOW, ...recursion(['a', 'b'], 40).slice(dropInnermost)].join('\n'))

    expect(recursionOnly(1)).toEqual(recursionOnly(0))
  })

  it('ignores the column of the call that ran out of stack', () => {
    // Runtimes report the position of the failed call for the innermost frame, so that frame has a
    // column of its own even though it is the same call site as the frames under it.
    const stack = [OVERFLOW, frame('a', 1, 4), ...recursion(['a', 'b'], 3).slice(1), frame('handleClick', 90)].join(
      '\n'
    )

    expect(parse(stack).map((f) => `${f.function}:${f.colno}`)).toEqual(['handleClick:10', 'b:10', 'a:10'])
  })

  it('keeps frames that repeat without a complete second cycle', () => {
    const stack = ['Error: boom', frame('a', 1), frame('b', 2), frame('a', 1), frame('main', 91)].join('\n')
    expect(names(stack)).toEqual(['main', 'a', 'b', 'a'])
  })

  it('keeps calls to one function from different call sites', () => {
    const stack = ['Error: boom', frame('a', 1), frame('a', 2), frame('a', 3), frame('main', 91)].join('\n')
    expect(names(stack)).toEqual(['main', 'a', 'a', 'a'])
  })
})
