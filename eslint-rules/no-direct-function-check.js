module.exports = {
    create(context) {
        return {
            CallExpression: function (node) {
                // Check if the callee object is a regex matching function pattern
                const isFunctionPatternRegex =
                    node.callee.type === 'MemberExpression' &&
                    node.callee.object?.type === 'Literal' &&
                    node.callee.object?.regex &&
                    node.callee.object?.regex.pattern === '^\\s*\\bfunction\\b'

                // Check if the callee property is 'test'
                const isTestCall = node.callee.property?.type === 'Identifier' && node.callee.property?.name === 'test'

                if (isFunctionPatternRegex && isTestCall) {
                    context.report({
                        node,
                        message: 'Do not use regex to check for functions. Use _isFunction instead.',
                    })
                }
            },
            BinaryExpression: function (node) {
                // Check if the operator is 'instanceof' and the right operand is 'Function'
                if (
                    node.operator === 'instanceof' &&
                    node.right.type === 'Identifier' &&
                    node.right.name === 'Function'
                ) {
                    context.report({
                        node,
                        message: "Do not use 'instanceof Function' to check for functions. Use _isFunction instead.",
                    })
                }

                // Check for 'typeof x === "function"' pattern
                if (
                    node.operator === '===' &&
                    node.left.type === 'UnaryExpression' &&
                    node.left.operator === 'typeof' &&
                    node.right.type === 'Literal' &&
                    node.right.value === 'function'
                ) {
                    context.report({
                        node,
                        message:
                            'Do not use \'typeof x === "function"\' to check for functions. Use _isFunction instead.',
                    })
                }
            },
        }
    },
}
