const PROCESS_SUFFIXES = new Set(['client', 'browser', 'server', 'nitro', 'dev', 'test', 'prerender'])

module.exports = {
    meta: {
        type: 'suggestion',
        fixable: 'code',
        messages: {
            preferImportMeta: 'Replace `process.{{suffix}}` with `import.meta.{{suffix}}`.',
        },
    },
    create(context) {
        return {
            MemberExpression(node) {
                if (
                    node.object.type !== 'Identifier' ||
                    node.object.name !== 'process' ||
                    !context.sourceCode.isGlobalReference(node.object) ||
                    node.computed ||
                    node.property.type !== 'Identifier' ||
                    !PROCESS_SUFFIXES.has(node.property.name)
                ) {
                    return
                }

                const suffix = node.property.name
                context.report({
                    node,
                    messageId: 'preferImportMeta',
                    data: { suffix },
                    fix: (fixer) => fixer.replaceText(node.object, 'import.meta'),
                })
            },
        }
    },
}
