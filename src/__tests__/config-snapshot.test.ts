import ts from 'typescript'

function extractTypeInfo(filePath: string, typeName: string): string {
    const program = ts.createProgram([filePath], {})
    const checker = program.getTypeChecker()
    const sourceFile = program.getSourceFile(filePath)

    if (!sourceFile) {
        throw new Error(`File not found: ${filePath}`)
    }

    function getTypeString(type: ts.Type): string {
        return checker.typeToString(type)
    }

    function processType(type: ts.Type): any {
        if (type.isUnion() || type.isIntersection()) {
            return type.types.map(getTypeString)
        } else if (type.isClassOrInterface()) {
            const result: Record<string, any> = {}
            type.getProperties().forEach((symbol) => {
                const propType = checker.getTypeOfSymbol(symbol)
                result[symbol.getName()] = processType(propType)
            })
            return result
        } else if (type.symbol && type.symbol.valueDeclaration) {
            return getTypeString(type)
        }
        return getTypeString(type)
    }

    let result: Record<string, any> = {}

    ts.forEachChild(sourceFile, (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
            const type = checker.getTypeAtLocation(node)
            result = processType(type)
        }
    })

    return JSON.stringify(result, null, 2)
}

describe('config snapshot', () => {
    it('for PostHogConfig', () => {
        expect(extractTypeInfo(path.resolve(__dirname, '../types.ts'), 'PostHogConfig')).toMatchSnapshot()
    })
    it('for AutocaptureConfig', () => {
        expect(extractTypeInfo('src/types.ts', 'AutocaptureConfig')).toMatchSnapshot()
    })
    it('for SessionRecordingOptions', () => {
        expect(extractTypeInfo('src/types.ts', 'SessionRecordingOptions')).toMatchSnapshot()
    })
})
