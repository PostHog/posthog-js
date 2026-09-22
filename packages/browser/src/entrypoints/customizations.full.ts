// this file is called customizations.full.ts because it includes all customizations
// this naming scheme allows us to create a lighter version in the future with only the most popular customizations
// without breaking backwards compatibility

import * as customizations from '../customizations'
import { publishCustomizations } from '../customizations/deferred'

publishCustomizations(customizations)
