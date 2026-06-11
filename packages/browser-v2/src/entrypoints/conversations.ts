import { initConversations } from '../extensions/conversations/external'
import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initConversations = initConversations

export default initConversations
