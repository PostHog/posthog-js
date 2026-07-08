/**
 * PostHog JS snippet - readable reference copy.
 *
 * The production snippet lives in the posthog/posthog repo; keep the two in
 * sync. This copy exists so the snippet's behavior - especially the unload
 * fallback - can be unit- and e2e-tested against the exact code that ships.
 *
 * Constraints: ES5 only, zero console output, and it must never throw into
 * page code. Minify with: terser snippet/snippet.js -c passes=2 -m --ecma 5
 */
;(function (t, e) {
    if (!e.__SV) {
        window.posthog = e
        e._i = []
        e.init = function (i, s, a) {
            function g(t, e) {
                var o = e.split('.')
                if (o.length === 2) {
                    t = t[o[0]]
                    e = o[1]
                }
                t[e] = function () {
                    t.push([e].concat(Array.prototype.slice.call(arguments, 0)))
                }
            }
            var p = t.createElement('script')
            p.type = 'text/javascript'
            p.crossOrigin = 'anonymous'
            p.async = true
            p.src = s.api_host + '/static/array.full.js'
            // append to head rather than insertBefore the first script element, so
            // the snippet also works in documents that have no script element yet
            // (e.g. programmatically created iframes)
            t.head.appendChild(p)
            var u = e
            if (typeof a !== 'undefined') {
                u = e[a] = []
            } else {
                a = 'posthog'
            }
            u.people = u.people || []
            u.toString = function (t) {
                var e = 'posthog'
                if (a !== 'posthog') {
                    e += '.' + a
                }
                if (!t) {
                    e += ' (stub)'
                }
                return e
            }
            u.people.toString = function () {
                return u.toString(1) + '.people (stub)'
            }
            var o =
                'capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset'.split(
                    ' '
                )
            for (var n = 0; n < o.length; n++) {
                g(u, o[n])
            }
            e._i.push([i, s, a])
        }
        e.__SV = 1

        // Unload fallback: if array.js has not loaded by pagehide, beacon the
        // queued capture calls to /e/ (marked $sent_by_snippet_fallback_on_unload)
        // and remove them from the queue on a successful hand-off, so a late
        // array.js drain can never send them twice.
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
                            if (config.respect_dnt && (yes(navigator.doNotTrack) || yes(window.doNotTrack))) {
                                continue
                            }
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
                            // distinct_id: queued identify > persisted id > throwaway personless id.
                            // The real drain applies identify before captures, so a queued
                            // identify's id is the right id for every queued capture.
                            var distinctId
                            var personProfiles = config.person_profiles === 'always'
                            for (var j = 0; j < queue.length; j++) {
                                if (queue[j] && queue[j][0] === 'identify' && typeof queue[j][1] === 'string') {
                                    distinctId = queue[j][1]
                                    personProfiles = true
                                }
                            }
                            if (!distinctId) {
                                var storageKey =
                                    'ph_' +
                                    (config.persistence_name ||
                                        token.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ') +
                                            '_posthog')
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
                            for (var k = 0; k < queue.length; k++) {
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
                            if (
                                events.length &&
                                navigator.sendBeacon(
                                    String(config.api_host || 'https://us.i.posthog.com').replace(/\/$/, '') +
                                        '/e/?compression=base64',
                                    new Blob(
                                        [
                                            'data=' +
                                                encodeURIComponent(
                                                    btoa(unescape(encodeURIComponent(JSON.stringify(events))))
                                                ),
                                        ],
                                        { type: 'application/x-www-form-urlencoded' }
                                    )
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
    }
})(document, window.posthog || [])
