module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check if the operator is '==='
                if (node.operator === '===') {
                    // Check if left operand is an Identifier (e.g., 'obj')
                    const isLeftIdentifier = node.left.type === 'Identifier'

                    // Check if right operand is a CallExpression with the Object constructor
                    const isRightObjectCall =
                        node.right.type === 'CallExpression' &&
                        node.right.callee.type === 'Identifier' &&
                        node.right.callee.name === 'Object' &&
                        node.right.arguments.length === 1 &&
                        node.right.arguments[0].type === 'Identifier' &&
                        node.right.arguments[0].name === node.left.name

                    if (isLeftIdentifier && isRightObjectCall) {
                        context.report({
                            node,
                            message: "Do not use 'obj === Object(obj)'. Use _isObject instead.",
                        })
                    }
                }
            },
        }
    },
}
