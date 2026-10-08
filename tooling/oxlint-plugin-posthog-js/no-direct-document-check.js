module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check for `toString.call(x) == '[object HTMLDocument]'`
                if (
                    (node.operator === '==' || node.operator === '===') &&
                    node.left.type === 'CallExpression' &&
                    node.left.callee.property &&
                    node.left.callee.property.name === 'call' &&
                    node.left.callee.object &&
                    node.left.callee.object.name === 'toString' &&
                    node.right.type === 'Literal' &&
                    node.right.value === '[object HTMLDocument]'
                ) {
                    context.report({
                        node,
                        message: 'Use isDocument instead of direct document checks.',
                    })
                }

                // Check for `x instanceof Document`
                if (
                    node.operator === 'instanceof' &&
                    node.right.type === 'Identifier' &&
                    node.right.name === 'Document'
                ) {
                    context.report({
                        node,
                        message: 'Use isDocument instead of direct document checks.',
                    })
                }
            },
        }
    },
}
