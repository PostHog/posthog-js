const path = require('path');
const ts = require('typescript');

// Resolves exported type aliases against the same .d.ts entry point that api-extractor
// analyzes, using the TypeScript checker so that Omit<>, intersections and cross-package
// references flatten to their effective members.
function createTypeResolver(dtsEntryPath) {
    const entryPath = path.resolve(dtsEntryPath);
    const program = ts.createProgram([entryPath], {
        skipLibCheck: true,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        types: [],
    });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(entryPath);
    if (!sourceFile) {
        throw new Error(`type-resolver: could not load entry point ${entryPath}`);
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
        throw new Error(`type-resolver: no exports found in ${entryPath}`);
    }

    const aliasDeclarations = new Map();
    for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
        const symbol =
            exportSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;
        const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
        if (declaration) {
            aliasDeclarations.set(exportSymbol.name, declaration);
        }
    }

    // api-extractor also documents aliases that are referenced by the public API without
    // being exported from the entry point, so index every top-level alias in the program.
    // Entry-point exports win; a name declared differently in several files stays unresolved.
    const exportedNames = new Set(aliasDeclarations.keys());
    const ambiguousNames = new Set();
    for (const file of program.getSourceFiles()) {
        if (program.isSourceFileDefaultLibrary(file)) continue;
        for (const statement of file.statements) {
            if (!ts.isTypeAliasDeclaration(statement)) continue;
            const name = statement.name.text;
            if (exportedNames.has(name)) continue;
            const existing = aliasDeclarations.get(name);
            if (existing && existing !== statement) {
                ambiguousNames.add(name);
                continue;
            }
            aliasDeclarations.set(name, statement);
        }
    }

    return {
        resolveTypeAlias: (name) =>
            ambiguousNames.has(name) ? null : classifyAlias(checker, aliasDeclarations.get(name)),
    };
}

// Classifies a type alias declaration as one of:
//   { kind: 'function' }                       - callable with no members
//   { kind: 'object', properties: [...] }      - object shape with named members
//   { kind: 'signature' }                      - render the raw signature (tuples, index-only objects)
//   { kind: 'union' }                          - any union
//   { kind: 'other' }                          - primitives and everything else
// Returns null for unknown names and generic aliases, which keeps them on the
// token-based fallback path.
function classifyAlias(checker, declaration) {
    if (!declaration || declaration.typeParameters?.length) {
        return null;
    }

    const type = checker.getTypeFromTypeNode(declaration.type);
    if (type.isUnion()) {
        return { kind: 'union' };
    }
    if (checker.isTupleType(type) || checker.isArrayType(type)) {
        return { kind: 'signature' };
    }
    if (!(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) {
        return { kind: 'other' };
    }

    const properties = type.getProperties().filter((prop) => !(prop.flags & ts.SymbolFlags.Method));
    if (type.getCallSignatures().length > 0) {
        // a callable type with members would lose its call signature as an object,
        // so publish the full raw signature instead
        return properties.length === 0 ? { kind: 'function' } : { kind: 'signature' };
    }
    if (properties.length > 0) {
        return {
            kind: 'object',
            properties: properties.map((prop) => describeProperty(checker, prop, declaration)),
        };
    }
    if (checker.getIndexInfosOfType(type).length > 0) {
        return { kind: 'signature' };
    }
    return { kind: 'other' };
}

function describeProperty(checker, prop, location) {
    const propType = checker.getTypeOfSymbolAtLocation(prop, location);
    const description = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();

    // typeToString qualifies symbols not lexically visible at the alias declaration as
    // import("<absolute path>").Name — machine-specific and unfit for published output
    const typeText = checker
        .typeToString(propType, location, ts.TypeFormatFlags.NoTruncation)
        .replace(/import\("[^"]*"\)\./g, '');

    return {
        name: prop.getName(),
        type: typeText,
        description: description || undefined,
    };
}

module.exports = {
    createTypeResolver,
};
