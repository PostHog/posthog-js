/*
 * Test that basic SDK usage (init, capture, etc) does not
 * blow up in non-browser (node.js) envs. These are not
 * tests of server-side capturing functionality (which is
 * currently not supported in the browser lib).
 */

import posthog from "../../src/loader-module";
import { expect } from "chai";
import sinon from 'sinon'

describe(`Module-based loader in Node env`, function() {
  it("should load and capture the pageview event", function() {
    const sandbox = sinon.createSandbox();
    let loaded = false
    posthog._originalCapture = posthog.capture
    posthog.capture = sandbox.spy()
    posthog.init(`test-token`, {
      debug: true,
      persistence: `localStorage`,
      api_host: `https://test.com`,
      loaded: function() {
        loaded = true
      }
    });

    expect(posthog.capture.calledOnce).to.equal(true);
    const captureArgs = posthog.capture.args[0];
    const event = captureArgs[0];
    const props = captureArgs[1];
    expect(event).to.equal("$pageview");
    expect(loaded).to.equal(true)

    posthog.capture = posthog._originalCapture
    delete posthog._originalCapture
  });

  it(`supports identify()`, function() {
    posthog.identify(`Pat`);
  });

  it(`supports capture()`, function() {
    posthog.capture(`Did stuff`);
  });
});
