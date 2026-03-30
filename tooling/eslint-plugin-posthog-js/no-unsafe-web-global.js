/**
 * Flags direct value-level references to Web API globals that don't exist in React Native.
 *
 * In environments like Hermes/JSC, referencing `Event` (or similar) as a value throws
 * `ReferenceError: Property 'Event' doesn't exist`. Use `typeof Event !== 'undefined'`
 * for existence checks, or `isBuiltin(val, 'Event')` for type checks.
 *
 * Type-level references (annotations, generics, type guards) are allowed.
 */

const WEB_GLOBALS = new Set([
    'Event',
    'ErrorEvent',
    'PromiseRejectionEvent',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'TouchEvent',
    'PointerEvent',
    'FocusEvent',
    'InputEvent',
    'ClipboardEvent',
    'DragEvent',
    'AnimationEvent',
    'TransitionEvent',
    'PopStateEvent',
    'HashChangeEvent',
    'PageTransitionEvent',
    'MutationObserver',
    'IntersectionObserver',
    'ResizeObserver',
    'PerformanceObserver',
    'XMLHttpRequest',
    'WebSocket',
    'Worker',
    'SharedWorker',
    'BroadcastChannel',
    'MessageChannel',
    'MessagePort',
])

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow direct value-level references to Web API globals that may not exist in React Native',
        },
        messages: {
            unsafeWebGlobal:
                "Direct value reference to '{{name}}' will throw a ReferenceError in React Native. " +
                "Use `typeof {{name}} !== 'undefined'` for existence checks, or `isBuiltin(val, '{{name}}')` for type checks.",
        },
    },
    create(context) {
        /**
         * Check if a node is guarded by a `typeof X !== 'undefined'` check
         * on the left side of a short-circuit `&&` expression.
         * e.g. `typeof Event !== 'undefined' && isInstanceOf(candidate, Event)`
         */
        function isGuardedByTypeofCheck(node, globalName) {
            let current = node
            while (current.parent) {
                const parent = current.parent
                if (parent.type === 'LogicalExpression' && parent.operator === '&&' && parent.right === current) {
                    if (containsTypeofGuard(parent.left, globalName)) {
                        return true
                    }
                }
                current = parent
            }
            return false
        }

        function containsTypeofGuard(node, globalName) {
            if (node.type === 'BinaryExpression' && (node.operator === '!==' || node.operator === '!=')) {
                return hasTypeofOperand(node, globalName) && hasUndefinedOperand(node)
            }
            if (node.type === 'LogicalExpression' && node.operator === '&&') {
                return containsTypeofGuard(node.left, globalName) || containsTypeofGuard(node.right, globalName)
            }
            return false
        }

        function hasTypeofOperand(binaryNode, globalName) {
            return (
                (binaryNode.left.type === 'UnaryExpression' &&
                    binaryNode.left.operator === 'typeof' &&
                    binaryNode.left.argument.type === 'Identifier' &&
                    binaryNode.left.argument.name === globalName) ||
                (binaryNode.right.type === 'UnaryExpression' &&
                    binaryNode.right.operator === 'typeof' &&
                    binaryNode.right.argument.type === 'Identifier' &&
                    binaryNode.right.argument.name === globalName)
            )
        }

        function hasUndefinedOperand(binaryNode) {
            return (
                (binaryNode.left.type === 'Literal' && binaryNode.left.value === 'undefined') ||
                (binaryNode.right.type === 'Literal' && binaryNode.right.value === 'undefined')
            )
        }

        return {
            Identifier(node) {
                if (!WEB_GLOBALS.has(node.name)) {
                    return
                }

                const parent = node.parent

                // Allow: typeof Event (safe existence check)
                if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') {
                    return
                }

                // Allow: value reference guarded by typeof check via short-circuit &&
                // e.g. `typeof Event !== 'undefined' && isInstanceOf(candidate, Event)`
                if (isGuardedByTypeofCheck(node, node.name)) {
                    return
                }

                // Allow: all TypeScript type-level usage (annotations, generics, predicates, implements/extends)
                if (
                    parent.type === 'TSTypeReference' ||
                    parent.type === 'TSTypeAnnotation' ||
                    parent.type === 'TSTypeQuery' ||
                    parent.type === 'TSQualifiedName' ||
                    parent.type === 'TSTypeParameterInstantiation' ||
                    parent.type === 'TSTypePredicate' ||
                    parent.type === 'TSClassImplements' ||
                    parent.type === 'TSInterfaceHeritage'
                ) {
                    return
                }

                // Allow: property access on an object (e.g. err.Event, obj.CustomEvent)
                if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
                    return
                }

                // Allow: string literals that happen to match (e.g. 'Event' in isBuiltin calls)
                if (node.type === 'Literal') {
                    return
                }

                // Allow: as expressions (x as ErrorEvent) — the identifier is in a type position
                if (parent.type === 'TSAsExpression' && parent.typeAnnotation === node) {
                    return
                }

                // Allow: import specifiers
                if (
                    parent.type === 'ImportSpecifier' ||
                    parent.type === 'ImportDefaultSpecifier' ||
                    parent.type === 'ImportNamespaceSpecifier'
                ) {
                    return
                }

                context.report({
                    node,
                    messageId: 'unsafeWebGlobal',
                    data: { name: node.name },
                })
            },
        }
    },
}
