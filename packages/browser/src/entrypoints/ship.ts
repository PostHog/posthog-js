import { generateShip, renderFeatureEnrollmentUI } from '../extensions/ship'
import type { RenderFeatureEnrollmentUIOptions } from '../extensions/ship'

import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.generateShip = generateShip

export default generateShip
export { renderFeatureEnrollmentUI }
export type { RenderFeatureEnrollmentUIOptions }
