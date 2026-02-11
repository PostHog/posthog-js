import { PostHog } from '../posthog-core'
import { Autocapture } from '../autocapture'
import { DeadClicksAutocapture } from '../extensions/dead-clicks-autocapture'
import { ExceptionObserver } from '../extensions/exception-autocapture'
import { HistoryAutocapture } from '../extensions/history-autocapture'
import { TracingHeaders } from '../extensions/tracing-headers'
import { WebVitalsAutocapture } from '../extensions/web-vitals'
import { SessionRecording } from '../extensions/replay/session-recording'
import { Heatmaps } from '../heatmaps'
import { PostHogProductTours } from '../posthog-product-tours'
import { SiteApps } from '../site-apps'

PostHog.__defaultExtensionClasses = {
    historyAutocapture: HistoryAutocapture,
    tracingHeaders: TracingHeaders,
    siteApps: SiteApps,
    sessionRecording: SessionRecording,
    autocapture: Autocapture,
    productTours: PostHogProductTours,
    heatmaps: Heatmaps,
    webVitalsAutocapture: WebVitalsAutocapture,
    exceptionObserver: ExceptionObserver,
    deadClicksAutocapture: DeadClicksAutocapture,
}
