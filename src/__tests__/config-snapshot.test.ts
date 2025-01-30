import ts from 'typescript'
import path from 'path'

type ProcessedType = string | Record<string, string | string[] | Record<string, any> | any[]> | ProcessedType[]
function extractTypeInfo(filePath: string, typeName: string): string {
    const program = ts.createProgram([filePath], { noImgplicitAny: true, strictNullChecks: true })
    const checker = program.getTypeChecker()
    const sourceFile = program.getSourceFile(filePath)

    if (!sourceFile) {
        throw new Error(`File not found: ${filePath}`)
    }

    function getTypeString(type: ts.Type): string {
        return checker.typeToString(type)
    }

    function processType(type: ts.Type): ProcessedType {
        // Early detect RegExp type and return its string representation
        // No need to recursively resolve it
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

    let result: ProcessedType = {}

    ts.forEachChild(sourceFile, (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
            const type = checker.getTypeAtLocation(node)
            result = processType(type)
        }
    })

    return JSON.stringify(result, null, 2)
}

// This guarantees that the config types are stable and won't change
// or that, at least, we won't ever remove any options from the config
// and/or change the types of existing options.
describe('config snapshot', () => {
    it('for PostHogConfig', () => {
        const typeInfo = extractTypeInfo(path.resolve(__dirname, '../types.ts'), 'PostHogConfig')
        expect(typeInfo).toMatchSnapshot()
    })
})
