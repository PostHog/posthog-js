import fs from 'fs'
import path from 'path'
import * as ts from 'typescript'

import * as constants from '../constants'
import { PERSISTENCE_KEY_POLICY, PERSISTENCE_KEY_PREFIX_POLICY } from '../persistence-key-policy'

const PERSISTENCE_OBJECT_METHODS = new Set(['register', 'register_once'])
const PERSISTENCE_SINGLE_KEY_METHODS = new Set(['set_property', 'unregister'])
const SESSION_OBJECT_METHODS = new Set(['register_for_session'])
const SESSION_SINGLE_KEY_METHODS = new Set(['unregister_for_session'])
const INTERNAL_SINGLE_KEY_METHODS = new Set(['_register_single'])

const isUpperSnakeCase = (value: string): boolean => /^[A-Z0-9_]+$/.test(value)

const walkFiles = (dir: string): string[] => {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
            if (entry.name === '__tests__') {
                return []
            }
            return walkFiles(fullPath)
        }

        return entry.name.endsWith('.ts') ? [fullPath] : []
    })
}

const isPropertyAccessLike = (
    expression: ts.LeftHandSideExpression
): expression is ts.PropertyAccessExpression | ts.PropertyAccessChain => {
    return ts.isPropertyAccessExpression(expression) || ts.isPropertyAccessChain(expression)
}

const collectVariableInitializers = (sourceFile: ts.SourceFile): Map<string, ts.Expression> => {
    const variableInitializers = new Map<string, ts.Expression>()

    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            variableInitializers.set(node.name.text, node.initializer)
        }
        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return variableInitializers
}

const getLine = (sourceFile: ts.SourceFile, node: ts.Node): number => {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

const getMethodName = (expression: ts.Expression): string | undefined => {
    return isPropertyAccessLike(expression) ? expression.name.text : undefined
}

const getReceiver = (expression: ts.Expression): ts.Expression | undefined => {
    return isPropertyAccessLike(expression) ? expression.expression : undefined
}

const isIdentifierNamed = (expression: ts.Expression | undefined, name: string): boolean => {
    return !!expression && ts.isIdentifier(expression) && expression.text === name
}

const hasPropertyName = (expression: ts.Expression | undefined, names: string[]): boolean => {
    return (
        !!expression &&
        isPropertyAccessLike(expression as ts.LeftHandSideExpression) &&
        names.includes(expression.name.text)
    )
}

const isPersistenceReceiver = (expression: ts.Expression | undefined): boolean => {
    return isIdentifierNamed(expression, 'persistence') || hasPropertyName(expression, ['persistence', '_persistence'])
}

const isSessionPersistenceReceiver = (expression: ts.Expression | undefined): boolean => {
    return hasPropertyName(expression, ['sessionPersistence'])
}

const isRegisterForSessionReceiver = (expression: ts.Expression | undefined): boolean => {
    return (
        !!expression &&
        (ts.isThis(expression) ||
            isIdentifierNamed(expression, 'posthog') ||
            hasPropertyName(expression, ['_instance', 'instance']))
    )
}

interface ResolutionResult {
    identifiers: Set<string>
    rawLiterals: Set<string>
}

const createResolutionResult = (): ResolutionResult => ({
    identifiers: new Set<string>(),
    rawLiterals: new Set<string>(),
})

const resolvePolicyIdentifiers = (
    expression: ts.Expression | undefined,
    variableInitializers: Map<string, ts.Expression>,
    visitedVariables: Set<string> = new Set()
): ResolutionResult => {
    const result = createResolutionResult()

    const visit = (node: ts.Expression | undefined): void => {
        if (!node) {
            return
        }

        if (ts.isIdentifier(node)) {
            if (isUpperSnakeCase(node.text)) {
                result.identifiers.add(node.text)
                return
            }

            const initializer = variableInitializers.get(node.text)
            if (initializer && !visitedVariables.has(node.text)) {
                visitedVariables.add(node.text)
                visit(initializer)
            }
            return
        }

        if (
            ts.isParenthesizedExpression(node) ||
            ts.isAsExpression(node) ||
            ts.isTypeAssertionExpression(node) ||
            ts.isNonNullExpression(node)
        ) {
            visit(node.expression)
            return
        }

        if (
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isNumericLiteral(node) ||
            ts.isRegularExpressionLiteral(node)
        ) {
            result.rawLiterals.add(node.getText())
            return
        }

        if (ts.isTemplateExpression(node)) {
            result.rawLiterals.add(node.getText())
            return
        }

        if (ts.isConditionalExpression(node)) {
            visit(node.whenTrue)
            visit(node.whenFalse)
            return
        }

        if (ts.isBinaryExpression(node)) {
            visit(node.left)
            visit(node.right)
        }
    }

    visit(expression)
    return result
}

interface ScanResult {
    identifiers: Set<string>
    issues: string[]
}

const collectPersistenceKeyIdentifiers = (): ScanResult => {
    const identifiers = new Set<string>()
    const issues: string[] = []
    const sourceRoot = path.resolve(__dirname, '..')

    for (const filePath of walkFiles(sourceRoot)) {
        const sourceText = fs.readFileSync(filePath, 'utf8')
        const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
        const variableInitializers = collectVariableInitializers(sourceFile)

        const recordResolution = (expression: ts.Expression | undefined, node: ts.Node, context: string) => {
            if (expression && ts.isIdentifier(expression) && expression.text === 'property') {
                return
            }

            const resolution = resolvePolicyIdentifiers(expression, variableInitializers)

            resolution.identifiers.forEach((identifier) => identifiers.add(identifier))

            if (resolution.rawLiterals.size > 0) {
                issues.push(
                    `${path.relative(sourceRoot, filePath)}:${getLine(sourceFile, node)} ${context} must use constants instead of raw literal keys: ${[
                        ...resolution.rawLiterals,
                    ].join(', ')}`
                )
                return
            }

            if (resolution.identifiers.size === 0) {
                issues.push(
                    `${path.relative(sourceRoot, filePath)}:${getLine(sourceFile, node)} ${context} must resolve to a persistence key constant`
                )
            }
        }

        const recordObjectLike = (argument: ts.Expression | undefined, node: ts.Node, context: string): void => {
            if (!argument) {
                return
            }

            if (ts.isIdentifier(argument) && argument.text === 'properties') {
                return
            }

            if (
                ts.isParenthesizedExpression(argument) ||
                ts.isAsExpression(argument) ||
                ts.isTypeAssertionExpression(argument) ||
                ts.isNonNullExpression(argument)
            ) {
                recordObjectLike(argument.expression, node, context)
                return
            }

            if (ts.isConditionalExpression(argument)) {
                recordObjectLike(argument.whenTrue, node, context)
                recordObjectLike(argument.whenFalse, node, context)
                return
            }

            if (!ts.isObjectLiteralExpression(argument)) {
                issues.push(
                    `${path.relative(sourceRoot, filePath)}:${getLine(sourceFile, node)} ${context} must use an object literal with computed constant keys`
                )
                return
            }

            for (const property of argument.properties) {
                if (ts.isPropertyAssignment(property) && ts.isComputedPropertyName(property.name)) {
                    recordResolution(property.name.expression, property.name, context)
                    continue
                }

                if (ts.isSpreadAssignment(property)) {
                    recordObjectLike(property.expression, property, context)
                    continue
                }

                issues.push(
                    `${path.relative(sourceRoot, filePath)}:${getLine(sourceFile, property)} ${context} must use computed constant keys`
                )
            }
        }

        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const methodName = getMethodName(node.expression)
                const receiver = getReceiver(node.expression)

                if (
                    methodName &&
                    PERSISTENCE_OBJECT_METHODS.has(methodName) &&
                    (isPersistenceReceiver(receiver) || isSessionPersistenceReceiver(receiver))
                ) {
                    recordObjectLike(node.arguments[0], node, `${methodName}() on persistence`)
                }

                if (
                    methodName &&
                    PERSISTENCE_SINGLE_KEY_METHODS.has(methodName) &&
                    (isPersistenceReceiver(receiver) || isSessionPersistenceReceiver(receiver))
                ) {
                    recordResolution(node.arguments[0], node, `${methodName}() on persistence`)
                }

                if (methodName && SESSION_OBJECT_METHODS.has(methodName) && isRegisterForSessionReceiver(receiver)) {
                    recordObjectLike(node.arguments[0], node, `${methodName}()`)
                }

                if (
                    methodName &&
                    SESSION_SINGLE_KEY_METHODS.has(methodName) &&
                    isRegisterForSessionReceiver(receiver)
                ) {
                    recordResolution(node.arguments[0], node, `${methodName}()`)
                }

                if (methodName && INTERNAL_SINGLE_KEY_METHODS.has(methodName)) {
                    recordResolution(node.arguments[0], node, `${methodName}()`)
                }
            }

            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
    }

    return { identifiers, issues }
}

describe('persistence key policy', () => {
    it('classifies SDK-owned persistence keys and forbids raw literal keys at persistence write sites', () => {
        const exactPolicyKeys = new Set(Object.keys(PERSISTENCE_KEY_POLICY))
        const prefixPolicyKeys = new Set(PERSISTENCE_KEY_PREFIX_POLICY.map(([prefix]) => prefix))
        const { identifiers, issues } = collectPersistenceKeyIdentifiers()

        expect(issues).toEqual([])

        for (const identifier of identifiers) {
            const value = constants[identifier as keyof typeof constants]

            expect(value).toBeDefined()

            if (identifier.endsWith('_PREFIX')) {
                expect(prefixPolicyKeys.has(value as string)).toBe(true)
            } else {
                expect(exactPolicyKeys.has(value as string)).toBe(true)
            }
        }
    })
})
