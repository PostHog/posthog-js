import { generateUserReport } from '../extensions/user-report'

import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.generateUserReport = generateUserReport

export default generateUserReport
