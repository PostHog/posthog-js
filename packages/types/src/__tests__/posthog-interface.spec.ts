import ts from 'typescript'
import path from 'path'

type ProcessedType = string | Record<string, string | string[] | Record<string, any> | any[]> | ProcessedType[]

function extractInterfaceMembers(filePath: string, typeName: string): Record<string, ProcessedType> {
    const program = ts.createProgram([filePath], { noImplicitAny: true, strictNullChecks: true })
    const checker = program.getTypeChecker()
    const sourceFile = program.getSourceFile(filePath)

    if (!sourceFile) {
        throw new Error(`File not found: ${filePath}`)
    }

    function getTypeString(type: ts.Type): string {
        return checker.typeToString(type)
    }

    function processType(type: ts.Type): ProcessedType {
        if (type.symbol?.name === 'RegExp') {
            return getTypeString(type)
        }

        if (type.isUnion() || type.isIntersection()) {
            return type.types.map(processType)
        }

        if (type.isClassOrInterface()) {
            const result: Record<string, ProcessedType> = {}
            type.getProperties().forEach((symbol) => {
                const propType = checker.getTypeOfSymbol(symbol)
                result[symbol.getName()] = processType(propType)
            })

            return result
        }

        return getTypeString(type)
    }

    let result: Record<string, ProcessedType> = {}

    ts.forEachChild(sourceFile, (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
            const type = checker.getTypeAtLocation(node)
            const processedResult = processType(type)
            // eslint-disable-next-line posthog-js/no-direct-array-check
            if (typeof processedResult === 'object' && !Array.isArray(processedResult)) {
                result = processedResult
            }
        }
    })

    return result
}

/**
 * This test ensures that the PostHog interface in @posthog/types stays in sync
 * with the actual implementation. When new public methods are added to the
 * PostHog class in posthog-js, this snapshot test will fail, reminding developers
 * to update the @posthog/types package.
 *
 * The snapshot captures all public methods and properties of the PostHog interface,
 * making it easy to review changes during code review.
 */
describe('PostHog interface', () => {
    describe('snapshot', () => {
        it('captures all public methods and properties', () => {
            const members = extractInterfaceMembers(path.resolve(__dirname, '../posthog.ts'), 'PostHog')
            expect(members).toMatchSnapshot()
        })

        it('has expected method signatures for critical methods', () => {
            const members = extractInterfaceMembers(path.resolve(__dirname, '../posthog.ts'), 'PostHog')

            // Verify getEarlyAccessFeatures has the stages parameter
            expect(members['getEarlyAccessFeatures']).toContain('stages')

            // Verify updateFlags exists
            expect(members['updateFlags']).toBeDefined()

            // Verify canRenderSurveyAsync exists
            expect(members['canRenderSurveyAsync']).toBeDefined()
        })
    })
})
