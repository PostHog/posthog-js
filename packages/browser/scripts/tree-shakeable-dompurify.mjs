import { transformAsync } from '@babel/core'

export const treeShakeableDOMPurify = () => ({
    name: 'tree-shakeable-dompurify',
    async transform(code, id) {
        if (!id.endsWith('/dompurify/dist/purify.es.mjs')) {
            return null
        }

        return transformAsync(code, {
            filename: id,
            babelrc: false,
            configFile: false,
            inputSourceMap: false,
            sourceFileName: id,
            sourceMaps: true,
            plugins: [
                ({ types: t }) => ({
                    visitor: {
                        Program(program) {
                            const body = program.node.body
                            const exported = body.pop()
                            if (
                                !t.isExportNamedDeclaration(exported) ||
                                exported.specifiers.length !== 1 ||
                                !t.isExportSpecifier(exported.specifiers[0]) ||
                                !t.isIdentifier(exported.specifiers[0].exported, { name: 'default' })
                            ) {
                                throw new Error('Unexpected DOMPurify exports; review its tree-shaking wrapper.')
                            }

                            // Keep initialization local so unused sanitizers can be removed without changing their code.
                            body.push(t.returnStatement(exported.specifiers[0].local))
                            const initialized = t.callExpression(
                                t.functionExpression(null, [], t.blockStatement(body)),
                                []
                            )
                            t.addComment(initialized, 'leading', '#__PURE__')
                            program.node.body = [t.exportDefaultDeclaration(initialized)]
                        },
                    },
                }),
            ],
        })
    },
})
