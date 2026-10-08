#!/usr/bin/env node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
await import(new URL('./bin/vite.js', pathToFileURL(require.resolve('vite/package.json'))).href)
