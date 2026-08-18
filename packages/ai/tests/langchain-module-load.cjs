const Module = require('node:module')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

for (const entry of ['index.cjs', 'index.mjs']) {
  const source = readFileSync(join(__dirname, '..', 'dist', 'langchain', entry), 'utf8')
  if (/\b(?:from\s+|require\()['"]langchain(?:[/'"])/.test(source)) {
    throw new Error(`The callback-only ${entry} bundle must not import langchain`)
  }
}

const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'langchain' || request.startsWith('langchain/')) {
    throw new Error('The callback-only entry point must not load langchain')
  }
  return resolveFilename.call(this, request, ...args)
}

const { LangChainCallbackHandler } = require('../dist/langchain/index.cjs')
if (typeof LangChainCallbackHandler !== 'function') {
    throw new Error('LangChainCallbackHandler was not exported')
}
