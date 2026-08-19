// `lazy-recorder` is the script session recording lazy loads by default, so inlining it here is what
// makes the `.full` bundles genuinely self-contained for replay. Importing `./recorder` instead only
// defines `__PosthogExtensions__.rrweb.record`, which isn't enough for the guard in
// `session-recording.ts` to skip the remote fetch — it also needs `initSessionRecording`.
import './lazy-recorder'
import './surveys'
import './logs'
import './exception-autocapture'
import './tracing-headers'
// Full bundles must include every web-vitals callback flavor because no-external
// builds cannot fetch a different flavor after initialization.
import './web-vitals-with-attribution-soft-navs'
import './web-vitals-soft-navs'
import './web-vitals-with-attribution'
import './web-vitals'
import './dead-clicks-autocapture'
