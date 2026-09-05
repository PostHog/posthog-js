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

  it('gives the same frames when the stack holds a second repeated section', () => {
    // Stacks repeat outside the recursion too, such as a test runner that calls itself once per
    // nested block. The frames of that section have to keep the recursion's own partial copy.
    const withOuterRepeat = (dropInnermost: number): (string | undefined)[] =>
      names(
        [
          OVERFLOW,
          ...recursion(['a', 'b'], 30).slice(dropInnermost),
          frame('handleClick', 90),
          frame('walk', 91),
          frame('walk', 91),
          frame('main', 92),
        ].join('\n')
      )

    expect(withOuterRepeat(0)).toEqual(['main', 'walk', 'handleClick', 'b', 'a'])
    expect(withOuterRepeat(1)).toEqual(withOuterRepeat(0))
  })

  it('gives the same frames when a cycle that repeats a call site is all that is left', () => {
    // One copy of a cycle can hold the same call site twice, and the innermost frame carries a
    // column of its own, so a single frame does not say which rotation of the copy this throw is.
    const cycle = [frame('a', 1, 10), frame('b', 2), frame('a', 1, 20), frame('c', 4)]
    const lines: string[] = []

    for (let i = 0; i < 30; i++) {
      lines.push(...cycle)
    }

    const fromCut = (dropInnermost: number): (string | undefined)[] =>
      names([OVERFLOW, ...lines.slice(dropInnermost)].join('\n'))

    expect(fromCut(0)).toEqual(['c', 'a', 'b', 'a'])
    expect(fromCut(1)).toEqual(fromCut(0))
    expect(fromCut(2)).toEqual(fromCut(0))
    expect(fromCut(3)).toEqual(fromCut(0))
  })

  it('reads the outer frames a leftover copy would have pushed past the frame limit', () => {
    // The leftover copy is dropped once the whole stack is read, so it must not hold a slot of the
    // frame limit while the parser is still reading the frames outside the recursion.
    const callers: string[] = []

    for (let i = 0; i < 48; i++) {
      callers.push(frame(`c${i}`, i + 10))
    }

    const withCallers = (dropInnermost: number): (string | undefined)[] =>
      names([OVERFLOW, ...recursion(['a', 'b'], 30).slice(dropInnermost), ...callers].join('\n'))

    expect(withCallers(0)).toHaveLength(50)
    expect(withCallers(1)).toEqual(withCallers(0))
  })

  it('gives the same frames when the recursion path calls one function twice in a row', () => {
    // A minified bundle holds one line number per function, so the two calls to `b` are told apart
    // by their column alone. The kept copy holds both of them, and every cut agrees on it.
    const cycle = [frame('a', 1), frame('b', 2, 10), frame('b', 2, 20)]
    const lines: string[] = []

    for (let i = 0; i < 30; i++) {
      lines.push(...cycle)
    }

    const fromCut = (dropInnermost: number): (string | undefined)[] =>
      names([OVERFLOW, ...lines.slice(dropInnermost), frame('handleClick', 90), frame('main', 91)].join('\n'))

    expect(fromCut(0)).toEqual(['main', 'handleClick', 'b', 'b', 'a'])
    expect(fromCut(1)).toEqual(fromCut(0))
    expect(fromCut(2)).toEqual(fromCut(0))
  })

  it('keeps minified frames that share a name and a line but not a column', () => {
    // A minified bundle puts every function on one line and hands out the same short names, so the
    // column is all that tells two of them apart. Nothing repeats here, so no frame may be dropped.
    const stack = [
      'Error: boom',
      frame('i', 1, 310),
      frame('t', 1, 4821),
      frame('t', 1, 9137),
      frame('r', 1, 2210),
      frame('onClick', 1, 640),
    ].join('\n')

    expect(parse(stack).map((f) => `${f.function}:${f.colno}`)).toEqual([
      'onClick:640',
      'r:2210',
      't:9137',
      't:4821',
      'i:310',
    ])
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
