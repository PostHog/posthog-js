module.exports = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Enforce usage of addEventListener from @utils instead of native addEventListener',
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
                    context.report({
                        node,
                        message: 'Use addEventListener from @utils instead of calling it directly on elements',
                        fix(fixer) {
                            // Get the element expression
                            const elementText = context.getSourceCode().getText(callee.object)

                            // Get the event type
                            const eventText = context.getSourceCode().getText(node.arguments[0])

                            // Get the callback
                            const callbackText = context.getSourceCode().getText(node.arguments[1])

                            // Get options if they exist
                            const optionsText =
                                node.arguments[2] != null
                                    ? context.getSourceCode().getText(node.arguments[2]) === 'true'
                                        ? ', { capture: true }'
                                        : `, ${context.getSourceCode().getText(node.arguments[2])}`
                                    : ''

                            // Add import if needed (note: this is a basic implementation, it won't always work)
                            const importFix = fixer.insertTextBefore(
                                context.getSourceCode().ast,
                                "import { addEventListener } from './utils'\n"
                            )

                            // Replace the call
                            const callFix = fixer.replaceText(
                                node,
                                `addEventListener(${elementText}, ${eventText}, ${callbackText}${optionsText})`
                            )

                            return [importFix, callFix]
                        },
                    })
                }
            },
        }
    },
}
