import { extendPostHog } from './extensions/web-vitals'

import { window } from './utils/globals'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
window.extendPostHogWithWebVitals = extendPostHog

export default extendPostHog
