const { ApiItemKind } = require('@microsoft/api-extractor-model');
const utils = require('./utils');
const documentation = require('./documentation');

// TypeDefinition structure: { name, id, params?, path?, example? }
// TypeToken structure: { kind, text, canonicalReference? }

function resolveTypeDefinitions(apiPackage) {
    const allMembers = getAllTypeMembers(apiPackage);
    const typeDefinitions = allMembers.map((member) => createInitialTypeDef(member, apiPackage));
    
    const resolvedTypeDefinitions = resolveObjectTypes(
        resolveUnionTypes(typeDefinitions)
    );
    
    // Transform to final format expected by parser
    return resolvedTypeDefinitions.map((type) => {
        const result = {
            id: type.id,
            name: type.name,
            properties: (type.params || []).map(({ description, type: paramType, name }) => ({
                description, type: paramType, name
            }))
        };
        
        if (type.path) result.path = type.path;
        if (type.example) result.example = type.example;
        if (type.detailedType && !type.params?.length && !type.example) {
            result.detailedType = type.detailedType;
        }
        
        return result;
    });
}

// Extract all type members from API package
function getAllTypeMembers(apiPackage) {
    const typeKinds = [ApiItemKind.TypeAlias, ApiItemKind.Interface, ApiItemKind.Enum];
    return apiPackage.entryPoints
        .flatMap((entryPoint) => entryPoint.members)
        .filter((member) => typeKinds.includes(member.kind));
}

// Create initial type definition
function createInitialTypeDef(member, apiPackage) {
    const typeDef = {
        name: member.name,
        id: member.name,
        params: [],
        path: member.fileUrlPath || undefined
    };

    const processor = {
        [ApiItemKind.Enum]: () => processEnumMember(member, typeDef),
        [ApiItemKind.Interface]: () => processInterfaceMember(member, typeDef),
        [ApiItemKind.TypeAlias]: () => processTypeAliasMember(member, typeDef, apiPackage)
    }[member.kind];

    processor?.();
    return typeDef;
}

// Create member descriptor for enum/interface items
const createMemberDescriptor = (member, defaultType) => ({
    name: member.name,
    type: member.initializerExcerpt?.text || member.propertyTypeExcerpt?.text || defaultType,
    description: documentation.getDocComment(member)
});

// Process enum members
function processEnumMember(member, typeDef) {
    typeDef.params = member.members
        .filter((enumMember) => enumMember.kind === ApiItemKind.EnumMember)
        .map((enumMember) => createMemberDescriptor(enumMember, `"${enumMember.name}"`));
}

// Process interface members
function processInterfaceMember(member, typeDef) {
    typeDef.params = member.members
        .filter((prop) => prop.kind === ApiItemKind.PropertySignature)
        .map((prop) => createMemberDescriptor(prop, 'any'));
}

// Process type alias members
function processTypeAliasMember(member, typeDef, apiPackage) {
    const detailedType = extractDetailedTypeInfo(member);
    if (!detailedType) return;

    const literalValues = extractLiteralValues(member, apiPackage);
    if (literalValues.length > 0) {
        // For string literal unions, create an example instead of properties
        const literalTypes = literalValues.map(v => v.type).join(' | ');
        typeDef.example = literalTypes;
        typeDef.params = [];
    } else if (detailedType.isComplex) {
        // Mark for later resolution
        typeDef._needsResolution = { member, detailedType };
    } else {
        typeDef.detailedType = detailedType;
    }
}

// Extract detailed type information and tokens
function extractDetailedTypeInfo(member) {
    if (!member.excerptTokens) return null;

    const tokens = member.excerptTokens.slice(
        member.typeTokenRange?.startIndex || 1, 
        member.typeTokenRange?.endIndex || member.excerptTokens.length - 1
    );
    const signature = tokens.map((token) => token.text).join('').trim();
    const isComplex = /[|&<]|typeof |keyof /.test(signature);
    
    return { signature, tokens, isComplex };
}

// Extract literal values from type tokens
function extractLiteralValues(member, apiPackage) {
    const typeInfo = extractDetailedTypeInfo(member);
    if (!typeInfo) return [];

    const literalValues = [];
    typeInfo.tokens.forEach(token => {
        literalValues.push(...extractStringLiterals(token.text));
        
        if (token.kind === 'Reference' && token.canonicalReference) {
            const referencedValues = extractFromReferencedType(token.canonicalReference, apiPackage);
            literalValues.push(...referencedValues);
        }
    });

    return literalValues;
}

// Extract string literals from text
function extractStringLiterals(text) {
    const patterns = [/'([^']+)'/g, /"([^"]+)"/g];
    const literals = [];
    
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const value = match[1];
            literals.push(utils.createStringLiteral(value));
        }
    });
    
    return literals;
}

// Extract values from referenced types
function extractFromReferencedType(canonicalReference, apiPackage) {
    const referencedType = findTypeByCanonicalReference(apiPackage, canonicalReference);
    if (!referencedType) return [];

    const extractors = {
        [ApiItemKind.Variable]: () => extractFromVariable(referencedType),
        [ApiItemKind.TypeAlias]: () => extractLiteralValues(referencedType, apiPackage),
        [ApiItemKind.Enum]: () => extractFromEnum(referencedType)
    };

    return extractors[referencedType.kind]?.() || [];
}

// Find type by canonical reference
function findTypeByCanonicalReference(apiPackage, canonicalReference) {
    const typeName = canonicalReference.toString().split('!')[1];
    if (!typeName) return null;

    return apiPackage.entryPoints
        .flatMap((entryPoint) => entryPoint.members)
        .find((member) => member.name === typeName);
}

// Extract from variable (arrays)
function extractFromVariable(referencedType) {
    const varContent = referencedType.excerptTokens?.[1]?.text || '';
    const arrayMatch = varContent.match(/readonly\s*\[([\s\S]*?)\]/);
    if (!arrayMatch) return [];

    const stringMatches = arrayMatch[1].match(/"([^"]+)"/g) || [];
    return stringMatches.map((match) => {
        const value = match.replace(/"/g, '');
        return utils.createStringLiteral(value);
    });
}

// Extract from enum
function extractFromEnum(referencedType) {
    return referencedType.members
        .filter((enumMember) => enumMember.kind === ApiItemKind.EnumMember)
        .map((enumMember) => ({
            name: enumMember.name,
            type: enumMember.initializerExcerpt?.text || `"${enumMember.name}"`,
            description: documentation.getDocComment(enumMember) || `Enum value: ${enumMember.name}`
        }));
}

function resolveUnionTypes(typeDefinitions) {
    return typeDefinitions.map(typeDef => {
        const resolution = typeDef._needsResolution;
        if (!resolution) {
            return typeDef; // Return unchanged
        }

        const gatheredValues = gatherValuesFromReferencedTypes(resolution.member, typeDefinitions);
        
        // Create new object without mutation
        const newTypeDef = { ...typeDef };
        if (gatheredValues.length > 0) {
            newTypeDef.params = gatheredValues;
        } else {
            newTypeDef.example = generateTypeExample(resolution.detailedType.signature);
            newTypeDef.params = [];
        }

        // Remove internal properties from the new object
        const { _needsResolution, detailedType, ...cleanTypeDef } = newTypeDef;
        return cleanTypeDef;
    });
}

// Gather values from already processed types
function gatherValuesFromReferencedTypes(member, typeDefinitions) {
    const typeInfo = extractDetailedTypeInfo(member);
    if (!typeInfo) return [];

    const gatheredValues = [];
    typeInfo.tokens.forEach(token => {
        if (token.kind === 'Reference' && token.canonicalReference) {
            const typeName = token.canonicalReference.toString().split('!')[1];
            const foundType = typeDefinitions.find(t => t.name === typeName);
            
            if (foundType?.params) {
                const validParams = foundType.params.filter(param => param.name !== 'example');
                gatheredValues.push(...validParams);
            }
        }
    });

    return gatheredValues;
}

// Generate example for complex types
function generateTypeExample(signature) {
    if (/KnownEventName|KnownUnsafeEditableEvent/.test(signature)) {
        return '"$pageview" | "$identify" | "custom_event" | string';
    }
    if (signature.includes('string &')) {
        return 'string';
    }
    if (signature.includes('|')) {
        const parts = signature.split('|').map(p => p.trim()).slice(0, 3);
        return parts.length < 3 ? parts.join(' | ') : parts.concat('...').join(' | ');
    }
    return signature;
}

// Resolve object types
function resolveObjectTypes(typeDefinitions) {
    return typeDefinitions.map(typeDef => {
        const detailedType = typeDef.detailedType;
        if (!detailedType || typeDef.params?.length || typeDef.example) {
            return typeDef;
        }

        const signature = detailedType.signature;
        const newTypeDef = { ...typeDef };
        
        if (utils.isSimpleObjectType(signature)) {
            const properties = utils.parseObjectTypeSignature(signature);
            newTypeDef.params = properties.length > 0 ? properties : [];
            newTypeDef.example = properties.length === 0 ? signature : undefined;
        } else if (detailedType.isComplex) {
            newTypeDef.example = signature;
            newTypeDef.params = [];
        }
        
        delete newTypeDef.detailedType;
        return newTypeDef;
    });
}

module.exports = {
    resolveTypeDefinitions,
};