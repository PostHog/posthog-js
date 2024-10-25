// a straight copy of the array.full.ts entrypoint,
// but will have different config when passed through rollup
// to allow es5/IE11 support

// but it doesn't include web-vitals which doesn't support IE11

import './surveys'
import './exception-autocapture'
import './tracing-headers'
import './recorder'
import './array.no-external'
