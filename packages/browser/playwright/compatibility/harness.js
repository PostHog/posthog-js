/* eslint-disable posthog-js/no-direct-function-check, posthog-js/no-direct-date-check -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
;(() => {
    const lab = (window.__compat = {
        observations: [],
        callbacks: [],
        promises: [],
        disposers: [],
        staleFlagCallbacks: 0,
        unhandled: [],
        phase: 'before-init',
        loaded: false,
        initialized: false,
        flagNotifications: 0,
        surveyNotifications: 0,
    })
    addEventListener('unhandledrejection', (event) =>
        lab.unhandled.push({ name: event.reason?.name, message: String(event.reason?.message ?? event.reason) })
    )
    const encode = (value, seen = new WeakSet()) => {
        if (value === undefined) return { $kind: 'undefined' }
        if (value === null) return null
        if (value === lab.ph) return { $kind: 'sdk-instance' }
        if (value instanceof Error) return { $kind: 'error', name: value.name, message: value.message }
        if (typeof value === 'function') return { $kind: 'function' }
        if (typeof value !== 'object') return value
        if (value instanceof Date) return { $kind: 'date', value: value.toISOString() }
        if (seen.has(value)) return { $kind: 'circular' }
        seen.add(value)
        const result = Array.isArray(value)
            ? value.map((item) => encode(item, seen))
            : Object.fromEntries(
                  Object.keys(value)
                      .sort()
                      .map((key) => [key, encode(value[key], seen)])
              )
        seen.delete(value)
        return result
    }
    lab.encode = encode
    lab.call = (method, args = [], label = method) => {
        const observation = { phase: lab.phase, method: label }
        lab.observations.push(observation)
        try {
            let target = lab.ph
            const parts = method.split('.')
            for (const part of parts.slice(0, -1)) target = target?.[part]
            const fn = target?.[parts.at(-1)]
            if (typeof fn !== 'function') {
                observation.returned = { $kind: 'missing-method' }
                return
            }
            const value = fn.apply(target, args)
            if (value && typeof value.then === 'function') {
                observation.returned = { $kind: 'promise' }
                const outcome = { phase: lab.phase, method: label, state: 'pending' }
                lab.promises.push(outcome)
                value.then(
                    (v) => Object.assign(outcome, { state: 'fulfilled', value: encode(v) }),
                    (e) => Object.assign(outcome, { state: 'rejected', value: encode(e) })
                )
            } else observation.returned = encode(value)
            if (method === 'onFeatureFlags' && typeof value === 'function')
                lab.disposers.push({ phase: observation.phase, unsubscribe: value })
            return value
        } catch (error) {
            observation.thrown = encode(error)
        }
    }
    lab.callback =
        (label, originPhase = lab.phase) =>
        (...values) => {
            lab.callbacks.push({
                callback: label,
                originPhase,
                phase: lab.phase,
                values: values.map((value) => encode(value)),
            })
            if (label === 'feature-flags') {
                lab.flagNotifications++
                if (lab.cleanupDisposedPhases?.includes(originPhase)) lab.staleFlagCallbacks++
            }
            if (label === 'surveys') lab.surveyNotifications++
        }
    lab.probe = (phase) => {
        lab.phase = phase
        lab.call('get_distinct_id')
        lab.call('get_session_id')
        lab.call('has_opted_out_capturing')
        lab.call('getFeatureFlag', ['compat-variant', { send_event: false }])
        lab.call('getFeatureFlagPayload', ['compat-variant'])
        lab.call('isFeatureEnabled', ['compat-enabled', { send_event: false }])
        lab.call('onFeatureFlags', [lab.callback('feature-flags')])
        // Keep stateful pre-init probes in the lifecycle scenario; product scenarios use clean initialization.
        if (lab.scenario === 'core' || phase !== 'before-init') lab.call('getSurveys', [lab.callback('surveys')])
        lab.call('canRenderSurveyAsync', ['compat-survey'])
        lab.call('register', [{ compatibility_property: 'retained' }])
        lab.call('capture', [
            `compat-${phase}`,
            { phase, nullable: null, nested: { retained: 0, empty: '', bool: false, missing: undefined } },
        ])
        if (lab.scenario === 'logs')
            lab.call('captureLog', [{ body: `compat-log-${phase}`, level: 'info', attributes: { phase } }])
    }
    lab.options = () => ({
        api_host: location.origin,
        ui_host: location.origin,
        persistence: 'localStorage',
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: ['autocapture', 'forms', 'links', 'rage-clicks', 'dead-clicks'].includes(lab.scenario),
        disable_session_recording: lab.scenario !== 'replay',
        disable_surveys: !['surveys', 'extension-failure', 'delayed-loading', 'version-fallback'].includes(
            lab.scenario
        ),
        disable_surveys_automatic_display: true,
        capture_performance: false,
        capture_dead_clicks: lab.scenario === 'dead-clicks',
        enable_heatmaps: false,
        ...(lab.scenario === 'heatmaps' ? { capture_heatmaps: { flush_interval_milliseconds: 1000 } } : {}),
        ...(['rage-clicks', 'heatmaps'].includes(lab.scenario) ? { rageclick: true } : {}),
        enable_recording_console_log: false,
        opt_out_useragent_filter: true,
        request_batching: lab.scenario === 'unload',
        strict_script_versioning:
            lab.scenario === 'version-fallback' && lab.comparison === 'current' ? 'fallback' : false,
        session_recording: {
            maskAllInputs: true,
            maskTextSelector: '.ph-mask',
            recordCrossOriginIframes: false,
            blockClass: 'ph-no-capture',
        },
        ...(lab.scenario === 'logs' ? { logs: { captureConsoleLogs: true, flushIntervalMs: 1000 } } : {}),
        ...(lab.mode === 'slim' ? { __extensionClasses: lab.extensions } : {}),
        loaded: (ph) => {
            lab.ph = ph
            lab.loaded = true
            lab.probe('loaded')
        },
    })
    lab.initialize = (scenario) => {
        lab.scenario = scenario
        if (lab.mode === 'snippet') {
            lab.ph = window.posthog
            lab.phase = 'snippet-init-call'
            lab.call('init', ['phc_COMPAT', lab.options()], 'snippet.init')
            lab.probe('before-init')
            lab.probe('init-return')
            lab.initialized = true
        } else {
            lab.probe('before-init')
            lab.phase = 'init-call'
            lab.call('init', ['phc_COMPAT', lab.options()])
            lab.probe('init-return')
            lab.initialized = true
        }
    }
    window.__compatInstall = (ph, extensions) => {
        lab.ph = ph
        lab.extensions = extensions
        lab.installed = true
    }
    lab.readyProbe = () => lab.probe('ready')
    lab.identity = () => {
        lab.phase = 'identity'
        lab.call('identify', ['compat-user', { email: 'fixture@example.test', plan: 'pro' }])
        lab.call('get_distinct_id', [], 'identified-id')
        lab.call('capture', ['compat-identified', { identity_step: 'identified' }])
    }
    lab.reset = () => {
        lab.phase = 'reset'
        lab.call('reset', [true])
        lab.call('get_distinct_id', [], 'reset-id')
        lab.call('capture', ['compat-reset', { identity_step: 'reset' }])
        lab.call('reloadFeatureFlags')
    }
    lab.consent = () => {
        lab.phase = 'consent'
        lab.call('opt_out_capturing')
        lab.call('has_opted_out_capturing', [], 'opted-out')
        lab.call('capture', ['compat-must-not-deliver'])
        lab.call('opt_in_capturing', [{ captureEventName: false }])
        lab.call('has_opted_out_capturing', [], 'opted-in')
        lab.call('capture', ['compat-after-opt-in'])
    }
    lab.cleanup = () => {
        lab.phase = 'cleanup'
        const disposers = lab.disposers.filter((disposer) => disposer.phase === 'ready')
        if (disposers.length !== 1) throw new Error('Missing ready flags disposer')
        lab.cleanupPendingCount = lab.callbacks.filter(
            (callback) => callback.callback === 'feature-flags' && callback.originPhase === 'pending'
        ).length
        lab.cleanupDisposedPhases = disposers.map((disposer) => disposer.phase)
        for (const disposer of disposers) {
            const observation = {
                phase: 'cleanup',
                method: 'onFeatureFlags.unsubscribe',
                registeredPhase: disposer.phase,
            }
            lab.observations.push(observation)
            try {
                observation.returned = encode(disposer.unsubscribe())
            } catch (error) {
                observation.thrown = encode(error)
            }
        }
        lab.cleanupObserverCalls = 0
        lab.call(
            'onFeatureFlags',
            [
                (...values) => {
                    lab.cleanupObserverCalls++
                    lab.callbacks.push({
                        callback: 'cleanup-observer',
                        originPhase: 'cleanup',
                        phase: lab.phase,
                        values: values.map((value) => encode(value)),
                    })
                },
            ],
            'cleanup-observer.subscribe'
        )
        lab.call('reloadFeatureFlags')
    }
    lab.finish = () => ({
        staleFlagCallbacks: lab.staleFlagCallbacks,
        observations: lab.observations,
        callbacks: lab.callbacks,
        promises: lab.promises,
        unhandled: lab.unhandled,
        loaded: lab.loaded,
        initialized: lab.initialized,
        optOut: lab.ph?.has_opted_out_capturing?.(),
        storage: {
            local: Object.fromEntries(
                Object.keys(localStorage)
                    .sort()
                    .map((key) => [key, localStorage.getItem(key)])
            ),
            session: Object.fromEntries(
                Object.keys(sessionStorage)
                    .sort()
                    .map((key) => [key, sessionStorage.getItem(key)])
            ),
        },
    })
})()
