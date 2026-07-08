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
 * It stays out of the way of the SDK's own machinery - nothing is sent when:
 * - the visitor is opted out (stored consent, a queued opt_out_capturing
 *   call, opt_out_capturing_by_default with no opt-in, DNT, cookieless mode)
 * - the traffic looks like a bot (the SDK's bot filtering never ran)
 * - the site customizes the event pipeline (before_send,
 *   sanitize_properties, property_blacklist/denylist, request_headers, or a
 *   queued set_config) - bypassing redaction is worse than losing events
 * - sendBeacon is unavailable or rejects the payload
 *
 * Events for visitors with no stored identity use a generated personless
 * distinct_id: they count in event analytics but never create person
 * profiles and will not join a person identified later in the session.
 *
 * Constraints: ES5 only, zero console output, must never throw into page
 * code. Minify with: terser snippet/unload-fallback.js -c passes=2 -m --ecma 5
 */
;(function () {
    try {
        window.addEventListener('onpagehide' in self ? 'pagehide' : 'unload', function () {
            try {
                var ph = window.posthog
                // Once array.js has taken over, its own unload flush owns
                // delivery. __loaded is checked before _i because a
                // double-pasted snippet can re-stub _i onto the real
                // instance, but never unsets __loaded.
                if (!ph || ph.__loaded || !ph._i || !navigator.sendBeacon) {
                    return
                }
                function yes(v) {
                    v = String(v)
                    return v === '1' || v === 'true' || v === 'yes'
                }
                function local(k) {
                    try {
                        return localStorage.getItem(k)
                    } catch (err) {}
                }
                function session(k) {
                    try {
                        return sessionStorage.getItem(k)
                    } catch (err) {}
                }
                function cookie(k) {
                    var parts = ('; ' + document.cookie).split('; ' + k + '=')
                    if (parts.length > 1) {
                        return decodeURIComponent(parts.pop().split(';')[0])
                    }
                }
                function json(v) {
                    try {
                        return JSON.parse(v)
                    } catch (err) {}
                }
                for (var i = 0; i < ph._i.length; i++) {
                    try {
                        var init = ph._i[i] // [token, config, name]
                        var token = init[0]
                        var config = init[1] || {}
                        var queue = ph[init[2]] || ph
                        if (
                            !token ||
                            config.cookieless_mode ||
                            config.disable_beacon ||
                            config.__preview_disable_beacon
                        ) {
                            continue
                        }
                        if (
                            config.before_send ||
                            config.sanitize_properties ||
                            config.property_blacklist ||
                            config.property_denylist ||
                            config.request_headers
                        ) {
                            continue
                        }
                        // the SDK's bot filtering never ran, so approximate it,
                        // honoring the same opt-out config as the SDK
                        if (
                            !config.opt_out_useragent_filter &&
                            (navigator.webdriver || /bot|crawl|spider|headless/i.test(navigator.userAgent))
                        ) {
                            continue
                        }
                        if (config.respect_dnt && (yes(navigator.doNotTrack) || yes(window.doNotTrack))) {
                            continue
                        }
                        // queued consent calls replay before captures in the real
                        // drain, so the last one queued wins here too; a queued
                        // set_config could change anything, so defer to array.js
                        var queuedConsent
                        var customized = false
                        for (var j = 0; j < queue.length; j++) {
                            var method = queue[j] && queue[j][0]
                            if (method === 'set_config') {
                                customized = true
                            } else if (method === 'opt_out_capturing') {
                                queuedConsent = false
                            } else if (method === 'opt_in_capturing') {
                                queuedConsent = true
                            }
                        }
                        if (customized || queuedConsent === false) {
                            continue
                        }
                        if (queuedConsent !== true) {
                            var consentKey =
                                config.consent_persistence_name ||
                                (config.opt_out_capturing_cookie_prefix || '__ph_opt_in_out_') + token
                            var consent = local(consentKey)
                            if (consent == null) {
                                consent = cookie(consentKey)
                            }
                            var no = String(consent)
                            if (no === '0' || no === 'false' || no === 'no') {
                                continue
                            }
                            if (!yes(consent) && config.opt_out_capturing_by_default) {
                                continue
                            }
                        }
                        // distinct_id: queued identify > persisted id > throwaway personless id.
                        // The real drain applies identify before captures, so a queued
                        // identify's id is the right id for every queued capture.
                        var distinctId
                        var personProfiles = config.person_profiles === 'always'
                        for (j = 0; j < queue.length; j++) {
                            if (queue[j] && queue[j][0] === 'identify' && typeof queue[j][1] === 'string') {
                                distinctId = queue[j][1]
                                personProfiles = true
                            }
                        }
                        if (!distinctId) {
                            var storageKey =
                                'ph_' +
                                (config.persistence_name ||
                                    token.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ') + '_posthog')
                            var stored =
                                json(local(storageKey)) || json(session(storageKey)) || json(cookie(storageKey))
                            if (stored && stored.distinct_id) {
                                distinctId = stored.distinct_id
                                personProfiles = personProfiles || stored.$epp === true
                            }
                        }
                        if (!distinctId) {
                            distinctId = 'snippet-' + Date.now().toString(36) + Math.random().toString(36).slice(2)
                        }
                        var events = []
                        var indices = []
                        for (var k = 0; k < queue.length && events.length < 50; k++) {
                            var item = queue[k]
                            if (item && item[0] === 'capture' && typeof item[1] === 'string') {
                                var properties = { $lib: 'web-snippet', $current_url: location.href }
                                var userProps = item[2]
                                if (userProps && typeof userProps === 'object') {
                                    for (var key in userProps) {
                                        properties[key] = userProps[key]
                                    }
                                }
                                properties.token = token
                                properties.distinct_id = distinctId
                                properties.$process_person_profile = personProfiles
                                properties.$sent_by_snippet_fallback_on_unload = true
                                events.push({ event: item[1], properties: properties })
                                indices.push(k)
                            }
                        }
                        if (!events.length) {
                            continue
                        }
                        var body =
                            'data=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(events)))))
                        // sendBeacon rejects bodies over 64KB; leave the queue for array.js
                        if (body.length > 63 * 1024) {
                            continue
                        }
                        if (
                            navigator.sendBeacon(
                                String(config.api_host || 'https://us.i.posthog.com').replace(/\/$/, '') +
                                    '/e/?compression=base64',
                                new Blob([body], { type: 'application/x-www-form-urlencoded' })
                            )
                        ) {
                            // splice only after the browser accepted the beacon,
                            // highest index first, so a rejected beacon loses nothing
                            for (var m = indices.length - 1; m >= 0; m--) {
                                queue.splice(indices[m], 1)
                            }
                        }
                    } catch (err) {}
                }
            } catch (err) {}
        })
    } catch (err) {}
})()
