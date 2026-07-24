const { TestEnvironment } = require('jest-environment-node')
const asyncHooks = require('async_hooks')

const trackedTypes = new Set([
  'Timeout',
  'WORKER',
  'MESSAGEPORT',
  'TCPSERVERWRAP',
  'TCPWRAP',
  'TLSWRAP',
  'UDPWRAP',
  'PROCESSWRAP',
  'PIPEWRAP',
  'HTTPCLIENTREQUEST',
  'GETADDRINFOREQWRAP',
])

module.exports = class HandleEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context)
    this.testPath = context.testPath
    this.resources = new Map()
    this.hook = asyncHooks.createHook({
      init: (asyncId, type, _triggerAsyncId, resource) => {
        if (trackedTypes.has(type)) {
          this.resources.set(asyncId, { type, resource, stack: new Error().stack })
        }
      },
      destroy: (asyncId) => {
        this.resources.delete(asyncId)
      },
    })
    this.hook.enable()
  }

  async teardown() {
    await super.teardown()
    await new Promise((resolve) => setImmediate(resolve))
    this.hook.disable()
    const refedResources = [...this.resources.values()].filter(
      ({ resource }) => typeof resource?.hasRef !== 'function' || resource.hasRef()
    )
    if (refedResources.length > 0) {
      console.error(`JEST_HANDLE_RESOURCES ${this.testPath}`)
      for (const { type, stack } of refedResources) {
        console.error(type, stack)
      }
    }
  }
}
