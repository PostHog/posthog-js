// web-vitals v5 uses Array.prototype.at() (ES2022), absent in Safari < 15.4 and
// synthetic monitoring browsers (e.g. Pingdom). Only these two bundles pay the cost.
import 'core-js/stable/array/at'
