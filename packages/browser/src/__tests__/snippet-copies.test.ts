import fs from 'fs'
import path from 'path'
import { runInNewContext } from 'vm'

const repositoryRoot = path.resolve(__dirname, '../../../..')

const snippetCopies = [
    { file: 'examples/example-sdk_dr/test-feature-flag-misconfiguration.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'examples/example-sdk_dr/test-time-based-detection.html', runtimeSnippets: 7, descriptors: 14 },
    { file: 'packages/browser/playground/cross-lifecycle-stylesheet/index.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/csp-violations/server.js', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/css-layers/index.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/cypress-full/index.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/cypress/index.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/cypress/page2.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/preload-link-leak/index.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/session-recordings/index.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'packages/browser/playground/snippet/index.html', runtimeSnippets: 1, descriptors: 4 },
    { file: 'packages/browser/playground/vscode-extension/src/extension.js', runtimeSnippets: 1, descriptors: 2 },
    { file: 'playground/flags/evaluation-tags-example.html', runtimeSnippets: 1, descriptors: 2 },
    { file: 'playground/nextjs/pages/_document.tsx', runtimeSnippets: 1, descriptors: 2 },
] as const

const compactSnippetPattern = /!function\s*\(t,\s*e\)\s*\{[\s\S]*?\}\s*\(document,\s*window\.posthog\s*\|\|\s*\[\]\);/g
const formattedSnippetPattern =
    /!\(function\s*\(t,\s*e\)\s*\{[\s\S]*?\}\)\s*\(document,\s*window\.posthog\s*\|\|\s*\[\]\)/g
const directToStringAssignmentPattern = /\b(?:u|e)(?:\.people)?\.toString\s*=/g
const safeToStringDescriptorPattern =
    /Object\.defineProperty\(\s*(?:u|e)(?:\.people)?\s*,\s*['"]toString['"]\s*,\s*\{\s*configurable:\s*!0,\s*enumerable:\s*!0,\s*writable:\s*!0,\s*value:/g

type SnippetStub = unknown[] & {
    _i: unknown[][]
    init: (token: string, config: { api_host: string }) => void
    people: unknown[]
}

const readSnippetCopy = (file: string): string => fs.readFileSync(path.join(repositoryRoot, file), 'utf8')

const extractRuntimeSnippets = (source: string): string[] => [
    ...(source.match(compactSnippetPattern) || []),
    ...(source.match(formattedSnippetPattern) || []),
]

describe('browser snippet copies', () => {
    it.each(snippetCopies)('$file defines safe own toString properties', ({ file, descriptors }) => {
        const source = readSnippetCopy(file)

        expect(source.match(directToStringAssignmentPattern) || []).toHaveLength(0)
        expect(source.match(safeToStringDescriptorPattern) || []).toHaveLength(descriptors)
    })

    it.each(snippetCopies)('$file initializes with read-only Array.prototype.toString', ({ file, runtimeSnippets }) => {
        const snippets = extractRuntimeSnippets(readSnippetCopy(file))
        expect(snippets).toHaveLength(runtimeSnippets)

        for (const snippet of snippets) {
            const insertedScripts: unknown[] = []
            const snippetWindow: { posthog?: SnippetStub } = {}
            const snippetDocument = {
                createElement: (): Record<string, unknown> => ({}),
                getElementsByTagName: () => [
                    {
                        parentNode: {
                            insertBefore: (script: unknown): void => {
                                insertedScripts.push(script)
                            },
                        },
                    },
                ],
            }
            const runnableSnippet = snippet.replace(
                '${snippetSrc}',
                '"https://us-assets.i.posthog.com/static/array.js"'
            )

            runInNewContext(
                `'use strict';Object.defineProperty(Array.prototype,'toString',{writable:false});${runnableSnippet}`,
                { document: snippetDocument, window: snippetWindow }
            )

            const posthog = snippetWindow.posthog
            expect(posthog).toBeDefined()
            if (!posthog) {
                throw new Error('Snippet did not initialize window.posthog')
            }
            posthog.init('phc_test', { api_host: 'https://us.i.posthog.com' })

            expect(insertedScripts).toHaveLength(1)
            expect(posthog.toString()).toBe('posthog (stub)')
            expect(posthog.people.toString()).toBe('posthog.people (stub)')
            expect(Object.getOwnPropertyDescriptor(posthog, 'toString')).toMatchObject({
                configurable: true,
                enumerable: true,
                writable: true,
            })
            expect(Object.getOwnPropertyDescriptor(posthog.people, 'toString')).toMatchObject({
                configurable: true,
                enumerable: true,
                writable: true,
            })
        }
    })
})
