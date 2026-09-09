// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import { isUndefined } from '@/utils'
import { StackFrame } from '../types'

export const UNKNOWN_FUNCTION = '?'

// Chromium reports a script with no URL at all -- code injected by an extension
// (`chrome.scripting.executeScript`), pasted into devtools, or evaluated from a string -- as a bare
// `<anonymous>:line:col` frame. The page's own eval'd code is *not* affected: V8 reports it as
// `eval at <anonymous> (https://site/app.js:1:2)` and the chrome parser already rewrites that to
// the site URL. A bare `<anonymous>` can never be symbolicated.
const ANONYMOUS_FILENAME = '<anonymous>'

// A leading `scheme:` in a filename, needing two characters or more so that a Windows drive letter
// such as `C:` does not read as one.
const URL_SCHEME = /^([a-z][a-z0-9.+-]+):/i

// The schemes an app is served over. Everything else names code the container put into the page
// rather than code the app loaded: Safari masks extension content scripts as `webkit-masked-url://`,
// Chromium serves them from `chrome-extension://`, and Android in-app browsers serve their native
// bridge from schemes such as `iabjs://`. Listing every injector's scheme never keeps up with the
// next one, so accept the schemes an app is served over and reject the rest.
const APP_URL_SCHEMES = ['http', 'https', 'file', 'blob', 'app', 'capacitor', 'ionic', 'webpack', 'webpack-internal']

// Is this filename a script the app itself loaded? A filename with no scheme is one: React Native
// names its own bundle `index.android.bundle`, and a bundler can report a bare path.
function isAppFilename(filename: string): boolean {
  if (!filename || filename === ANONYMOUS_FILENAME) {
    return false
  }

  const scheme = URL_SCHEME.exec(filename)

  return !scheme || APP_URL_SCHEMES.includes((scheme[1] as string).toLowerCase())
}

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
    // Keep a frame the app did not load -- it is still useful context -- but do not let it count as
    // in_app and pull the issue into the app's own stack.
    in_app: isAppFilename(filename),
  }

  if (!isUndefined(lineno)) {
    frame.lineno = lineno
  }

  if (!isUndefined(colno)) {
    frame.colno = colno
  }

  return frame
}
