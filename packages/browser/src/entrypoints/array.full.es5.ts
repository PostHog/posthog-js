// a straight copy of the array.full.ts entrypoint,
// but will have different config when passed through rollup
// to allow es5/IE11 support

// it doesn't include recorder which doesn't support IE11,
// and it doesn't include "web-vitals" which doesn't support IE11

import 'core-js/features/object/entries'
import 'core-js/features/object/from-entries'
import 'core-js/features/promise'

if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    const perf = typeof performance !== 'undefined' ? performance : ({} as any)
    perf.now = perf.now || (() => Date.now())
    if (typeof performance === 'undefined') {
        // eslint-disable-next-line no-restricted-globals
        ;(window as any).performance = perf
    }
}

import './surveys'
import './exception-autocapture'
import './tracing-headers'
import './array.no-external'
