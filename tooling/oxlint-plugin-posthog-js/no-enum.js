module.exports = {
    meta: {
        type: 'problem',
        messages: {
            noEnum: 'Enums add significant bundle bloat. Use a const object with `as const` and a type union instead.',
        },
    },
    create(context) {
        return {
            TSEnumDeclaration(node) {
                context.report({ node, messageId: 'noEnum' })
            },
        }
    },
}
