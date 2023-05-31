// copied and adapted from https://github.com/getsentry/sentry-javascript/blob/41fef4b10f3a644179b77985f00f8696c908539f/packages/browser/src/stack-parsers.ts
// 💖open source

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

const WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/
const STACKTRACE_FRAME_LIMIT = 50

const UNKNOWN_FUNCTION = '?'

const OPERA10_PRIORITY = 10
const OPERA11_PRIORITY = 20
const CHROME_PRIORITY = 30
const WINJS_PRIORITY = 40
const GECKO_PRIORITY = 50

export interface StackFrame {
    filename?: string
    function?: string
    module?: string
    platform?: string
    lineno?: number
    colno?: number
    abs_path?: string
    context_line?: string
    pre_context?: string[]
    post_context?: string[]
    in_app?: boolean
    instruction_addr?: string
    addr_mode?: string
    vars?: { [key: string]: any }
    debug_id?: string
}

function createFrame(filename: string, func: string, lineno?: number, colno?: number): StackFrame {
    const frame: StackFrame = {
        filename,
        function: func,
        in_app: true, // All browser frames are considered in_app
    }

    if (lineno !== undefined) {
        frame.lineno = lineno
    }

    if (colno !== undefined) {
        frame.colno = colno
    }

    return frame
}

export type StackParser = (stack: string, skipFirst?: number) => StackFrame[]
export type StackLineParserFn = (line: string) => StackFrame | undefined
export type StackLineParser = [number, StackLineParserFn]

// Chromium based browsers: Chrome, Brave, new Opera, new Edge
const chromeRegex =
    /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i
const chromeEvalRegex = /\((\S*)(?::(\d+))(?::(\d+))\)/

const chrome: StackLineParserFn = (line) => {
    const parts = chromeRegex.exec(line)

    if (parts) {
        const isEval = parts[2] && parts[2].indexOf('eval') === 0 // start of line

        if (isEval) {
            const subMatch = chromeEvalRegex.exec(parts[2])

            if (subMatch) {
                // throw out eval line/column and use top-most line/column number
                parts[2] = subMatch[1] // url
                parts[3] = subMatch[2] // line
                parts[4] = subMatch[3] // column
            }
        }

        // Kamil: One more hack won't hurt us right? Understanding and adding more rules on top of these regexps right now
        // would be way too time consuming. (TODO: Rewrite whole RegExp to be more readable)
        const [func, filename] = extractSafariExtensionDetails(parts[1] || UNKNOWN_FUNCTION, parts[2])

        return createFrame(filename, func, parts[3] ? +parts[3] : undefined, parts[4] ? +parts[4] : undefined)
    }

    return
}

export const chromeStackLineParser: StackLineParser = [CHROME_PRIORITY, chrome]

// gecko regex: `(?:bundle|\d+\.js)`: `bundle` is for react native, `\d+\.js` also but specifically for ram bundles because it
// generates filenames without a prefix like `file://` the filenames in the stacktrace are just 42.js
// We need this specific case for now because we want no other regex to match.
const geckoREgex =
    /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:[-a-z]+)?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i
const geckoEvalRegex = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i

const gecko: StackLineParserFn = (line) => {
    const parts = geckoREgex.exec(line)

    if (parts) {
        const isEval = parts[3] && parts[3].indexOf(' > eval') > -1
        if (isEval) {
            const subMatch = geckoEvalRegex.exec(parts[3])

            if (subMatch) {
                // throw out eval line/column and use top-most line number
                parts[1] = parts[1] || 'eval'
                parts[3] = subMatch[1]
                parts[4] = subMatch[2]
                parts[5] = '' // no column when eval
            }
        }

        let filename = parts[3]
        let func = parts[1] || UNKNOWN_FUNCTION
        ;[func, filename] = extractSafariExtensionDetails(func, filename)

        return createFrame(filename, func, parts[4] ? +parts[4] : undefined, parts[5] ? +parts[5] : undefined)
    }

    return
}

export const geckoStackLineParser: StackLineParser = [GECKO_PRIORITY, gecko]

const winjsRegex = /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:[-a-z]+):.*?):(\d+)(?::(\d+))?\)?\s*$/i

const winjs: StackLineParserFn = (line) => {
    const parts = winjsRegex.exec(line)

    return parts
        ? createFrame(parts[2], parts[1] || UNKNOWN_FUNCTION, +parts[3], parts[4] ? +parts[4] : undefined)
        : undefined
}

export const winjsStackLineParser: StackLineParser = [WINJS_PRIORITY, winjs]

const opera10Regex = / line (\d+).*script (?:in )?(\S+)(?:: in function (\S+))?$/i

const opera10: StackLineParserFn = (line) => {
    const parts = opera10Regex.exec(line)
    return parts ? createFrame(parts[2], parts[3] || UNKNOWN_FUNCTION, +parts[1]) : undefined
}

export const opera10StackLineParser: StackLineParser = [OPERA10_PRIORITY, opera10]

const opera11Regex = / line (\d+), column (\d+)\s*(?:in (?:<anonymous function: ([^>]+)>|([^)]+))\(.*\))? in (.*):\s*$/i

const opera11: StackLineParserFn = (line) => {
    const parts = opera11Regex.exec(line)
    return parts ? createFrame(parts[5], parts[3] || parts[4] || UNKNOWN_FUNCTION, +parts[1], +parts[2]) : undefined
}

export const opera11StackLineParser: StackLineParser = [OPERA11_PRIORITY, opera11]

export const defaultStackLineParsers = [chromeStackLineParser, geckoStackLineParser, winjsStackLineParser]

export function reverse(stack: ReadonlyArray<StackFrame>): StackFrame[] {
    if (!stack.length) {
        return []
    }

    const localStack = stack.slice(0, STACKTRACE_FRAME_LIMIT)

    localStack.reverse()

    return localStack.map((frame) => ({
        ...frame,
        filename: frame.filename || localStack[localStack.length - 1].filename,
        function: frame.function || '?',
    }))
}

export function createStackParser(...parsers: StackLineParser[]): StackParser {
    const sortedParsers = parsers.sort((a, b) => a[0] - b[0]).map((p) => p[1])

    return (stack: string, skipFirst = 0): StackFrame[] => {
        const frames: StackFrame[] = []
        const lines = stack.split('\n')

        for (let i = skipFirst; i < lines.length; i++) {
            const line = lines[i]
            // Ignore lines over 1kb as they are unlikely to be stack frames.
            // Many of the regular expressions use backtracking which results in run time that increases exponentially with
            // input size. Huge strings can result in hangs/Denial of Service:
            // https://github.com/getsentry/sentry-javascript/issues/2286
            if (line.length > 1024) {
                continue
            }

            // https://github.com/getsentry/sentry-javascript/issues/5459
            // Remove webpack (error: *) wrappers
            const cleanedLine = WEBPACK_ERROR_REGEXP.test(line) ? line.replace(WEBPACK_ERROR_REGEXP, '$1') : line

            // https://github.com/getsentry/sentry-javascript/issues/7813
            // Skip Error: lines
            if (cleanedLine.match(/\S*Error: /)) {
                continue
            }

            for (const parser of sortedParsers) {
                const frame = parser(cleanedLine)

                if (frame) {
                    frames.push(frame)
                    break
                }
            }

            if (frames.length >= STACKTRACE_FRAME_LIMIT) {
                break
            }
        }

        return reverse(frames)
    }
}

export const defaultStackParser = createStackParser(...defaultStackLineParsers)

/**
 * Safari web extensions, starting version unknown, can produce "frames-only" stacktraces.
 * What it means, is that instead of format like:
 *
 * Error: wat
 *   at function@url:row:col
 *   at function@url:row:col
 *   at function@url:row:col
 *
 * it produces something like:
 *
 *   function@url:row:col
 *   function@url:row:col
 *   function@url:row:col
 *
 * Because of that, it won't be captured by `chrome` RegExp and will fall into `Gecko` branch.
 * This function is extracted so that we can use it in both places without duplicating the logic.
 * Unfortunately "just" changing RegExp is too complicated now and making it pass all tests
 * and fix this case seems like an impossible, or at least way too time-consuming task.
 */
const extractSafariExtensionDetails = (func: string, filename: string): [string, string] => {
    const isSafariExtension = func.indexOf('safari-extension') !== -1
    const isSafariWebExtension = func.indexOf('safari-web-extension') !== -1

    return isSafariExtension || isSafariWebExtension
        ? [
              func.indexOf('@') !== -1 ? func.split('@')[0] : UNKNOWN_FUNCTION,
              isSafariExtension ? `safari-extension:${filename}` : `safari-web-extension:${filename}`,
          ]
        : [func, filename]
}
