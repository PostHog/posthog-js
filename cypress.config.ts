import { defineConfig } from 'cypress'

export default defineConfig({
    defaultCommandTimeout: 2000,
    numTestsKeptInMemory: 0,
    e2e: {
        // We've imported your old cypress plugins here.
        // You may want to clean this up later by importing these.
        setupNodeEvents(on, config) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require('./cypress/plugins/index.js')(on, config)
        },
    },
})
