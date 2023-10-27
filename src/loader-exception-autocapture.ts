import { extendPostHog } from './extensions/exception-autocapture'

import { _isUndefined } from './type-utils'

const win: Window & typeof globalThis = _isUndefined(window) ? ({} as typeof window) : window

;(win as any).extendPostHogWithExceptionAutoCapture = extendPostHog

export default extendPostHog
