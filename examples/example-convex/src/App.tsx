import './App.css'
import { useAction, useConvex, useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react'

function tryParseJson(str: string, addLog: (msg: string) => void, field: string): unknown | undefined {
    const trimmed = str.trim()
    if (!trimmed) return undefined
    try {
        return JSON.parse(trimmed)
    } catch {
        addLog(`Parse error in ${field}: invalid JSON`)
        return undefined
    }
}

function relativeTime(ms: number): string {
    const diff = Date.now() - ms
    if (diff < 1000) return 'just now'
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    return `${Math.floor(diff / 3_600_000)}h ago`
}

function Section({
    num,
    title,
    subtitle,
    children,
    defaultOpen = true,
    badge,
}: {
    num: string
    title: string
    subtitle?: string
    children: ReactNode
    defaultOpen?: boolean
    badge?: ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <section className={`section ${open ? 'section--open' : ''}`}>
            <button className="section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                <span className="section-num">{num}</span>
                <span className="section-title-wrap">
                    <span className="section-title">{title}</span>
                    {subtitle && <span className="section-subtitle">{subtitle}</span>}
                </span>
                {badge && <span className="section-badge">{badge}</span>}
                <span className="section-toggle-icon" aria-hidden>
                    {open ? '−' : '+'}
                </span>
            </button>
            {open && <div className="section-body">{children}</div>}
        </section>
    )
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
    return (
        <label className={`field ${wide ? 'field--wide' : ''}`}>
            <span className="field-label">
                {label}
                {hint && <span className="field-hint">{hint}</span>}
            </span>
            {children}
        </label>
    )
}

function FlagValuePill({ value }: { value: unknown }) {
    if (value === true) return <span className="pill pill--on">true</span>
    if (value === false) return <span className="pill pill--off">false</span>
    if (value === null) return <span className="pill pill--null">null</span>
    if (typeof value === 'string') return <span className="pill pill--variant">{value}</span>
    return <span className="pill">{String(value)}</span>
}

function FlashOnChange({ value, children }: { value: string; children: ReactNode }) {
    const [flash, setFlash] = useState(false)
    const prev = useRef(value)
    useEffect(() => {
        if (prev.current !== value) {
            setFlash(true)
            const t = setTimeout(() => setFlash(false), 1200)
            prev.current = value
            return () => clearTimeout(t)
        }
    }, [value])
    return <div className={`flash-wrap ${flash ? 'flash' : ''}`}>{children}</div>
}

type LastResult = {
    label: string
    timestamp: number
    durationMs: number
    payload: unknown
    error?: string
}

function App() {
    // Shared
    const [distinctId, setDistinctId] = useState('user-123')

    // 1. Capture
    const [captureEvent, setCaptureEvent] = useState('button_clicked')
    const [captureProps, setCaptureProps] = useState('{"plan":"pro","amount":99}')
    const [captureGroups, setCaptureGroups] = useState('{"company":"acme"}')
    const [captureSendFlags, setCaptureSendFlags] = useState(false)
    const [captureGeoip, setCaptureGeoip] = useState(false)
    const [captureUuid, setCaptureUuid] = useState('')
    const [captureTimestamp, setCaptureTimestamp] = useState('')

    // 2. Identify
    const [identifyProps, setIdentifyProps] = useState('{"name":"Test User","email":"test@example.com","plan":"pro"}')
    const [identifyGeoip, setIdentifyGeoip] = useState(false)

    // 3. Capture Exception
    const [errorMsg, setErrorMsg] = useState('Something went wrong')
    const [errorType, setErrorType] = useState<'error' | 'string' | 'object'>('error')
    const [exceptionProps, setExceptionProps] = useState('{"page":"/checkout"}')
    const [exceptionDistinctId, setExceptionDistinctId] = useState('')

    // 6. Feature Flags
    const [flagKey, setFlagKey] = useState('test-flag')
    const [ffGroups, setFfGroups] = useState('')
    const [ffPersonProps, setFfPersonProps] = useState('')
    const [ffGroupProps, setFfGroupProps] = useState('')
    const [ffGeoip, setFfGeoip] = useState(false)
    const [ffMatchValue, setFfMatchValue] = useState('')

    // 7. AI Generation
    const [aiLibrary, setAiLibrary] = useState<'agent' | 'ai-sdk'>('agent')
    const [aiCapture, setAiCapture] = useState<'manual' | 'withTracing' | 'otel'>('manual')
    const [aiPrompt, setAiPrompt] = useState('What is PostHog?')

    // Log + result state
    const [log, setLog] = useState<string[]>([])
    const logRef = useRef<HTMLPreElement>(null)
    const [btnStatus, setBtnStatus] = useState<Record<string, 'loading' | 'success' | 'error'>>({})
    const [lastResult, setLastResult] = useState<LastResult | null>(null)

    const addLog = useCallback(
        (msg: string) => setLog((prev) => [...prev.slice(-99), `${new Date().toLocaleTimeString()} ${msg}`]),
        []
    )

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, [log])

    // Convex hooks
    const captureM = useMutation(api.example.testCapture)
    const identifyM = useMutation(api.example.testIdentify)
    const captureExceptionM = useMutation(api.example.testCaptureException)
    const throwErrorM = useMutation(api.example.testThrowError)
    const refreshFlagsA = useAction(api.example.refreshFlags)

    const agentManualA = useAction(api.convexAgent.manualCapture.generate)
    const agentTracedA = useAction(api.convexAgent.withTracing.generate)
    const agentOtelA = useAction(api.convexAgent.openTelemetry.generate)
    const aiSdkManualA = useAction(api.aiSdk.manualCapture.generate)
    const aiSdkTracedA = useAction(api.aiSdk.withTracing.generate)
    const aiSdkOtelA = useAction(api.aiSdk.openTelemetry.generate)

    const convex = useConvex()
    const getFeatureFlagQ = (args: Parameters<typeof convex.query<typeof api.example.testGetFeatureFlag>>[1]) =>
        convex.query(api.example.testGetFeatureFlag, args)
    const isFeatureEnabledQ = (args: Parameters<typeof convex.query<typeof api.example.testIsFeatureEnabled>>[1]) =>
        convex.query(api.example.testIsFeatureEnabled, args)
    const getPayloadQ = (args: Parameters<typeof convex.query<typeof api.example.testGetFeatureFlagPayload>>[1]) =>
        convex.query(api.example.testGetFeatureFlagPayload, args)
    const getResultQ = (args: Parameters<typeof convex.query<typeof api.example.testGetFeatureFlagResult>>[1]) =>
        convex.query(api.example.testGetFeatureFlagResult, args)
    const getAllFlagsQ = (args: Parameters<typeof convex.query<typeof api.example.testGetAllFlags>>[1]) =>
        convex.query(api.example.testGetAllFlags, args)
    const getAllPayloadsQ = (args: Parameters<typeof convex.query<typeof api.example.testGetAllFlagsAndPayloads>>[1]) =>
        convex.query(api.example.testGetAllFlagsAndPayloads, args)

    // Remote eval methods — action context, no cached defs needed.
    const evaluateFlagA = useAction(api.example.testEvaluateFlag)
    const evaluateFlagPayloadA = useAction(api.example.testEvaluateFlagPayload)
    const evaluateAllFlagsA = useAction(api.example.testEvaluateAllFlags)

    // Live, reactive views — these re-run whenever the cron writes new defs to the storage table.
    const cacheStatus = useQuery(api.example.flagDefinitionsStatus)
    const liveFlags = useQuery(api.example.testGetAllFlagsAndPayloads, { distinctId })

    // Tick once a second so "Last sync: 5s ago" stays accurate without manually re-running.
    const [, setTick] = useState(0)
    useEffect(() => {
        const i = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(i)
    }, [])

    const run = async (label: string, fn: () => Promise<unknown>) => {
        setBtnStatus((s) => ({ ...s, [label]: 'loading' }))
        addLog(`${label}…`)
        const started = performance.now()
        let outcome: 'success' | 'error' = 'success'
        try {
            const result = await fn()
            const dur = Math.round(performance.now() - started)
            addLog(`${label} → ${JSON.stringify(result)} (${dur}ms)`)
            setLastResult({ label, timestamp: Date.now(), durationMs: dur, payload: result })
        } catch (e) {
            const dur = Math.round(performance.now() - started)
            const msg = e instanceof Error ? e.message : String(e)
            addLog(`${label} ✗ ${msg}`)
            setLastResult({ label, timestamp: Date.now(), durationMs: dur, payload: null, error: msg })
            outcome = 'error'
        }
        setBtnStatus((s) => ({ ...s, [label]: outcome }))
        setTimeout(() => {
            setBtnStatus((s) => {
                const next = { ...s }
                if (next[label] === outcome) delete next[label]
                return next
            })
        }, 2000)
    }

    const btnProps = (label: string) => {
        const status = btnStatus[label]
        return {
            className: `btn${status ? ` btn--${status}` : ''}`,
            disabled: status === 'loading',
        }
    }

    const json = (str: string, field: string) => tryParseJson(str, addLog, field)

    const ffArgs = () => ({
        distinctId,
        flagKey,
        groups: json(ffGroups, 'FF groups') as Record<string, string> | undefined,
        personProperties: json(ffPersonProps, 'FF person props') as Record<string, string> | undefined,
        groupProperties: json(ffGroupProps, 'FF group props') as Record<string, Record<string, string>> | undefined,
        disableGeoip: ffGeoip || undefined,
    })

    // Stringify the live flags for the flash-on-change detector.
    const liveFlagsKey = useMemo(() => JSON.stringify(liveFlags?.featureFlags ?? {}), [liveFlags])
    const flagEntries = useMemo(() => {
        if (!liveFlags?.featureFlags) return []
        return Object.entries(liveFlags.featureFlags).sort(([a], [b]) => a.localeCompare(b))
    }, [liveFlags])

    const localEvalActive = !!cacheStatus

    return (
        <div className="app">
            <header className="hero">
                <div className="hero-left">
                    <div className="hero-eyebrow">@posthog/convex · v1</div>
                    <h1 className="hero-title">
                        PostHog inside Convex<span className="hero-title-dot">.</span>
                    </h1>
                    <p className="hero-sub">
                        Capture events, identify users, track exceptions, and evaluate feature flags — all from your
                        queries, mutations, and actions. Pick any method below to fire it against your PostHog project.
                    </p>
                </div>
                <div className="hero-right">
                    <label className="hero-field">
                        <span className="hero-field-label">Distinct ID</span>
                        <input
                            className="hero-field-input"
                            value={distinctId}
                            onChange={(e) => setDistinctId(e.target.value)}
                        />
                    </label>
                </div>
            </header>

            <main className="grid">
                <div className="column column--controls">
                    {/* 1. Event Capture */}
                    <Section num="01" title="Event capture" subtitle="capture() · mutation context">
                        <p className="section-lede">
                            Captures arbitrary events. Sent in the background — the mutation returns once the event is
                            queued.
                        </p>
                        <div className="field-grid">
                            <Field label="Event name">
                                <input value={captureEvent} onChange={(e) => setCaptureEvent(e.target.value)} />
                            </Field>
                            <Field label="UUID" hint="optional">
                                <input
                                    value={captureUuid}
                                    onChange={(e) => setCaptureUuid(e.target.value)}
                                    placeholder="auto-generated"
                                />
                            </Field>
                            <Field label="Properties" hint="JSON" wide>
                                <textarea value={captureProps} onChange={(e) => setCaptureProps(e.target.value)} rows={2} />
                            </Field>
                            <Field label="Groups" hint="JSON" wide>
                                <textarea
                                    value={captureGroups}
                                    onChange={(e) => setCaptureGroups(e.target.value)}
                                    rows={2}
                                />
                            </Field>
                            <Field label="Timestamp" hint="ISO 8601">
                                <input
                                    value={captureTimestamp}
                                    onChange={(e) => setCaptureTimestamp(e.target.value)}
                                    placeholder="2024-01-01T00:00:00Z"
                                />
                            </Field>
                            <div className="checkbox-row">
                                <label className="checkbox">
                                    <input
                                        type="checkbox"
                                        checked={captureSendFlags}
                                        onChange={(e) => setCaptureSendFlags(e.target.checked)}
                                    />
                                    Send feature flags
                                </label>
                                <label className="checkbox">
                                    <input
                                        type="checkbox"
                                        checked={captureGeoip}
                                        onChange={(e) => setCaptureGeoip(e.target.checked)}
                                    />
                                    Disable GeoIP
                                </label>
                            </div>
                        </div>
                        <div className="actions">
                            <button
                                {...btnProps('capture')}
                                onClick={() =>
                                    run('capture', () =>
                                        captureM({
                                            distinctId,
                                            event: captureEvent,
                                            properties: json(captureProps, 'properties'),
                                            groups: json(captureGroups, 'groups'),
                                            sendFeatureFlags: captureSendFlags || undefined,
                                            timestamp: captureTimestamp || undefined,
                                            uuid: captureUuid || undefined,
                                            disableGeoip: captureGeoip || undefined,
                                        })
                                    )
                                }
                            >
                                Capture event
                            </button>
                        </div>
                    </Section>

                    {/* 2. Identify */}
                    <Section num="02" title="Identify" subtitle="identify() · mutation context">
                        <p className="section-lede">
                            Attaches person properties (<code>$set</code>) to the current distinct ID.
                        </p>
                        <div className="field-grid">
                            <Field label="Properties" hint="JSON · sent as $set" wide>
                                <textarea
                                    value={identifyProps}
                                    onChange={(e) => setIdentifyProps(e.target.value)}
                                    rows={3}
                                />
                            </Field>
                            <div className="checkbox-row">
                                <label className="checkbox">
                                    <input
                                        type="checkbox"
                                        checked={identifyGeoip}
                                        onChange={(e) => setIdentifyGeoip(e.target.checked)}
                                    />
                                    Disable GeoIP
                                </label>
                            </div>
                        </div>
                        <div className="actions">
                            <button
                                {...btnProps('identify')}
                                onClick={() =>
                                    run('identify', () =>
                                        identifyM({
                                            distinctId,
                                            properties: json(identifyProps, 'properties'),
                                            disableGeoip: identifyGeoip || undefined,
                                        })
                                    )
                                }
                            >
                                Identify user
                            </button>
                        </div>
                    </Section>

                    {/* 3. Capture Exception */}
                    <Section num="03" title="Capture exception" subtitle="captureException() · mutation context">
                        <p className="section-lede">
                            Sends an Error / string / object to PostHog's error tracking pipeline.
                        </p>
                        <div className="field-grid">
                            <Field label="Error message">
                                <input value={errorMsg} onChange={(e) => setErrorMsg(e.target.value)} />
                            </Field>
                            <Field label="Error type">
                                <select
                                    value={errorType}
                                    onChange={(e) => setErrorType(e.target.value as 'error' | 'string' | 'object')}
                                >
                                    <option value="error">Error object</option>
                                    <option value="string">String</option>
                                    <option value="object">Object with message</option>
                                </select>
                            </Field>
                            <Field label="Additional properties" hint="JSON" wide>
                                <textarea
                                    value={exceptionProps}
                                    onChange={(e) => setExceptionProps(e.target.value)}
                                    rows={2}
                                />
                            </Field>
                            <Field label="Distinct ID" hint="optional override">
                                <input
                                    value={exceptionDistinctId}
                                    onChange={(e) => setExceptionDistinctId(e.target.value)}
                                    placeholder="uses shared ID if empty"
                                />
                            </Field>
                        </div>
                        <div className="actions">
                            <button
                                {...btnProps('captureException')}
                                onClick={() =>
                                    run('captureException', () =>
                                        captureExceptionM({
                                            errorMessage: errorMsg,
                                            errorType,
                                            distinctId: exceptionDistinctId || undefined,
                                            additionalProperties: json(exceptionProps, 'additional properties'),
                                        })
                                    )
                                }
                            >
                                Capture exception
                            </button>
                            <button
                                {...btnProps('throwError')}
                                onClick={() =>
                                    run('throwError', () =>
                                        throwErrorM({
                                            errorMessage: errorMsg,
                                        })
                                    )
                                }
                            >
                                Throw uncaught
                            </button>
                        </div>
                    </Section>

                    {/* 4. Feature Flags */}
                    <Section
                        num="04"
                        title="Feature flags"
                        subtitle="local + remote evaluation"
                        badge={<span className="badge badge--primary">2 paths</span>}
                    >
                        <p className="section-lede">
                            Local methods evaluate against the cached definitions — no per-call network round trip,
                            work in queries. Remote methods hit PostHog's <code>/flags</code> endpoint directly — action
                            context only, handles every flag type. Local returns <code>null</code> when it can't reach a
                            verdict (flag missing, experience continuity, static cohort, missing property).
                        </p>
                        <div className="field-grid">
                            <Field label="Flag key">
                                <input value={flagKey} onChange={(e) => setFlagKey(e.target.value)} />
                            </Field>
                            <Field label="Match value" hint="boolean or string · payload lookup without re-eval">
                                <input
                                    value={ffMatchValue}
                                    onChange={(e) => setFfMatchValue(e.target.value)}
                                    placeholder="e.g. true, variant-a"
                                />
                            </Field>
                            <Field label="Person properties" hint="JSON" wide>
                                <textarea
                                    value={ffPersonProps}
                                    onChange={(e) => setFfPersonProps(e.target.value)}
                                    rows={2}
                                    placeholder='{"email":"test@example.com"}'
                                />
                            </Field>
                            <Field label="Groups" hint="JSON" wide>
                                <textarea
                                    value={ffGroups}
                                    onChange={(e) => setFfGroups(e.target.value)}
                                    rows={2}
                                    placeholder='{"company":"acme"}'
                                />
                            </Field>
                            <Field label="Group properties" hint="JSON" wide>
                                <textarea
                                    value={ffGroupProps}
                                    onChange={(e) => setFfGroupProps(e.target.value)}
                                    rows={2}
                                    placeholder='{"company":{"industry":"tech"}}'
                                />
                            </Field>
                            <div className="checkbox-row">
                                <label className="checkbox">
                                    <input
                                        type="checkbox"
                                        checked={ffGeoip}
                                        onChange={(e) => setFfGeoip(e.target.checked)}
                                    />
                                    Disable GeoIP
                                </label>
                            </div>
                        </div>
                        <div className="subsection-divider">
                            <span className="subsection-label">Local · query · mutation · action</span>
                            <span className="subsection-note">
                                evaluates against cached defs · requires <code>personalApiKey</code>
                            </span>
                        </div>
                        <div className="method-grid">
                            <button
                                {...btnProps('getFeatureFlag')}
                                onClick={() => run('getFeatureFlag', () => getFeatureFlagQ(ffArgs()))}
                            >
                                <span className="method-name">getFeatureFlag</span>
                                <span className="method-sig">key, distinctId → value</span>
                            </button>
                            <button
                                {...btnProps('isFeatureEnabled')}
                                onClick={() => run('isFeatureEnabled', () => isFeatureEnabledQ(ffArgs()))}
                            >
                                <span className="method-name">isFeatureEnabled</span>
                                <span className="method-sig">key, distinctId → boolean</span>
                            </button>
                            <button
                                {...btnProps('getFeatureFlagPayload')}
                                onClick={() => {
                                    const args = ffArgs()
                                    const mv = ffMatchValue.trim()
                                    let matchValue: boolean | string | undefined
                                    if (mv === 'true') matchValue = true
                                    else if (mv === 'false') matchValue = false
                                    else if (mv) matchValue = mv
                                    run('getFeatureFlagPayload', () => getPayloadQ({ ...args, matchValue }))
                                }}
                            >
                                <span className="method-name">getFeatureFlagPayload</span>
                                <span className="method-sig">key, matchValue? → JSON</span>
                            </button>
                            <button
                                {...btnProps('getFeatureFlagResult')}
                                onClick={() => run('getFeatureFlagResult', () => getResultQ(ffArgs()))}
                            >
                                <span className="method-name">getFeatureFlagResult</span>
                                <span className="method-sig">key → &#123; enabled, variant, payload &#125;</span>
                            </button>
                            <button
                                {...btnProps('getAllFlags')}
                                onClick={() => run('getAllFlags', () => getAllFlagsQ({ distinctId }))}
                            >
                                <span className="method-name">getAllFlags</span>
                                <span className="method-sig">distinctId → &#123; key → value &#125;</span>
                            </button>
                            <button
                                {...btnProps('getAllFlagsAndPayloads')}
                                onClick={() => run('getAllFlagsAndPayloads', () => getAllPayloadsQ({ distinctId }))}
                            >
                                <span className="method-name">getAllFlagsAndPayloads</span>
                                <span className="method-sig">distinctId → flags + payloads</span>
                            </button>
                        </div>

                        <div className="subsection-divider">
                            <span className="subsection-label">Remote · action context</span>
                            <span className="subsection-note">
                                hits PostHog's <code>/flags</code> directly · no personal API key needed
                            </span>
                        </div>
                        <div className="method-grid">
                            <button
                                {...btnProps('evaluateFlag')}
                                onClick={() =>
                                    run('evaluateFlag', () =>
                                        evaluateFlagA({
                                            distinctId,
                                            flagKey,
                                            groups: json(ffGroups, 'FF groups'),
                                            personProperties: json(ffPersonProps, 'FF person props'),
                                            groupProperties: json(ffGroupProps, 'FF group props'),
                                            disableGeoip: ffGeoip || undefined,
                                        })
                                    )
                                }
                            >
                                <span className="method-name">evaluateFlag</span>
                                <span className="method-sig">key, distinctId → value (remote)</span>
                            </button>
                            <button
                                {...btnProps('evaluateFlagPayload')}
                                onClick={() =>
                                    run('evaluateFlagPayload', () =>
                                        evaluateFlagPayloadA({
                                            distinctId,
                                            flagKey,
                                            groups: json(ffGroups, 'FF groups'),
                                            personProperties: json(ffPersonProps, 'FF person props'),
                                            groupProperties: json(ffGroupProps, 'FF group props'),
                                            disableGeoip: ffGeoip || undefined,
                                        })
                                    )
                                }
                            >
                                <span className="method-name">evaluateFlagPayload</span>
                                <span className="method-sig">key, distinctId → payload (remote)</span>
                            </button>
                            <button
                                {...btnProps('evaluateAllFlags')}
                                onClick={() =>
                                    run('evaluateAllFlags', () =>
                                        evaluateAllFlagsA({
                                            distinctId,
                                            groups: json(ffGroups, 'FF groups'),
                                            personProperties: json(ffPersonProps, 'FF person props'),
                                            groupProperties: json(ffGroupProps, 'FF group props'),
                                            disableGeoip: ffGeoip || undefined,
                                        })
                                    )
                                }
                            >
                                <span className="method-name">evaluateAllFlags</span>
                                <span className="method-sig">distinctId → flags + payloads (remote)</span>
                            </button>
                        </div>
                    </Section>

                    {/* 5. AI Generation */}
                    <Section num="05" title="AI generation" subtitle="@posthog/ai · action context">
                        <p className="section-lede">
                            Captures <code>$ai_generation</code> events using the selected library and tracing approach.
                            See{' '}
                            <a href="https://posthog.com/docs/llm-analytics/installation/convex">
                                LLM analytics for Convex
                            </a>{' '}
                            for the full setup.
                        </p>
                        <div className="field-grid">
                            <Field label="Library">
                                <select
                                    value={aiLibrary}
                                    onChange={(e) => setAiLibrary(e.target.value as typeof aiLibrary)}
                                >
                                    <option value="agent">@convex-dev/agent</option>
                                    <option value="ai-sdk">AI SDK</option>
                                </select>
                            </Field>
                            <Field label="Capture method">
                                <select
                                    value={aiCapture}
                                    onChange={(e) => setAiCapture(e.target.value as typeof aiCapture)}
                                >
                                    <option value="manual">Manual capture</option>
                                    <option value="withTracing">@posthog/ai withTracing</option>
                                    <option value="otel">OpenTelemetry</option>
                                </select>
                            </Field>
                            <Field label="Prompt" wide>
                                <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2} />
                            </Field>
                        </div>
                        <div className="actions">
                            <button
                                {...btnProps('ai-generate')}
                                onClick={() => {
                                    const args = { prompt: aiPrompt, distinctId }
                                    const actions = {
                                        'agent-manual': agentManualA,
                                        'agent-withTracing': agentTracedA,
                                        'agent-otel': agentOtelA,
                                        'ai-sdk-manual': aiSdkManualA,
                                        'ai-sdk-withTracing': aiSdkTracedA,
                                        'ai-sdk-otel': aiSdkOtelA,
                                    }
                                    const action = actions[`${aiLibrary}-${aiCapture}`]
                                    run('ai-generate', () => action(args))
                                }}
                            >
                                Generate
                            </button>
                        </div>
                    </Section>
                </div>

                <aside className="column column--live">
                    <div className="live-card live-card--small">
                        <div className="live-card-head">
                            <div>
                                <div className="live-card-eyebrow">Local evaluation</div>
                                <div className="live-card-title">
                                    {/* Reserve a fixed line-height so this label doesn't reflow when cacheStatus resolves */}
                                    <span
                                        className={`status-pill ${
                                            localEvalActive ? 'status-pill--on' : 'status-pill--off'
                                        }`}
                                    >
                                        <span className="status-dot" />
                                        {localEvalActive ? 'Active' : 'Waiting for first cron tick'}
                                    </span>
                                </div>
                            </div>
                            <button
                                {...btnProps('refresh-now')}
                                onClick={() => run('refresh-now', () => refreshFlagsA({}))}
                                className={`btn btn--small ${btnStatus['refresh-now'] ? `btn--${btnStatus['refresh-now']}` : ''}`}
                            >
                                Refresh ↻
                            </button>
                        </div>
                        <div className="status-grid">
                            <div className="status-row">
                                <span className="status-key">Last sync</span>
                                <span className="status-val">
                                    {cacheStatus ? relativeTime(cacheStatus.fetchedAt) : '—'}
                                </span>
                            </div>
                            <div className="status-row">
                                <span className="status-key">Flags cached</span>
                                <span className="status-val">{cacheStatus ? cacheStatus.flagCount : '—'}</span>
                            </div>
                            <div className="status-row">
                                <span className="status-key">ETag</span>
                                <span className="status-val status-val--mono">
                                    {cacheStatus?.etag
                                        ? cacheStatus.etag.length > 22
                                            ? cacheStatus.etag.slice(0, 22) + '…'
                                            : cacheStatus.etag
                                        : '—'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="live-card">
                        <div className="live-card-head">
                            <div>
                                <div className="live-card-eyebrow">Reactive · auto-updates</div>
                                <div className="live-card-title">Live flag values</div>
                            </div>
                            <div className="live-card-meta">{liveFlags ? `for ${distinctId}` : 'loading…'}</div>
                        </div>
                        {flagEntries.length === 0 ? (
                            <div className="empty">
                                {cacheStatus === undefined && 'Connecting to Convex…'}
                                {cacheStatus === null &&
                                    'No flag definitions cached yet. Set POSTHOG_PERSONAL_API_KEY and wait for the cron, or click Refresh flag cache.'}
                                {cacheStatus && cacheStatus.flagCount === 0 && 'No flags returned from PostHog.'}
                            </div>
                        ) : (
                            <FlashOnChange value={liveFlagsKey}>
                                <ul className="flag-list">
                                    {flagEntries.map(([key, value]) => {
                                        const payload = liveFlags?.featureFlagPayloads?.[key]
                                        return (
                                            <li key={key} className="flag-row">
                                                <span className="flag-key">{key}</span>
                                                <FlagValuePill value={value} />
                                                {payload != null && (
                                                    <span className="flag-payload" title={JSON.stringify(payload)}>
                                                        + payload
                                                    </span>
                                                )}
                                            </li>
                                        )
                                    })}
                                </ul>
                            </FlashOnChange>
                        )}
                        <div className="live-card-foot">
                            change a flag in PostHog → row flashes when the cron picks it up
                        </div>
                    </div>

                    <div className="live-card live-card--small">
                        <div className="live-card-head">
                            <div>
                                <div className="live-card-eyebrow">Last response</div>
                                <div className="live-card-title">{lastResult?.label ?? 'No call yet'}</div>
                            </div>
                            {lastResult && (
                                <div className="live-card-meta">
                                    {lastResult.durationMs}ms · {relativeTime(lastResult.timestamp)}
                                </div>
                            )}
                        </div>
                        {!lastResult ? (
                            <div className="empty">Click any method to see its response here.</div>
                        ) : lastResult.error ? (
                            <pre className="result-block result-block--error">{lastResult.error}</pre>
                        ) : (
                            <pre className="result-block">{JSON.stringify(lastResult.payload, null, 2)}</pre>
                        )}
                    </div>

                    <div className="live-card live-card--small">
                        <div className="live-card-head">
                            <div>
                                <div className="live-card-eyebrow">Activity</div>
                                <div className="live-card-title">
                                    {log.length === 0
                                        ? 'No calls yet'
                                        : `${log.length} call${log.length === 1 ? '' : 's'}`}
                                </div>
                            </div>
                            <button className="btn btn--ghost btn--small" onClick={() => setLog([])}>
                                Clear
                            </button>
                        </div>
                        <pre className="log-output" ref={logRef}>
                            {log.length ? log.join('\n') : 'Ready. Click any method to test.'}
                        </pre>
                    </div>
                </aside>
            </main>

            <footer className="footer">
                <span>
                    @posthog/convex ·{' '}
                    <a href="https://github.com/PostHog/posthog-js/tree/main/packages/convex">readme</a> ·{' '}
                    <a href="https://posthog.com/docs/product-analytics">analytics</a> ·{' '}
                    <a href="https://posthog.com/docs/feature-flags">feature flags</a> ·{' '}
                    <a href="https://posthog.com/docs/llm-analytics/installation/convex">llm analytics</a>
                </span>
                <span className="footer-tip">
                    Captured events show up in your{' '}
                    <a href="https://us.posthog.com/activity/explore">PostHog activity feed</a>.
                </span>
            </footer>
        </div>
    )
}

export default App
