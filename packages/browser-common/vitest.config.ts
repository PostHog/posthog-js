import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    define: {
        __SURVEY_CSS__: JSON.stringify(readFileSync(new URL('./src/surveys/survey.css', import.meta.url), 'utf8')),
    },
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'preact',
    },
    test: {
        globals: true,
        clearMocks: true,
        environment: 'node',
        include: ['tests/**/*.spec.{ts,tsx}'],
        environmentOptions: { jsdom: { url: 'http://localhost/' } },
    },
})
