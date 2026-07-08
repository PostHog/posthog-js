/**
 * PostHog JS snippet - readable reference copy.
 *
 * The production snippet lives in the posthog/posthog repo; keep the two in
 * sync. This copy exists so the snippet's behavior can be unit- and
 * e2e-tested against the exact code that ships.
 *
 * An opt-in companion block, snippet/unload-fallback.js, can be pasted below
 * this snippet to beacon queued capture calls when the page unloads before
 * array.js has loaded. It is deliberately NOT part of this snippet.
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
    }
})(document, window.posthog || [])
