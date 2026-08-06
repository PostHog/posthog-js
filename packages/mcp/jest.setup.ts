import { resetSharedToolOwnershipCaches } from './src/extensions/analytics-parameters'

// Tool ownership is cached per server identity for the life of the process, so
// without this a listing served by one test answers for every later test that
// builds a server with the same name and version.
beforeEach(() => {
  resetSharedToolOwnershipCaches()
})
