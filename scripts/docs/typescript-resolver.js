const ts = require('typescript');
const path = require('path');

/**
 * Uses the TypeScript compiler API to resolve all properties of a type,
 * including types that reference external packages (e.g., Omit<BaseConfig, 'key'> & { ... }).
 *
 * This is used as a fallback when API Extractor can't resolve cross-package type references.
 */
function resolveTypeProperties(projectDir, typeName, entryFile) {
    const configPath = path.join(projectDir, 'tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        return null;
    }

    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectDir);
    const program = ts.createProgram(config.fileNames, config.options);
    const checker = program.getTypeChecker();

    // Find the target type in the entry file or all source files
    const targetFiles = entryFile
        ? [program.getSourceFile(path.resolve(projectDir, entryFile))]
        : program.getSourceFiles();

    for (const sourceFile of targetFiles) {
        if (!sourceFile) continue;

        const result = findTypeInFile(sourceFile, typeName, checker);
        if (result) {
            return result;
        }
    }

    return null;
}

function findTypeInFile(sourceFile, typeName, checker) {
    let found = null;

    ts.forEachChild(sourceFile, (node) => {
        if (found) return;

        const isTarget =
            (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
            node.name.text === typeName;

        if (!isTarget) return;

        const type = checker.getTypeAtLocation(node);
        const properties = checker.getPropertiesOfType(type);
        const result = [];

        for (const prop of properties) {
            // Skip private/internal properties (double underscore prefix)
            if (prop.name.startsWith('__')) continue;

            const propType = checker.getTypeOfSymbol(prop);
            const typeString = checker.typeToString(propType);
            const jsDocComment = ts.displayPartsToString(prop.getDocumentationComment(checker));

            // Extract @default tag value
            const jsDocTags = prop.getJsDocTags(checker);
            const defaultTag = jsDocTags.find((tag) => tag.name === 'default');
            const defaultValue = defaultTag
                ? ts.displayPartsToString(defaultTag.text).trim()
                : undefined;

            // Build description including default value
            let description = jsDocComment || '';
            if (defaultValue) {
                description = description ? `${description}\n${defaultValue}` : defaultValue;
            }

            result.push({
                name: prop.name,
                type: typeString,
                description: description,
            });
        }

        found = result;
    });

    return found;
}

module.exports = {
    resolveTypeProperties,
};
