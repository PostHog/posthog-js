import ts from 'typescript'
import path from 'path'

/**
 * Extract method names from a TypeScript interface
 */
function extractInterfaceMethods(filePath: string, typeName: string): string[] {
    const program = ts.createProgram([filePath], {
        noImplicitAny: true,
        strictNullChecks: true,
    })
    const checker = program.getTypeChecker()
    const sourceFile = program.getSourceFile(filePath)

    if (!sourceFile) {
        throw new Error(`File not found: ${filePath}`)
    }

    const methods: string[] = []

    ts.forEachChild(sourceFile, (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
            const type = checker.getTypeAtLocation(node)
            type.getProperties().forEach((symbol) => {
                const propType = checker.getTypeOfSymbol(symbol)
                const typeString = checker.typeToString(propType)
                // Check if it's a method (function type)
                if (typeString.includes('=>') || typeString.includes('(')) {
                    methods.push(symbol.getName())
                }
            })
        }
    })

    return methods.sort()
}

/**
 * Extract public method names from a TypeScript class
 * Only includes methods marked with @public in JSDoc comments
 */
function extractClassPublicMethods(filePath: string, className: string): string[] {
    const program = ts.createProgram([filePath], {
        noImplicitAny: true,
        strictNullChecks: true,
        skipLibCheck: true,
    })
    const sourceFile = program.getSourceFile(filePath)

    if (!sourceFile) {
        throw new Error(`File not found: ${filePath}`)
    }

    const methods: string[] = []
    const fileText = sourceFile.getFullText()

    function visit(node: ts.Node) {
        if (ts.isClassDeclaration(node) && node.name?.text === className) {
            node.members.forEach((member) => {
                // Only include methods (not properties)
                if (ts.isMethodDeclaration(member) && member.name) {
                    const methodName = member.name.getText(sourceFile)

                    // Skip private methods (starting with _)
                    if (methodName.startsWith('_')) {
                        return
                    }

                    // Get the full text including leading comments
                    const fullStart = member.getFullStart()
                    const start = member.getStart(sourceFile)
                    const leadingComments = fileText.substring(fullStart, start)

                    // Check if @public appears in the leading JSDoc comment
                    const hasPublicTag = leadingComments.includes('@public')

                    if (hasPublicTag) {
                        methods.push(methodName)
                    }
                }
            })
        }
        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return methods.sort()
}

/**
 * This test ensures that the PostHog interface in @posthog/types stays in sync
 * with the actual PostHog class implementation in posthog-js.
 *
 * The PostHog class uses @public JSDoc tags to mark which methods are part of
 * the public API. This test verifies that all @public methods in the class
 * are also present in the interface.
 */
describe('PostHog interface', () => {
    it('should have all public methods from the PostHog class', () => {
        const interfacePath = path.resolve(__dirname, '../posthog.ts')
        const classPath = path.resolve(__dirname, '../../../browser/src/posthog-core.ts')

        const interfaceMethods = extractInterfaceMethods(interfacePath, 'PostHog')
        const classMethods = extractClassPublicMethods(classPath, 'PostHog')

        // Find methods in class but not in interface
        const missingFromInterface = classMethods.filter((m) => !interfaceMethods.includes(m))

        // Find methods in interface but not in class (might be deprecated or removed)
        const extraInInterface = interfaceMethods.filter((m) => !classMethods.includes(m))

        if (missingFromInterface.length > 0) {
            throw new Error(
                `The following public methods are in PostHog class but missing from @posthog/types PostHog interface:\n` +
                    `  - ${missingFromInterface.join('\n  - ')}\n\n` +
                    `Please add these methods to packages/types/src/posthog.ts`
            )
        }

        if (extraInInterface.length > 0) {
            // This is a warning, not an error - interface might have deprecated methods or properties
            // These could be intentionally in the interface but not marked @public in class
            // (e.g., deprecated methods that should still be typeable)
        }

        expect(missingFromInterface).toEqual([])
    })
})
