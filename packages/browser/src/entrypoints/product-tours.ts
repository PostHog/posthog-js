import { generateProductTours } from '../extensions/product-tours'
import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.generateProductTours = generateProductTours

export default generateProductTours
