import fs from 'fs'
import path from 'path'
import * as ts from 'typescript'

import { isUndefined } from '@posthog/core'

import * as constants from '../constants'
import { getPersistenceKeyPolicy, PERSISTENCE_KEY_POLICY, PERSISTENCE_STORAGE_GROUPS } from '../persistence-key-policy'

const PERSISTENCE_OBJECT_METHODS = new Set(['register', 'register_once'])
const PERSISTENCE_SINGLE_KEY_METHODS = new Set(['set_property', 'unregister'])
const KEY_VALUE_STORE_SINGLE_KEY_METHODS = new Set(['set', 'remove'])
const SESSION_OBJECT_METHODS = new Set(['register_for_session'])
const SESSION_SINGLE_KEY_METHODS = new Set(['unregister_for_session'])
const INTERNAL_SINGLE_KEY_METHODS = new Set(['_register_single', '_setProp', '_deleteProp'])
const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..')
const SOURCE_ROOTS = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../../../browser-common/src')]
const PERSISTENCE_KEY_PREFIXES = new Set([
    constants.SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX,
    constants.SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX,
    constants.SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX,
])

const LEGACY_RESERVED_PERSISTENCE_KEYS = new Set<string>([
    constants.PEOPLE_DISTINCT_ID_KEY,
    constants.ALIAS_ID_KEY,
    constants.CAMPAIGN_IDS_KEY,
    constants.EVENT_TIMERS_KEY,
    constants.SESSION_RECORDING_ENABLED_SERVER_SIDE,
    constants.HEATMAPS_ENABLED_SERVER_SIDE,
    constants.LOGS_CAPTURE_ENABLED_SERVER_SIDE,
    constants.SESSION_ID,
    constants.ENABLED_FEATURE_FLAGS,
    constants.ERROR_TRACKING_SUPPRESSION_RULES,
    constants.USER_STATE,
    constants.PERSISTENCE_EARLY_ACCESS_FEATURES,
    constants.PERSISTENCE_FEATURE_FLAG_DETAILS,
    constants.STORED_GROUP_PROPERTIES_KEY,
    constants.STORED_PERSON_PROPERTIES_KEY,
    constants.SURVEYS,
    constants.SURVEYS_LOADED_AT,
    constants.FLAG_CALL_REPORTED,
    constants.FLAG_CALL_REPORTED_SESSION_ID,
    constants.PERSISTENCE_FEATURE_FLAG_ERRORS,
    constants.PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    constants.PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
    constants.CLIENT_SESSION_PROPS,
    constants.CAPTURE_RATE_LIMIT,
    constants.INITIAL_CAMPAIGN_PARAMS,
    constants.INITIAL_REFERRER_INFO,
    constants.ENABLE_PERSON_PROCESSING,
    constants.INITIAL_PERSON_INFO,
    constants.PRODUCT_TOURS,
    constants.PRODUCT_TOURS_ACTIVATED,
    constants.SURVEYS_ACTIVATED_SESSION,
    constants.SURVEYS_ACTIVATED_TIMESTAMPS,
    constants.PRODUCT_TOURS_ACTIVATED_SESSION,
    constants.PRODUCT_TOURS_ENABLED_SERVER_SIDE,
    constants.SESSION_RECORDING_REMOTE_CONFIG,
    constants.PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS,
    constants.SESSION_RECORDING_FLUSHED_SIZE,
])

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

const getResolvedSymbol = (node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined => {
    const symbol = checker.getSymbolAtLocation(node)
    if (!symbol) {
        return undefined
    }
    return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

const getSymbolInitializer = (symbol: ts.Symbol | undefined): ts.Expression | undefined => {
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    return declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration))
        ? declaration.initializer
        : undefined
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

const isKeyValueStoreReceiver = (
    expression: ts.Expression | undefined,
    checker: ts.TypeChecker,
    visitedSymbols: Set<ts.Symbol> = new Set()
): boolean => {
    if (!expression) {
        return false
    }
    if (hasPropertyName(expression, ['kv'])) {
        return true
    }

    const symbolNode = isPropertyAccessLike(expression as ts.LeftHandSideExpression)
        ? expression.name
        : ts.isIdentifier(expression)
          ? expression
          : undefined
    if (!symbolNode) {
        return false
    }

    const symbol = getResolvedSymbol(symbolNode, checker)
    if (!symbol || visitedSymbols.has(symbol)) {
        return false
    }
    visitedSymbols.add(symbol)

    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (declaration && ts.isBindingElement(declaration)) {
        const propertyName = declaration.propertyName ?? declaration.name
        return ts.isIdentifier(propertyName) && propertyName.text === 'kv'
    }
    const initializer = getSymbolInitializer(symbol)
    return !!initializer && isKeyValueStoreReceiver(initializer, checker, visitedSymbols)
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
    resolvedKeys: Set<string>
    rawLiterals: Set<string>
    hasUnresolved: boolean
}

const createResolutionResult = (): ResolutionResult => ({
    identifiers: new Set<string>(),
    resolvedKeys: new Set<string>(),
    rawLiterals: new Set<string>(),
    hasUnresolved: false,
})

const resolvePolicyIdentifiers = (
    expression: ts.Expression | undefined,
    checker: ts.TypeChecker,
    visitedSymbols: Set<ts.Symbol> = new Set()
): ResolutionResult => {
    const result = createResolutionResult()

    const visitSymbol = (node: ts.Identifier, resolvesNamedConstant: boolean): boolean => {
        const symbol = getResolvedSymbol(node, checker)
        const initializer = getSymbolInitializer(symbol)
        if (!symbol || !initializer || visitedSymbols.has(symbol)) {
            return false
        }

        visitedSymbols.add(symbol)
        visit(initializer, resolvesNamedConstant || isUpperSnakeCase(node.text))
        return true
    }

    const visit = (node: ts.Expression | undefined, resolvesNamedConstant = false): void => {
        if (!node) {
            return
        }

        if (ts.isIdentifier(node)) {
            if (!visitSymbol(node, resolvesNamedConstant)) {
                result.hasUnresolved = true
            }
            return
        }

        if (isPropertyAccessLike(node as ts.LeftHandSideExpression) && isUpperSnakeCase(node.name.text)) {
            if (!visitSymbol(node.name, true)) {
                result.hasUnresolved = true
            }
            return
        }

        if (
            ts.isParenthesizedExpression(node) ||
            ts.isAsExpression(node) ||
            ts.isTypeAssertionExpression(node) ||
            ts.isNonNullExpression(node)
        ) {
            visit(node.expression, resolvesNamedConstant)
            return
        }

        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (resolvesNamedConstant) {
                result.resolvedKeys.add(node.text)
            } else {
                result.rawLiterals.add(node.getText())
            }
            return
        }

        if (ts.isArrayLiteralExpression(node)) {
            node.elements.forEach((element) => visit(element, resolvesNamedConstant))
            return
        }

        if (ts.isNumericLiteral(node) || ts.isRegularExpressionLiteral(node) || ts.isTemplateExpression(node)) {
            result.rawLiterals.add(node.getText())
            return
        }

        if (ts.isConditionalExpression(node)) {
            visit(node.whenTrue, resolvesNamedConstant)
            visit(node.whenFalse, resolvesNamedConstant)
            return
        }

        if (ts.isBinaryExpression(node)) {
            visit(node.left, resolvesNamedConstant)
            visit(node.right, resolvesNamedConstant)
            return
        }

        result.hasUnresolved = true
    }

    visit(expression)
    return result
}

interface KeyCompositionResult {
    containsComposition: boolean
    staticValue?: string
    staticValueIsNamed: boolean
    dynamicPrefix?: string
    dynamicPrefixIsNamed: boolean
    alternatives?: KeyCompositionResult[]
}

const analyzeKeyComposition = (
    expression: ts.Expression | undefined,
    checker: ts.TypeChecker,
    resolvesNamedConstant = false,
    visitedSymbols: Set<ts.Symbol> = new Set()
): KeyCompositionResult => {
    const unresolved = (): KeyCompositionResult => ({
        containsComposition: false,
        staticValueIsNamed: false,
        dynamicPrefixIsNamed: false,
    })
    if (!expression) {
        return unresolved()
    }

    if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isTypeAssertionExpression(expression) ||
        ts.isNonNullExpression(expression)
    ) {
        return analyzeKeyComposition(expression.expression, checker, resolvesNamedConstant, visitedSymbols)
    }

    if (ts.isIdentifier(expression) || isPropertyAccessLike(expression as ts.LeftHandSideExpression)) {
        const symbolNode = ts.isIdentifier(expression) ? expression : expression.name
        const symbol = getResolvedSymbol(symbolNode, checker)
        const initializer = getSymbolInitializer(symbol)
        if (!symbol || !initializer || visitedSymbols.has(symbol)) {
            return unresolved()
        }
        visitedSymbols.add(symbol)
        return analyzeKeyComposition(
            initializer,
            checker,
            resolvesNamedConstant || isUpperSnakeCase(symbolNode.text),
            visitedSymbols
        )
    }

    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return {
            containsComposition: false,
            staticValue: expression.text,
            staticValueIsNamed: resolvesNamedConstant,
            dynamicPrefixIsNamed: false,
        }
    }

    if (ts.isConditionalExpression(expression)) {
        const alternatives = [
            analyzeKeyComposition(expression.whenTrue, checker, resolvesNamedConstant, new Set(visitedSymbols)),
            analyzeKeyComposition(expression.whenFalse, checker, resolvesNamedConstant, new Set(visitedSymbols)),
        ]
        return alternatives.some(({ containsComposition }) => containsComposition)
            ? {
                  containsComposition: true,
                  staticValueIsNamed: false,
                  dynamicPrefixIsNamed: false,
                  alternatives,
              }
            : unresolved()
    }

    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.PlusToken) {
        return unresolved()
    }

    const left = analyzeKeyComposition(expression.left, checker, resolvesNamedConstant, new Set(visitedSymbols))
    const right = analyzeKeyComposition(expression.right, checker, resolvesNamedConstant, new Set(visitedSymbols))
    if (!isUndefined(left.staticValue) && !isUndefined(right.staticValue)) {
        return {
            containsComposition: true,
            staticValue: left.staticValue + right.staticValue,
            staticValueIsNamed: left.staticValueIsNamed && right.staticValueIsNamed,
            dynamicPrefixIsNamed: false,
        }
    }

    return {
        containsComposition: true,
        staticValueIsNamed: false,
        dynamicPrefix: left.staticValue ?? left.dynamicPrefix,
        dynamicPrefixIsNamed: !isUndefined(left.staticValue) ? left.staticValueIsNamed : left.dynamicPrefixIsNamed,
    }
}

interface SourceInput {
    filePath: string
    sourceText: string
}

interface ScanResult {
    identifiers: Set<string>
    resolvedKeys: Set<string>
    issues: string[]
}

const productionSources = (): SourceInput[] =>
    SOURCE_ROOTS.flatMap((sourceRoot) =>
        walkFiles(sourceRoot).map((filePath) => ({ filePath, sourceText: fs.readFileSync(filePath, 'utf8') }))
    )

const createAnalysisProgram = (sources: SourceInput[]): ts.Program => {
    const compilerOptions: ts.CompilerOptions = {
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        skipLibCheck: true,
        target: ts.ScriptTarget.Latest,
    }
    const sourceTexts = new Map(sources.map(({ filePath, sourceText }) => [path.resolve(filePath), sourceText]))
    const host = ts.createCompilerHost(compilerOptions)
    const readFile = host.readFile.bind(host)
    const fileExists = host.fileExists.bind(host)
    const getSourceFile = host.getSourceFile.bind(host)

    host.fileExists = (filePath) => sourceTexts.has(path.resolve(filePath)) || fileExists(filePath)
    host.readFile = (filePath) => sourceTexts.get(path.resolve(filePath)) ?? readFile(filePath)
    host.getSourceFile = (filePath, languageVersion, onError, shouldCreateNewSourceFile) => {
        const sourceText = sourceTexts.get(path.resolve(filePath))
        return isUndefined(sourceText)
            ? getSourceFile(filePath, languageVersion, onError, shouldCreateNewSourceFile)
            : ts.createSourceFile(filePath, sourceText, languageVersion, true)
    }

    return ts.createProgram({
        rootNames: sources.map(({ filePath }) => path.resolve(filePath)),
        options: compilerOptions,
        host,
    })
}

const collectPersistenceKeyIdentifiers = (sources: SourceInput[] = productionSources()): ScanResult => {
    const identifiers = new Set<string>()
    const resolvedKeys = new Set<string>()
    const issues: string[] = []
    const program = createAnalysisProgram(sources)
    const checker = program.getTypeChecker()

    for (const { filePath } of sources) {
        const sourceFile = program.getSourceFile(path.resolve(filePath))
        if (!sourceFile) {
            issues.push(
                `${path.relative(REPOSITORY_ROOT, filePath)} could not be loaded for persistence policy analysis`
            )
            continue
        }
        const relativeFilePath = path.relative(REPOSITORY_ROOT, filePath)

        const recordResolution = (
            expression: ts.Expression | undefined,
            node: ts.Node,
            context: string,
            enforceResolvedKey = false
        ) => {
            // Policy is checked at each client.kv write; forwarding implementations are checked at their callers.
            if (
                isForwardedKeyValueStoreKey(expression, node, checker) ||
                isForwardedFeatureFlagsStateKey(expression, node, checker)
            ) {
                return
            }

            if (
                !enforceResolvedKey &&
                expression &&
                ts.isIdentifier(expression) &&
                ['property', 'prop'].includes(expression.text)
            ) {
                return
            }

            const composition = analyzeKeyComposition(expression, checker)
            if (composition.containsComposition) {
                const recordComposition = (result: KeyCompositionResult): void => {
                    if (result.alternatives) {
                        result.alternatives.forEach(recordComposition)
                        return
                    }

                    if (!isUndefined(result.staticValue) && result.staticValueIsNamed) {
                        resolvedKeys.add(result.staticValue)
                        if (!getPersistenceKeyPolicy(result.staticValue)) {
                            issues.push(
                                `${relativeFilePath}:${getLine(sourceFile, node)} ${context} uses ${JSON.stringify(result.staticValue)}, which has no persistence key policy`
                            )
                        }
                        return
                    }

                    const registeredPrefix = result.dynamicPrefix
                        ? [...PERSISTENCE_KEY_PREFIXES].find((prefix) => result.dynamicPrefix?.indexOf(prefix) === 0)
                        : undefined
                    if (!registeredPrefix || !result.dynamicPrefixIsNamed) {
                        issues.push(
                            `${relativeFilePath}:${getLine(sourceFile, node)} ${context} forms a dynamic key without a named, registered persistence key prefix`
                        )
                    } else {
                        resolvedKeys.add(registeredPrefix)
                    }
                }

                recordComposition(composition)
                return
            }

            const resolution = resolvePolicyIdentifiers(expression, checker)

            resolution.identifiers.forEach((identifier) => identifiers.add(identifier))
            resolution.resolvedKeys.forEach((key) => {
                resolvedKeys.add(key)
                if (!getPersistenceKeyPolicy(key)) {
                    issues.push(
                        `${relativeFilePath}:${getLine(sourceFile, node)} ${context} uses ${JSON.stringify(key)}, which has no persistence key policy`
                    )
                }
            })

            if (resolution.hasUnresolved) {
                issues.push(
                    `${relativeFilePath}:${getLine(sourceFile, node)} ${context} must resolve to a persistence key constant or registered prefix in every branch`
                )
                return
            }

            if (resolution.rawLiterals.size > 0) {
                issues.push(
                    `${relativeFilePath}:${getLine(sourceFile, node)} ${context} must use constants instead of raw literal keys: ${[
                        ...resolution.rawLiterals,
                    ].join(', ')}`
                )
                return
            }

            if (resolution.identifiers.size === 0 && resolution.resolvedKeys.size === 0) {
                issues.push(
                    `${relativeFilePath}:${getLine(sourceFile, node)} ${context} must resolve to a persistence key constant`
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
                    `${relativeFilePath}:${getLine(sourceFile, node)} ${context} must use an object literal with computed constant keys`
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
                    `${relativeFilePath}:${getLine(sourceFile, property)} ${context} must use computed constant keys`
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

                if (
                    methodName &&
                    KEY_VALUE_STORE_SINGLE_KEY_METHODS.has(methodName) &&
                    isKeyValueStoreReceiver(receiver, checker)
                ) {
                    if (methodName === 'set' && node.arguments.length === 1) {
                        recordObjectLike(node.arguments[0], node, `${methodName}() on KeyValueStore`)
                    } else {
                        recordResolution(node.arguments[0], node, `${methodName}() on KeyValueStore`, true)
                    }
                }

                if (
                    methodName === '_remove' &&
                    ts.isThis(receiver) &&
                    getEnclosingClassName(node) === 'PostHogFeatureFlags'
                ) {
                    recordResolution(node.arguments[0], node, '_remove() in PostHogFeatureFlags', true)
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

    return { identifiers, resolvedKeys, issues }
}

const getEnclosingClassMethodName = (node: ts.Node): string | undefined => {
    let current: ts.Node | undefined = node

    while (current) {
        if (
            (ts.isMethodDeclaration(current) ||
                ts.isGetAccessorDeclaration(current) ||
                ts.isSetAccessorDeclaration(current)) &&
            current.name &&
            ts.isIdentifier(current.name)
        ) {
            return current.name.text
        }
        current = current.parent
    }

    return undefined
}

const getEnclosingClassName = (node: ts.Node): string | undefined => {
    let current: ts.Node | undefined = node

    while (current) {
        if ((ts.isClassDeclaration(current) || ts.isClassExpression(current)) && current.name) {
            return current.name.text
        }
        current = current.parent
    }

    return undefined
}

const isBrowserCommonKeyValueStoreSymbol = (symbol: ts.Symbol | undefined): boolean =>
    !!symbol?.declarations?.some((declaration) => {
        const declarationName = 'name' in declaration ? declaration.name : undefined
        const filePath = declaration.getSourceFile().fileName.replace(/\\/g, '/')
        return (
            !!declarationName &&
            ts.isIdentifier(declarationName) &&
            declarationName.text === 'KeyValueStore' &&
            /\/packages\/browser-common\/(?:src|dist)\/persistence(?:\.d)?\.ts$/.test(filePath)
        )
    })

const isForwardedKeyValueStoreKey = (
    expression: ts.Expression | undefined,
    node: ts.Node,
    checker: ts.TypeChecker
): boolean => {
    if (!expression || !ts.isIdentifier(expression)) {
        return false
    }

    let current: ts.Node | undefined = node
    while (current) {
        if (ts.isMethodDeclaration(current) && current.name && ts.isIdentifier(current.name)) {
            const keyParameter = current.parameters[0]?.name
            if (
                !KEY_VALUE_STORE_SINGLE_KEY_METHODS.has(current.name.text) ||
                !keyParameter ||
                !ts.isIdentifier(keyParameter) ||
                getResolvedSymbol(keyParameter, checker) !== getResolvedSymbol(expression, checker)
            ) {
                return false
            }

            const classDeclaration = current.parent
            if (!ts.isClassDeclaration(classDeclaration) && !ts.isClassExpression(classDeclaration)) {
                return false
            }

            return !!classDeclaration.heritageClauses?.some(
                (clause) =>
                    clause.token === ts.SyntaxKind.ImplementsKeyword &&
                    clause.types.some((type) =>
                        isBrowserCommonKeyValueStoreSymbol(getResolvedSymbol(type.expression, checker))
                    )
            )
        }
        current = current.parent
    }

    return false
}

const isForwardedFeatureFlagsStateKey = (
    expression: ts.Expression | undefined,
    node: ts.Node,
    checker: ts.TypeChecker
): boolean => {
    if (
        !expression ||
        !ts.isIdentifier(expression) ||
        getEnclosingClassName(node) !== 'PostHogFeatureFlags' ||
        getEnclosingClassMethodName(node) !== '_remove'
    ) {
        return false
    }

    let current: ts.Node | undefined = node
    while (current && !ts.isMethodDeclaration(current)) {
        current = current.parent
    }
    if (!current) {
        return false
    }

    const keyParameter = current.parameters[0]?.name
    return (
        !!keyParameter &&
        ts.isIdentifier(keyParameter) &&
        getResolvedSymbol(keyParameter, checker) === getResolvedSymbol(expression, checker)
    )
}

const isThisPropsElementAccess = (expression: ts.Expression): boolean => {
    return (
        ts.isElementAccessExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        ts.isThis(expression.expression.expression) &&
        expression.expression.name.text === 'props'
    )
}

const collectPostHogPersistenceMutationBoundaryIssues = (): string[] => {
    const issues: string[] = []
    const filePath = path.resolve(__dirname, '../posthog-persistence.ts')
    const sourceText = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
    const allowedDirectMutationMethods = new Set(['_setProp', '_deleteProp'])
    const allowedSinkCallerMethods = new Set([
        '_setProp',
        '_deleteProp',
        '_syncCookieProperties',
        'register',
        'register_once',
        'unregister',
        'set_event_timer',
        'remove_event_timer',
        'set_property',
        'refreshKey',
    ])

    const visit = (node: ts.Node) => {
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            isThisPropsElementAccess(node.left)
        ) {
            const enclosingMethodName = getEnclosingClassMethodName(node)
            if (!enclosingMethodName || !allowedDirectMutationMethods.has(enclosingMethodName)) {
                issues.push(
                    `posthog-persistence.ts:${getLine(sourceFile, node)} direct this.props assignment must be contained in _setProp`
                )
            }
        }

        if (ts.isDeleteExpression(node) && isThisPropsElementAccess(node.expression)) {
            const enclosingMethodName = getEnclosingClassMethodName(node)
            if (!enclosingMethodName || !allowedDirectMutationMethods.has(enclosingMethodName)) {
                issues.push(
                    `posthog-persistence.ts:${getLine(sourceFile, node)} direct this.props deletion must be contained in _deleteProp`
                )
            }
        }

        if (
            ts.isCallExpression(node) &&
            isPropertyAccessLike(node.expression) &&
            ts.isThis(node.expression.expression)
        ) {
            const methodName = node.expression.name.text
            if (methodName === '_setProp' || methodName === '_deleteProp') {
                const enclosingMethodName = getEnclosingClassMethodName(node)
                if (!enclosingMethodName || !allowedSinkCallerMethods.has(enclosingMethodName)) {
                    issues.push(
                        `posthog-persistence.ts:${getLine(sourceFile, node)} ${methodName}() is called from unexpected method ${enclosingMethodName ?? '<unknown>'}`
                    )
                }
            }
        }

        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return issues
}

describe('persistence key policy', () => {
    it('matches legacy exact-key event visibility from before the policy migration', () => {
        const extensionOwnedFeatureFlagKeys = new Set([
            constants.ENABLED_FEATURE_FLAGS,
            constants.PERSISTENCE_ACTIVE_FEATURE_FLAGS,
            constants.PERSISTENCE_FEATURE_FLAG_PAYLOADS,
            constants.PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
            constants.PERSISTENCE_OVERRIDE_FEATURE_FLAGS,
        ])
        const compatibilitySnapshot = Object.entries(PERSISTENCE_KEY_POLICY)
            .map(([key, policy]) => [
                key,
                extensionOwnedFeatureFlagKeys.has(key)
                    ? 'hidden'
                    : LEGACY_RESERVED_PERSISTENCE_KEYS.has(key)
                      ? 'hidden'
                      : 'event',
                policy.exposure,
            ])
            .filter(([, expectedExposure, actualExposure]) => expectedExposure !== actualExposure)

        expect(compatibilitySnapshot).toEqual([])
    })

    it('classifies replay trigger-group prefix keys as hidden', () => {
        expect(
            getPersistenceKeyPolicy(`${constants.SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX}abc123`)
        ).toMatchObject({
            exposure: 'hidden',
        })
        expect(
            getPersistenceKeyPolicy(`${constants.SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX}abc123`)
        ).toMatchObject({
            exposure: 'hidden',
        })
        expect(
            getPersistenceKeyPolicy(`${constants.SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX}abc123`)
        ).toMatchObject({ exposure: 'hidden' })
    })

    it('keeps direct persistence mutations behind the PostHogPersistence sink helpers', () => {
        expect(collectPostHogPersistenceMutationBoundaryIssues()).toEqual([])
    })

    it('classifies SDK-owned persistence keys and forbids raw literal keys at persistence write sites', () => {
        const exactPolicyKeys = new Set(Object.keys(PERSISTENCE_KEY_POLICY))
        const { identifiers, resolvedKeys, issues } = collectPersistenceKeyIdentifiers()

        expect(issues).toEqual([])

        for (const identifier of identifiers) {
            const value = constants[identifier as keyof typeof constants]

            expect(value).toBeDefined()

            if (identifier.endsWith('_PREFIX')) {
                expect(PERSISTENCE_KEY_PREFIXES.has(value as string)).toBe(true)
            } else {
                expect(exactPolicyKeys.has(value as string)).toBe(true)
            }
        }

        for (const key of resolvedKeys) {
            expect(getPersistenceKeyPolicy(key)).toBeDefined()
        }
    })

    it('checks direct and aliased KeyValueStore writes against the host persistence policy', () => {
        const analyze = (sourceText: string): ScanResult =>
            collectPersistenceKeyIdentifiers([
                {
                    filePath: path.join(REPOSITORY_ROOT, 'packages/browser-common/src/extensions/example.ts'),
                    sourceText,
                },
            ])
        const knownKey = analyze(`
            const EXTENSION_KEY = '${constants.AUTOCAPTURE_DISABLED_SERVER_SIDE}'
            client.kv.set(EXTENSION_KEY, true)
            const store = client.kv
            store.set(EXTENSION_KEY, true)
            const { kv: destructuredStore } = client
            destructuredStore.remove(EXTENSION_KEY)
        `)

        expect(knownKey.issues).toEqual([])
        expect([...knownKey.resolvedKeys]).toEqual([constants.AUTOCAPTURE_DISABLED_SERVER_SIDE])

        const batchedKeys = analyze(`
            const FIRST_KEY = '${constants.AUTOCAPTURE_DISABLED_SERVER_SIDE}'
            const SECOND_KEY = '${constants.HEATMAPS_ENABLED_SERVER_SIDE}'
            client.kv.set({ [FIRST_KEY]: true, [SECOND_KEY]: false })
            client.kv.remove([FIRST_KEY, SECOND_KEY])
        `)
        expect(batchedKeys.issues).toEqual([])
        expect([...batchedKeys.resolvedKeys]).toEqual(
            expect.arrayContaining([constants.AUTOCAPTURE_DISABLED_SERVER_SIDE, constants.HEATMAPS_ENABLED_SERVER_SIDE])
        )

        const unknownKey = analyze(`
            const EXTENSION_KEY = '$unclassified_extension_key'
            const store = client.kv
            store.set(EXTENSION_KEY, true)
        `)
        expect(unknownKey.issues).toEqual([
            expect.stringContaining(
                'set() on KeyValueStore uses "$unclassified_extension_key", which has no persistence key policy'
            ),
        ])

        const rawKey = analyze(`client.kv.set('$raw_extension_key', true)`)
        expect(rawKey.issues).toEqual([
            expect.stringContaining('set() on KeyValueStore must use constants instead of raw literal keys'),
        ])

        const dynamicPrefix = analyze(`
            const GROUP_PREFIX = '${constants.SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX}'
            function persist(groupId: string): void {
                client.kv.set(GROUP_PREFIX + groupId, true)
            }
        `)
        expect(dynamicPrefix.issues).toEqual([])

        const compositeExactKey = analyze(`
            const EXTENSION_KEY = '${constants.AUTOCAPTURE_DISABLED_SERVER_SIDE}'
            function persist(extensionId: string): void {
                client.kv.set(EXTENSION_KEY + extensionId, true)
            }
        `)
        expect(compositeExactKey.issues).toEqual([
            expect.stringContaining(
                'set() on KeyValueStore forms a dynamic key without a named, registered persistence key prefix'
            ),
        ])

        const classFieldAlias = analyze(`
            class Extension {
                private store = client.kv
                persist(): void {
                    const EXTENSION_KEY = '$unclassified_extension_key'
                    this.store.set(EXTENSION_KEY, true)
                }
            }
        `)
        expect(classFieldAlias.issues).toEqual([
            expect.stringContaining(
                'set() on KeyValueStore uses "$unclassified_extension_key", which has no persistence key policy'
            ),
        ])

        const shadowedKey = analyze(`
            const EXTENSION_KEY = '${constants.AUTOCAPTURE_DISABLED_SERVER_SIDE}'
            function persist(EXTENSION_KEY: string): void {
                client.kv.set(EXTENSION_KEY, true)
            }
        `)
        expect(shadowedKey.issues).toEqual([
            expect.stringContaining('set() on KeyValueStore must resolve to a persistence key constant'),
        ])

        const scopedKeys = analyze(`
            function persistKnown(): void {
                const EXTENSION_KEY = '${constants.AUTOCAPTURE_DISABLED_SERVER_SIDE}'
                client.kv.set(EXTENSION_KEY, true)
            }
            function persistUnknown(): void {
                const EXTENSION_KEY = '$unclassified_extension_key'
                client.kv.set(EXTENSION_KEY, true)
            }
        `)
        expect(scopedKeys.issues).toEqual([
            expect.stringContaining(
                'set() on KeyValueStore uses "$unclassified_extension_key", which has no persistence key policy'
            ),
        ])

        const conditionalKey = analyze(`
            const EXTENSION_KEY = '${constants.AUTOCAPTURE_DISABLED_SERVER_SIDE}'
            function persist(useKnown: boolean, runtimeKey: string): void {
                client.kv.set(useKnown ? EXTENSION_KEY : runtimeKey, true)
            }
        `)
        expect(conditionalKey.issues).toEqual([
            expect.stringContaining(
                'set() on KeyValueStore must resolve to a persistence key constant or registered prefix in every branch'
            ),
        ])

        const uncheckedRemoveWrapper = analyze(`
            class Extension {
                private _remove(key: string): void {
                    client.kv.remove(key)
                }
            }
        `)
        expect(uncheckedRemoveWrapper.issues).toEqual([
            expect.stringContaining(
                'remove() on KeyValueStore must resolve to a persistence key constant or registered prefix in every branch'
            ),
        ])

        const featureFlagsWrapper = analyze(`
            class PostHogFeatureFlags {
                private _remove(keys: string | readonly string[]): void {
                    client.kv.remove(keys)
                }
                clearKnownKeys(): void {
                    const FIRST_KEY = '${constants.AUTOCAPTURE_DISABLED_SERVER_SIDE}'
                    const SECOND_KEY = '${constants.HEATMAPS_ENABLED_SERVER_SIDE}'
                    this._remove([FIRST_KEY, SECOND_KEY])
                }
                clearUnknownKey(): void {
                    const EXTENSION_KEY = '$unclassified_extension_key'
                    this._remove(EXTENSION_KEY)
                }
            }
        `)
        expect(featureFlagsWrapper.issues).toEqual([
            expect.stringContaining(
                '_remove() in PostHogFeatureFlags uses "$unclassified_extension_key", which has no persistence key policy'
            ),
        ])
        expect([...featureFlagsWrapper.resolvedKeys]).toEqual(
            expect.arrayContaining([constants.AUTOCAPTURE_DISABLED_SERVER_SIDE, constants.HEATMAPS_ENABLED_SERVER_SIDE])
        )
    })

    it('analyzes callers instead of a KeyValueStore implementation forwarding its runtime key', () => {
        const persistencePath = path.join(REPOSITORY_ROOT, 'packages/browser-common/src/persistence.ts')
        const browserClientPath = path.join(REPOSITORY_ROOT, 'packages/browser/src/extensions/browser-client.ts')
        const analyze = (sourceText: string): ScanResult =>
            collectPersistenceKeyIdentifiers([
                {
                    filePath: persistencePath,
                    sourceText: `
                        export interface KeyValueStore {
                            set(key: string, value: unknown): void
                            remove(key: string): void
                        }
                    `,
                },
                { filePath: browserClientPath, sourceText },
            ])
        const keyValueStore = analyze(`
            import type { KeyValueStore as BrowserKeyValueStore } from '../../../browser-common/src/persistence'
            class Store implements BrowserKeyValueStore {
                set(storageKey: string, value: unknown): void {
                    persistence.set_property(storageKey, value)
                }
                remove(storageKey: string): void {
                    persistence.unregister(storageKey)
                }
            }
        `)
        expect(keyValueStore.issues).toEqual([])

        const unrelatedWrapper = analyze(`
            interface KeyValueStore {
                set(key: string, value: unknown): void
            }
            class Store implements KeyValueStore {
                set(storageKey: string, value: unknown): void {
                    persistence.set_property(storageKey, value)
                }
            }
        `)
        expect(unrelatedWrapper.issues).toEqual([
            expect.stringContaining('set_property() on persistence must resolve to a persistence key constant'),
        ])

        const shadowedForwardingKey = analyze(`
            import type { KeyValueStore as BrowserKeyValueStore } from '../../../browser-common/src/persistence'
            class Store implements BrowserKeyValueStore {
                set(storageKey: string, value: unknown): void {
                    persistence.set_property(storageKey, value)
                    const writeShadowedKey = (): void => {
                        const storageKey = '$raw_extension_key'
                        persistence.set_property(storageKey, value)
                    }
                    writeShadowedKey()
                }
                remove(storageKey: string): void {
                    persistence.unregister(storageKey)
                }
            }
        `)
        expect(shadowedForwardingKey.issues).toEqual([
            expect.stringContaining('set_property() on persistence must use constants instead of raw literal keys'),
        ])
    })

    describe('storageGroup', () => {
        const keysInGroup = (group: string): string[] =>
            Object.entries(PERSISTENCE_KEY_POLICY)
                .filter(([, policy]) => policy.storageGroup === group)
                .map(([key]) => key)
                .sort()

        it('tags exactly the atomic flag-config cluster as the flags group', () => {
            expect(keysInGroup('flags')).toEqual(
                [
                    constants.ENABLED_FEATURE_FLAGS,
                    constants.PERSISTENCE_ACTIVE_FEATURE_FLAGS,
                    constants.PERSISTENCE_FEATURE_FLAG_DETAILS,
                    constants.PERSISTENCE_FEATURE_FLAG_PAYLOADS,
                    constants.PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
                    constants.PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
                    constants.PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
                ].sort()
            )
        })

        it('tags $surveys and its freshness stamp as the surveys group', () => {
            expect(keysInGroup('surveys')).toEqual([constants.SURVEYS, constants.SURVEYS_LOADED_AT].sort())
        })

        it.each([
            ['$flag_call_reported (written on the read path)', constants.FLAG_CALL_REPORTED],
            ['$flag_call_reported_session_id', constants.FLAG_CALL_REPORTED_SESSION_ID],
            ['$feature_flag_errors', constants.PERSISTENCE_FEATURE_FLAG_ERRORS],
            ['$override_feature_flags', constants.PERSISTENCE_OVERRIDE_FEATURE_FLAGS],
            ['$override_feature_flag_payloads', constants.PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS],
            ['$stored_person_properties', constants.STORED_PERSON_PROPERTIES_KEY],
            ['$stored_group_properties', constants.STORED_GROUP_PROPERTIES_KEY],
            ['$early_access_features', constants.PERSISTENCE_EARLY_ACCESS_FEATURES],
            ['$surveys_activated', constants.SURVEYS_ACTIVATED],
        ])('keeps %s in the main blob (no storageGroup)', (_label, key) => {
            expect(getPersistenceKeyPolicy(key)?.storageGroup).toBeUndefined()
        })

        it('only ever uses declared group names', () => {
            const groups = new Set<string>(PERSISTENCE_STORAGE_GROUPS)
            for (const policy of Object.values(PERSISTENCE_KEY_POLICY)) {
                if (policy.storageGroup) {
                    expect(groups.has(policy.storageGroup)).toBe(true)
                }
            }
        })
    })
})
