// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

// 💖 open source

// This was originally forked from https://github.com/csnover/TraceKit, and was largely
// re-written as part of raven - js.
//
// This code was later copied to the JavaScript mono - repo and further modified and
// refactored over the years.

// Copyright (c) 2013 Onur Can Cakmak onur.cakmak@gmail.com and all TraceKit contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this
// software and associated documentation files(the 'Software'), to deal in the Software
// without restriction, including without limitation the rights to use, copy, modify,
// merge, publish, distribute, sublicense, and / or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following
// conditions:
//
// The above copyright notice and this permission notice shall be included in all copies
// or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
// PARTICULAR PURPOSE AND NONINFRINGEMENT.IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
// CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
// OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { Platform, StackFrame, StackLineParser, StackParser } from '../types'
import { UNKNOWN_FUNCTION } from './base'
import { chromeStackLineParser } from './chrome'
import { geckoStackLineParser } from './gecko'
export { chromeStackLineParser } from './chrome'
export { winjsStackLineParser } from './winjs'
export { geckoStackLineParser } from './gecko'
export { opera10StackLineParser, opera11StackLineParser } from './opera'
export { nodeStackLineParser } from './node'

const WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/
const STACKTRACE_FRAME_LIMIT = 50

// A recursion spends the whole frame limit on one repeating cycle, so the frames that name the real
// culprit sit past the limit, and where the runtime cut the stack decides which frames are left.
// One fault then opens a new error tracking issue on every throw. The parser keeps a single copy of
// the cycle instead, which holds the outer frames inside the limit and gives every throw the same
// frames. Cycles longer than this are rare, and each extra length costs a comparison pass.
const MAX_REPEATED_CYCLE_LENGTH = 10
// How many lines to read, now that a recursion no longer stops the parser at the frame limit.
const STACKTRACE_LINE_LIMIT = 1000

// For the innermost frame the runtime reports the position of the call that ran out of stack, so
// the innermost copy of a cycle carries a column of its own. Compare frames without the column, so
// that copy still counts as part of the cycle. A frame with no function name does not say which
// code it holds, so those frames have to match on the column as well.
function isSameFrame(a: StackFrame, b: StackFrame): boolean {
  return (
    a.filename === b.filename &&
    a.function === b.function &&
    a.module === b.module &&
    a.lineno === b.lineno &&
    (a.function !== UNKNOWN_FUNCTION || a.colno === b.colno)
  )
}

interface RepeatedCycle {
  start: number
  length: number
}

// Removes the cycle that ends at the last frame when the frames before it are the same cycle, and
// reports where the copy that was kept sits. This runs after every frame is added, so a recursion
// never grows past one copy of its cycle.
function collapseRepeatedCycle(frames: StackFrame[]): RepeatedCycle | undefined {
  for (let length = 1; length <= MAX_REPEATED_CYCLE_LENGTH; length++) {
    const start = frames.length - 2 * length
    if (start < 0) {
      return undefined
    }

    let isCycle = true
    for (let offset = 0; offset < length; offset++) {
      if (!isSameFrame(frames[start + offset] as StackFrame, frames[start + length + offset] as StackFrame)) {
        isCycle = false
        break
      }
    }

    if (isCycle) {
      // Keep the positions of the outer copy. The innermost copy holds the column of the call that
      // ran out of stack, which moves with the depth the runtime reached.
      for (let offset = 0; offset < length; offset++) {
        frames[start + offset] = frames[start + length + offset] as StackFrame
      }

      frames.length = start + length
      return { start, length }
    }
  }

  return undefined
}

// The stack is cut wherever the depth ran out, so a part of the cycle can be left over next to the
// copy that was kept. That leftover part is what moved the fingerprint from one throw to the next.
// Remove it at the end the stack was cut at, so that the frame the code outside the cycle really
// called stays next to it.
function trimPartialCycle(frames: StackFrame[], cycle: RepeatedCycle): void {
  const copyEnd = cycle.start + cycle.length
  let partialEnd = copyEnd

  while (
    partialEnd < frames.length &&
    isSameFrame(frames[partialEnd] as StackFrame, frames[partialEnd - cycle.length] as StackFrame)
  ) {
    partialEnd++
  }

  const partialLength = partialEnd - copyEnd
  if (partialLength) {
    frames.splice(partialEnd === frames.length ? copyEnd : cycle.start, partialLength)
  }
}

// When the runtime cut every frame outside the cycle, the trace is one copy of the cycle and
// nothing says which function of it ran out of stack first. Any rotation of the copy holds the same
// calls, so always keep the same one, and the fingerprint stays equal from one throw to the next.
function canonicalizeCycleRotation(frames: StackFrame[]): void {
  const key = (frame: StackFrame): string => `${frame.function}|${frame.filename}|${frame.lineno}`
  let first = 0

  for (let i = 1; i < frames.length; i++) {
    if (key(frames[i] as StackFrame) < key(frames[first] as StackFrame)) {
      first = i
    }
  }

  frames.push(...frames.splice(0, first))
}

export function reverseAndStripFrames(stack: ReadonlyArray<StackFrame>): StackFrame[] {
  if (!stack.length) {
    return []
  }

  const localStack = Array.from(stack)

  localStack.reverse()

  return localStack.slice(0, STACKTRACE_FRAME_LIMIT).map((frame) => ({
    ...frame,
    filename: frame.filename || getLastStackFrame(localStack).filename,
    function: frame.function || UNKNOWN_FUNCTION,
  }))
}

function getLastStackFrame(arr: StackFrame[]): StackFrame {
  return arr[arr.length - 1] || {}
}

export function createDefaultStackParser(): StackParser {
  return createStackParser('web:javascript', chromeStackLineParser, geckoStackLineParser)
}

export function createStackParser(platform: Platform, ...parsers: StackLineParser[]): StackParser {
  return (stack: string, skipFirstLines: number = 0): StackFrame[] => {
    const frames: StackFrame[] = []
    const lines = stack.split('\n')

    const endLine = Math.min(lines.length, skipFirstLines + STACKTRACE_LINE_LIMIT)
    let repeatedCycle: RepeatedCycle | undefined

    for (let i = skipFirstLines; i < endLine; i++) {
      const line = lines[i] as string
      // Ignore lines over 1kb as they are unlikely to be stack frames.
      // Many of the regular expressions use backtracking which results in run time that increases exponentially with
      // input size. Huge strings can result in long hangs or Denial of Service when parsing stack traces.
      if (line.length > 1024) {
        continue
      }

      // Remove webpack (error: *) wrappers so the trailing wrapper parenthesis is not parsed as part of the URL.
      const cleanedLine = WEBPACK_ERROR_REGEXP.test(line) ? line.replace(WEBPACK_ERROR_REGEXP, '$1') : line

      // Skip Error: lines, including DOMException pseudo-frames such as
      // `Error: Blocked a frame with origin ... from accessing a cross-origin frame.`
      if (cleanedLine.match(/\S*Error: /)) {
        continue
      }

      for (const parser of parsers) {
        const frame = parser(cleanedLine, platform)
        if (frame) {
          frames.push(frame)
          repeatedCycle = collapseRepeatedCycle(frames) ?? repeatedCycle
          break
        }
      }

      if (frames.length >= STACKTRACE_FRAME_LIMIT) {
        break
      }
    }

    if (repeatedCycle) {
      trimPartialCycle(frames, repeatedCycle)

      if (repeatedCycle.start === 0 && frames.length === repeatedCycle.length) {
        canonicalizeCycleRotation(frames)
      }
    }

    return reverseAndStripFrames(frames)
  }
}
