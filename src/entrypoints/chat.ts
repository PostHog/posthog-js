import { loadChat } from '../extensions/chat'

import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.loadChat = loadChat

export default loadChat
