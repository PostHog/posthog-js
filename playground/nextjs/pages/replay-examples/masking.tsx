import { usePostHog } from 'posthog-js/react'
import { useCallback, useEffect, useRef, useState } from 'react'

// rrweb event type for a full DOM snapshot.
const FULL_SNAPSHOT = 2
// rrweb-snapshot node type for a text node.
const TEXT_NODE = 3

// The `before_send` recipe a customer can copy into their own PostHog init to
// see the masked text before it ships. The playground below runs the same idea
// against the live recorder on this page.
const BEFORE_SEND_RECIPE = `posthog.init('<your-token>', {
    before_send: (event) => {
        if (event?.event === '$snapshot') {
            for (const snapshot of event.properties.$snapshot_data) {
                // full snapshot (2) carries the serialized DOM tree
                if (snapshot.type === 2) {
                    console.log('masked text that will ship:', collectText(snapshot.data.node))
                }
            }
        }
        return event
    },
})

// walk the serialized DOM tree and collect every text node
function collectText(node) {
    if (!node) return []
    if (node.type === 3) return [node.textContent]
    return (node.childNodes || []).flatMap(collectText)
}`

// Walk a serialized rrweb DOM tree and collect every text node value. This is
// exactly what leaves the browser, so it is the masked text a compliance
// review needs to see.
function collectText(node: any): string[] {
    if (!node) {
        return []
    }
    if (node.type === TEXT_NODE) {
        const text = (node.textContent ?? '').trim()
        return text ? [text] : []
    }
    const children: any[] = node.childNodes ?? []
    return children.flatMap(collectText)
}

export default function Masking() {
    const posthog = usePostHog()
    const events = useRef<any[]>([])
    const replayContainer = useRef<HTMLDivElement>(null)
    const [maskedText, setMaskedText] = useState<string[]>([])
    const [snapshotCount, setSnapshotCount] = useState(0)

    // Collect every `$snapshot` this page sends. The recorder has already
    // applied masking by the time the event reaches `eventCaptured`.
    useEffect(() => {
        const unsubscribe = posthog.on('eventCaptured', (event: any) => {
            if (event?.event !== '$snapshot') {
                return
            }
            const snapshotData: any[] = event.properties?.['$snapshot_data'] ?? []
            events.current.push(...snapshotData)
            setSnapshotCount((count) => count + snapshotData.length)

            const fromFullSnapshots = snapshotData
                .filter((snapshot) => snapshot.type === FULL_SNAPSHOT)
                .flatMap((snapshot) => collectText(snapshot.data?.node))
            if (fromFullSnapshots.length) {
                setMaskedText(fromFullSnapshots)
            }
        })
        return unsubscribe
    }, [posthog])

    // Rebuild the captured events into a live DOM through rrweb, so the masked
    // result sits next to the unmasked page above.
    const rebuildMaskedView = useCallback(async () => {
        const container = replayContainer.current
        if (!container || events.current.length < 2) {
            return
        }
        const { Replayer } = await import('rrweb')
        container.replaceChildren()
        const replayer: any = new Replayer(events.current, {
            root: container,
            showWarning: false,
            mouseTail: false,
        })
        const meta = replayer.getMetaData()
        replayer.pause(Math.max(0, meta.totalTime))
    }, [])

    const recordingActive = typeof posthog.sessionRecordingStarted === 'function' && posthog.sessionRecordingStarted()

    return (
        <>
            <h1>Verify session replay masking</h1>
            <p className="max-w-2xl">
                Session replay masks text in the browser before it reaches PostHog. This page lets you confirm what
                masking strips <b>without deploying</b>. Interact with the fields below, then rebuild the captured
                snapshot to compare the masked result against the live page.
            </p>

            {!recordingActive && (
                <p className="border border-red-900 bg-red-200 rounded p-2 max-w-2xl">
                    <b>Session recording is not active.</b> Accept cookies in the banner so the recorder runs, then
                    reload this page.
                </p>
            )}

            <h2 className="mt-4">Live page (unmasked)</h2>
            <p className="max-w-2xl text-gray-500 italic">
                This is what you see. The recorder masks it before capture.
            </p>
            <div className="border-2 border-gray-800 rounded p-4 max-w-2xl space-y-2">
                <p>
                    Plain text stays visible in replay: <b>PostHog is an analytics platform.</b>
                </p>
                <p className="ph-mask">
                    Masked with <code>ph-mask</code>: card holder Jane Q. Public, order #A-4471.
                </p>
                <p className="ph-no-capture">
                    Blocked with <code>ph-no-capture</code>: this whole block is removed from the recording.
                </p>
                <label className="block">
                    Email (inputs are masked by default)
                    <input type="email" defaultValue="jane@example.com" className="block border p-1" />
                </label>
                <label className="block">
                    Password
                    <input type="password" defaultValue="hunter2" className="block border p-1" />
                </label>
            </div>

            <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button onClick={rebuildMaskedView}>Rebuild masked view</button>
                <span className="text-gray-500 text-sm">{snapshotCount} snapshot events captured on this page</span>
            </div>

            <h2 className="mt-4">Rebuilt from the captured snapshot (masked)</h2>
            <p className="max-w-2xl text-gray-500 italic">
                rrweb renders the exact events that shipped. Masked text shows as asterisks; blocked elements are gone.
            </p>
            <div
                ref={replayContainer}
                className="border-2 border-gray-800 rounded p-4 max-w-2xl min-h-24 overflow-auto"
            />

            <h2 className="mt-4">Masked text that shipped</h2>
            <p className="max-w-2xl text-gray-500 italic">
                Every text node in the captured full snapshot. This is the exact text that left the browser.
            </p>
            <ul className="text-xs bg-gray-100 rounded border-2 border-gray-800 p-4 max-w-2xl space-y-1">
                {maskedText.length === 0 ? (
                    <li>No full snapshot captured yet. Interact with the page above.</li>
                ) : (
                    maskedText.map((text, index) => (
                        <li key={index} className="font-mono">
                            {text}
                        </li>
                    ))
                )}
            </ul>

            <h2 className="mt-4">Do this in your own app</h2>
            <p className="max-w-2xl">
                A <code>before_send</code> hook prints the same masked text from any page, with no build step:
            </p>
            <pre className="text-xs bg-gray-100 rounded border-2 border-gray-800 p-4 max-w-2xl overflow-auto">
                <code>{BEFORE_SEND_RECIPE}</code>
            </pre>
        </>
    )
}
