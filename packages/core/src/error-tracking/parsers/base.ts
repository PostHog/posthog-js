import { isUndefined } from '@/utils'
import { StackFrame } from '../types'

export const UNKNOWN_FUNCTION = '?'
export const OPERA10_PRIORITY = 10
export const OPERA11_PRIORITY = 20
export const CHROME_PRIORITY = 30
export const WINJS_PRIORITY = 40
export const GECKO_PRIORITY = 50

export function createFrame(filename: string, func: string, lineno?: number, colno?: number): StackFrame {
  const frame: StackFrame = {
    // TODO: should be a variable here
    platform: 'web:javascript',
    filename,
    function: func === '<anonymous>' ? UNKNOWN_FUNCTION : func,
    in_app: true, // All browser frames are considered in_app
  }

  if (!isUndefined(lineno)) {
    frame.lineno = lineno
  }

  if (!isUndefined(colno)) {
    frame.colno = colno
  }

  return frame
}
