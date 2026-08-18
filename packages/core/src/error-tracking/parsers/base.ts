// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import { isUndefined } from '@/utils'
import { StackFrame } from '../types'

export const UNKNOWN_FUNCTION = '?'

// Safari replaces the URL of scripts it will not attribute to the page with this placeholder.
// Web extension content scripts are the common source, but blob:, eval'd and injected code can
// be masked the same way, so the filename alone cannot tell us which one we are looking at.
// Either way it is not the page's own code, so keep the frame -- it is still useful context --
// but do not let it count as in_app and pull the issue into the site's own stack.
const MASKED_URL_PREFIX = 'webkit-masked-url://'

export function createFrame(
  platform: StackFrame['platform'],
  filename: string,
  func: string,
  lineno?: number,
  colno?: number
): StackFrame {
  const frame: StackFrame = {
    // TODO: should be a variable here
    platform,
    filename,
    function: func === '<anonymous>' ? UNKNOWN_FUNCTION : func,
    // Browser frames are considered in_app unless the runtime has masked their origin
    in_app: !filename?.startsWith(MASKED_URL_PREFIX),
  }

  if (!isUndefined(lineno)) {
    frame.lineno = lineno
  }

  if (!isUndefined(colno)) {
    frame.colno = colno
  }

  return frame
}
