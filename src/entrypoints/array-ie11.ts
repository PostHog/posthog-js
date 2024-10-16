// a straight copy of the array.ts entrypoint,
// but will have different config when passed through rollup
// to allow IE11 support

import './external-scripts-loader'
import './array.no-external'
