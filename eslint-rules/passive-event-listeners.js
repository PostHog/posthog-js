module.exports = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Enforce passive event listeners for better scroll performance',
            category: 'Best Practices',
            recommended: true,
        },
        fixable: 'code',
        schema: [], // no options
    },

    create(context) {
        return {
            CallExpression(node) {
                // Check if it's an addEventListener call
                const callee = node.callee
                if (callee.type === 'MemberExpression' && callee.property.name === 'addEventListener') {
                    // Check if there's a third argument (options)
                    if (node.arguments.length < 3) {
                        context.report({
                            node,
                            message: 'addEventListener should include { passive: true } as the third argument',
                            fix(fixer) {
                                return fixer.insertTextAfterRange(
                                    [node.arguments[1].range[1], node.arguments[1].range[1]],
                                    ', { passive: true }'
                                )
                            },
                        })
                        return
                    }

                    // Handle the case where the third argument is a boolean (capture)
                    const options = node.arguments[2]
                    if (options.type === 'Literal' && typeof options.value === 'boolean') {
                        context.report({
                            node,
                            message: 'addEventListener should use an options object including { passive: true }',
                            fix(fixer) {
                                return fixer.replaceText(options, `{ capture: ${options.value}, passive: true }`)
                            },
                        })
                        return
                    }

                    // Check if the third argument is an object with passive: true
                    if (
                        options.type === 'ObjectExpression' &&
                        !options.properties.some(
                            (prop) =>
                                prop.key.name === 'passive' &&
                                prop.value.type === 'Literal' &&
                                prop.value.value === true
                        )
                    ) {
                        context.report({
                            node,
                            message: 'addEventListener should have { passive: true } in its options',
                            fix(fixer) {
                                if (options.properties.length === 0) {
                                    return fixer.replaceText(options, '{ passive: true }')
                                }
                                return fixer.insertTextAfter(
                                    options.properties[options.properties.length - 1],
                                    ', passive: true'
                                )
                            },
                        })
                    }
                }
            },
        }
    },
}
