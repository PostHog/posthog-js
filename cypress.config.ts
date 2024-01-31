import { defineConfig } from 'cypress'

export default defineConfig({
    defaultCommandTimeout: 2000,
    numTestsKeptInMemory: 0,
    e2e: {
        specPattern: 'cypress/e2e/**/*.cy.{js,ts}',
    },
})
