/**
 * PostHog snippet unload fallback - an OPT-IN companion to the PostHog snippet.
 *
 * On slow connections the snippet queues capture calls in memory while
 * array.js loads; if the visitor leaves first, those events are lost. Paste
 * this block anywhere near the snippet (order does not matter - everything is
 * read at unload time). If array.js has not loaded when the page unloads, the
 * queued capture calls are sent by sendBeacon, marked with
 * $sent_by_snippet_fallback_on_unload: true, and removed from the queue so a
 * late-arriving array.js can never send them twice. Pasting it twice is
 * harmless for the same reason.
 *
 * This file is written to be read - paste it as-is, or minify it first with:
 * terser snippet/unload-fallback.js -c passes=2 -m --ecma 5
 *
 * Constraints: ES5 only, zero console output, must never throw into page code.
 */
;(function () {
    var MAX_EVENTS_PER_BEACON = 50
    // sendBeacon rejects bodies over 64KB; stay safely under it
    var MAX_BEACON_BODY_BYTES = 63 * 1024

    function isYesLike(value) {
        value = String(value)
        return value === '1' || value === 'true' || value === 'yes'
    }

    function isNoLike(value) {
        value = String(value)
        return value === '0' || value === 'false' || value === 'no'
    }

    function readLocalStorage(key) {
        try {
            return localStorage.getItem(key)
        } catch (error) {}
    }

    function readSessionStorage(key) {
        try {
            return sessionStorage.getItem(key)
        } catch (error) {}
    }

    function readCookie(name) {
        var parts = ('; ' + document.cookie).split('; ' + name + '=')
        if (parts.length > 1) {
            return decodeURIComponent(parts.pop().split(';')[0])
        }
    }

    function parseJson(value) {
        try {
            return JSON.parse(value)
        } catch (error) {}
    }

    function utf8ToBase64(text) {
        return btoa(unescape(encodeURIComponent(text)))
    }

    function fallbackDisabledByConfig(config) {
        // cookieless mode has a sentinel-id contract this block cannot replicate
        return config.cookieless_mode || config.disable_beacon || config.__preview_disable_beacon
    }

    function looksLikeBot(config) {
        // the SDK's bot filtering never ran, so approximate it, honoring the
        // same opt-out config as the SDK
        if (config.opt_out_useragent_filter) {
            return false
        }
        return navigator.webdriver || /bot|crawl|spider|headless/i.test(navigator.userAgent)
    }

    function pipelineIsCustomized(config, queue) {
        // sites using these hooks scrub or reroute events before they leave the
        // browser; bypassing that would be worse than losing the events
        if (
            config.before_send ||
            config.sanitize_properties ||
            config.property_blacklist ||
            config.property_denylist ||
            config.request_headers
        ) {
            return true
        }
        // a queued set_config could change any of the above before the drain runs
        for (var i = 0; i < queue.length; i++) {
            if (queue[i] && queue[i][0] === 'set_config') {
                return true
            }
        }
        return false
    }

    function visitorHasOptedOut(config, token, queue) {
        if (config.respect_dnt && (isYesLike(navigator.doNotTrack) || isYesLike(window.doNotTrack))) {
            return true
        }
        // queued consent calls replay before captures in the real drain, so the
        // last opt_in/opt_out call queued decides here too
        var queuedDecision
        for (var i = 0; i < queue.length; i++) {
            var methodName = queue[i] && queue[i][0]
            if (methodName === 'opt_out_capturing') {
                queuedDecision = false
            } else if (methodName === 'opt_in_capturing') {
                queuedDecision = true
            }
        }
        if (queuedDecision !== undefined) {
            return !queuedDecision
        }
        // no queued decision: fall back to the consent the SDK persisted
        var consentKey =
            config.consent_persistence_name || (config.opt_out_capturing_cookie_prefix || '__ph_opt_in_out_') + token
        var storedConsent = readLocalStorage(consentKey)
        if (storedConsent == null) {
            storedConsent = readCookie(consentKey)
        }
        if (isNoLike(storedConsent)) {
            return true
        }
        return !isYesLike(storedConsent) && Boolean(config.opt_out_capturing_by_default)
    }

    function sanitizeTokenForStorageKey(token) {
        return token.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')
    }

    function resolveIdentity(config, token, queue) {
        // a queued identify wins: the real drain applies identify before
        // captures, so its id is the right id for every queued capture
        var identifiedId
        for (var i = 0; i < queue.length; i++) {
            var call = queue[i]
            if (call && call[0] === 'identify' && typeof call[1] === 'string') {
                identifiedId = call[1]
            }
        }
        if (identifiedId) {
            return { distinctId: identifiedId, personProfiles: true }
        }

        var personProfiles = config.person_profiles === 'always'
        var storageKey = 'ph_' + (config.persistence_name || sanitizeTokenForStorageKey(token) + '_posthog')
        var storedProperties =
            parseJson(readLocalStorage(storageKey)) ||
            parseJson(readSessionStorage(storageKey)) ||
            parseJson(readCookie(storageKey))
        if (storedProperties && storedProperties.distinct_id) {
            return {
                distinctId: storedProperties.distinct_id,
                personProfiles: personProfiles || storedProperties.$epp === true,
            }
        }

        // throwaway personless id: better than losing the events, but it will
        // never join a person identified later in the session
        return {
            distinctId: 'snippet-' + Date.now().toString(36) + Math.random().toString(36).slice(2),
            personProfiles: personProfiles,
        }
    }

    function collectQueuedCaptures(queue, token, identity) {
        var events = []
        var queueIndices = []
        for (var i = 0; i < queue.length && events.length < MAX_EVENTS_PER_BEACON; i++) {
            var call = queue[i] // ['capture', eventName, properties?, ...]
            if (!call || call[0] !== 'capture' || typeof call[1] !== 'string') {
                continue
            }
            var properties = { $lib: 'web-snippet', $current_url: location.href }
            var userProperties = call[2]
            if (userProperties && typeof userProperties === 'object') {
                for (var key in userProperties) {
                    properties[key] = userProperties[key]
                }
            }
            // reserved keys are set after user properties so they cannot be overridden
            properties.token = token
            properties.distinct_id = identity.distinctId
            properties.$process_person_profile = identity.personProfiles
            properties.$sent_by_snippet_fallback_on_unload = true
            events.push({ event: call[1], properties: properties })
            queueIndices.push(i)
        }
        return { events: events, queueIndices: queueIndices }
    }

    function sendByBeacon(config, events) {
        var apiHost = String(config.api_host || 'https://us.i.posthog.com').replace(/\/$/, '')
        // the SDK's base64 wire format: form-urlencoded is a CORS-safelisted
        // content type, so the beacon needs no preflight during unload
        var body = 'data=' + encodeURIComponent(utf8ToBase64(JSON.stringify(events)))
        if (body.length > MAX_BEACON_BODY_BYTES) {
            return false
        }
        return navigator.sendBeacon(
            apiHost + '/e/?compression=base64',
            new Blob([body], { type: 'application/x-www-form-urlencoded' })
        )
    }

    function removeSentCalls(queue, queueIndices) {
        // highest index first so the remaining indices stay valid
        for (var i = queueIndices.length - 1; i >= 0; i--) {
            queue.splice(queueIndices[i], 1)
        }
    }

    function onPageHide() {
        try {
            var posthog = window.posthog
            // Once array.js has taken over, its own unload flush owns delivery.
            // __loaded is checked before _i because a double-pasted snippet can
            // re-stub _i onto the real instance, but never unsets __loaded.
            if (!posthog || posthog.__loaded || !posthog._i || !navigator.sendBeacon) {
                return
            }
            for (var i = 0; i < posthog._i.length; i++) {
                try {
                    var initCall = posthog._i[i] // [token, config, name]
                    var token = initCall[0]
                    var config = initCall[1] || {}
                    var queue = posthog[initCall[2]] || posthog
                    if (
                        !token ||
                        fallbackDisabledByConfig(config) ||
                        looksLikeBot(config) ||
                        pipelineIsCustomized(config, queue) ||
                        visitorHasOptedOut(config, token, queue)
                    ) {
                        continue
                    }
                    var identity = resolveIdentity(config, token, queue)
                    var collected = collectQueuedCaptures(queue, token, identity)
                    if (collected.events.length && sendByBeacon(config, collected.events)) {
                        // remove only after the browser accepted the beacon, so a
                        // rejected beacon loses nothing - the queue stays for array.js
                        removeSentCalls(queue, collected.queueIndices)
                    }
                } catch (error) {}
            }
        } catch (error) {}
    }

    try {
        window.addEventListener('onpagehide' in self ? 'pagehide' : 'unload', onPageHide)
    } catch (error) {}
})()
