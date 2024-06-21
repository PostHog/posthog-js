import { extendPostHog } from '../extensions/exception-autocapture'

import { window } from '../utils/globals'

if (window) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.extendPostHogWithExceptionAutoCapture = extendPostHog
}

export default extendPostHog
