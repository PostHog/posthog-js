function isBrowserSdkSourceFile(filename) {
    const normalizedFilename = filename.replace(/\\/g, '/')
    const isBrowserSrc =
        normalizedFilename.includes('/packages/browser/src/') ||
        normalizedFilename.indexOf('packages/browser/src/') === 0
    return isBrowserSrc && !normalizedFilename.includes('/__tests__/')
}

function isStartsWithCall(callee) {
    if (!callee) {
        return false
    }

    if (callee.type === 'ChainExpression') {
        return isStartsWithCall(callee.expression)
    }

    if (callee.type !== 'MemberExpression') {
        return false
    }

    return callee.property?.type === 'Identifier' && callee.property.name === 'startsWith'
}

module.exports = {
    create(context) {
        if (!isBrowserSdkSourceFile(context.getFilename())) {
            return {}
        }

        return {
            CallExpression(node) {
                if (isStartsWithCall(node.callee)) {
                    context.report({
                        node,
                        message:
                            'Do not use String.prototype.startsWith in the browser SDK — IE11 does not support it. Use indexOf(...) === 0 instead.',
                    })
                }
            },
        }
    },
}
