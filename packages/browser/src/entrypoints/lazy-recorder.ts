// This is only here for so that users with cached recorder.ts don't get errors during the transition to lazy loading
// if you have the new eager loaded recording code it will request this file, not `recorder.js`
// so you don't have the problem that clients get new code and a cached recorder.js

import { assignableWindow } from '../utils/globals'
import { LazyLoadedSessionRecording } from '../extensions/replay/external/lazy-loaded-session-recorder'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.initSessionRecording = (ph) => new LazyLoadedSessionRecording(ph)

export * from './recorder'
