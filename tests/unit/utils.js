/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import { _ } from '../../src/utils'
import { expect } from 'chai'

describe(`utils.js`, function () {
    it('should have $host and $pathname in properties', function () {
        const properties = _.info.properties()
        expect(properties['$current_url']).to.be.defined
        expect(properties['$host']).to.be.defined
        expect(properties['$pathname']).to.be.defined
    })
})
