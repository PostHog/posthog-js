const { ReleaseTag, ApiItemKind } = require('@microsoft/api-extractor-model');

// Import generic utilities
const genericUtils = require('./utils');

function getDocComment(apiItem: any) {
  if (!apiItem.tsdocComment?.summarySection) {
    return 'No description available';
  }
  return genericUtils.renderDocNodeToText(apiItem.tsdocComment.summarySection);
}

function getParamDescription(apiMethod: any, paramName: string) {
  const paramBlock = apiMethod.tsdocComment?.params?.tryGetBlockByName(paramName);
  return paramBlock?.content ? genericUtils.renderDocNodeToText(paramBlock.content) : 'No description available';
}

function getRemarks(apiItem: any) {
  return apiItem.tsdocComment?.remarksBlock ? 
    genericUtils.renderDocNodeToText(apiItem.tsdocComment.remarksBlock.content) : null;
}

function extractCategoryTags(apiMethod: any): string {
  const inlineTags = extractInlineTags(apiMethod.tsdocComment);
  const category = inlineTags.find(tag => tag.tagName === '@label');
  return category?.tagContent || '';
}

function extractInlineTags(docNode: any): any[] {
  if (!docNode) return [];
  
  const inlineTags: any[] = [];
  function traverse(node: any): void {
    if (!node) return;
    if (node.kind === 'LinkTag' || node.kind === 'InlineTag') {
      inlineTags.push(node);
    }
    node.getChildNodes?.()?.forEach(traverse);
  }
  
  traverse(docNode);
  return inlineTags;
}

function extractExampleTags(apiMethod: any) {
  const customBlocks = apiMethod.tsdocComment?._customBlocks || [];
  const examples = customBlocks
    .filter((block: any) => block.blockTag?.tagName === '@example')
    .map((block: any) => {
      const rawContent = genericUtils.processCodeNodes(block.content?.nodes);
      const { title } = genericUtils.extractFirstComment(rawContent);
      return {
        id: title.toLowerCase().replace(/ /g, '_'),
        name: title,
        code: rawContent,
      };
    });

  return examples.length > 0 ? examples : [templateExample(apiMethod)];
}

function templateExample(apiMethod: any) {
  const methodName = apiMethod.name;
  const paramList = (apiMethod.params || []).map((p: any) => `<${p.name}>`).join(', ');
  return {
    id: methodName.toLowerCase().replace(/ /g, '_'),
    name: `Generated example for ${methodName}`,
    code: `// Generated example for ${methodName}\nposthog.${methodName}(${paramList});`
  };
}

function getMethodReleaseTag(apiMethod: any): string {
  const tagMap = {
    [ReleaseTag.Internal]: 'internal',
    [ReleaseTag.Alpha]: 'alpha',
    [ReleaseTag.Beta]: 'beta',
    [ReleaseTag.Public]: 'public'
  };
  return tagMap[apiMethod.releaseTag] || 'public';
}

function isMethodDeprecated(apiMethod: any): boolean {
  return apiMethod.tsdocComment?.deprecatedBlock !== undefined;
}

interface TypeDefinition {
    name: string;
    id: string;
    params?: Array<{ name: string; type: string; description: string }>;
    path?: string;
    example?: string;
}

interface TypeToken {
    kind: string;
    text: string;
    canonicalReference?: any;
}

function resolveTypeDefinitions(apiPackage: any) {
    const allMembers = getAllTypeMembers(apiPackage);
    const typeDefinitions = allMembers.map((member: any) => createInitialTypeDef(member, apiPackage));
    
    const resolvedTypeDefinitions = resolveObjectTypes(
        resolveUnionTypes(typeDefinitions)
    );
    
    // Transform to final format expected by parser
    return resolvedTypeDefinitions.map((type: any) => ({
        id: type.id,
        name: type.name,
        properties: (type.params || []).map((param: any) => ({
            description: param.description,
            type: param.type,
            name: param.name,
        })),
        ...(type.path ? { path: type.path } : {}),
        ...(type.example ? { example: type.example } : {}),
        // Only include detailedType if we haven't resolved the complex type to properties
        ...(type.detailedType && (!type.params || type.params.length === 0) && !type.example ? { 
            detailedType: type.detailedType 
        } : {})
    }));
}

// Extract all type members from API package
function getAllTypeMembers(apiPackage: any) {
    const typeKinds = [ApiItemKind.TypeAlias, ApiItemKind.Interface, ApiItemKind.Enum];
    return apiPackage.entryPoints
        .flatMap((entryPoint: any) => entryPoint.members)
        .filter((member: any) => typeKinds.includes(member.kind));
}

// Create initial type definition
function createInitialTypeDef(member: any, apiPackage: any): TypeDefinition {
    const typeDef: TypeDefinition = {
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

// Process enum members
function processEnumMember(member: any, typeDef: TypeDefinition) {
    typeDef.params = member.members
        .filter((enumMember: any) => enumMember.kind === ApiItemKind.EnumMember)
        .map((enumMember: any) => ({
            name: enumMember.name,
            type: enumMember.initializerExcerpt?.text || `"${enumMember.name}"`,
            description: getDocComment(enumMember)
        }));
}

// Process interface members
function processInterfaceMember(member: any, typeDef: TypeDefinition) {
    typeDef.params = member.members
        .filter((prop: any) => prop.kind === ApiItemKind.PropertySignature)
        .map((prop: any) => ({
            name: prop.name,
            type: prop.propertyTypeExcerpt?.text || 'any',
            description: getDocComment(prop)
        }));
}

// Process type alias members
function processTypeAliasMember(member: any, typeDef: TypeDefinition, apiPackage: any) {
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
        (typeDef as any)._needsResolution = { member, detailedType };
    } else {
        (typeDef as any).detailedType = detailedType;
    }
}

// Extract detailed type information
function extractDetailedTypeInfo(member: any) {
    if (!member.excerptTokens) return null;

    const tokens = member.excerptTokens.slice(
        member.typeTokenRange?.startIndex || 1, 
        member.typeTokenRange?.endIndex || member.excerptTokens.length - 1
    );
    const signature = tokens.map((token: any) => token.text).join('').trim();
    const isComplex = /[|&<]|typeof |keyof /.test(signature);
    
    return { signature, tokens, isComplex };
}

// Extract literal values from type tokens
function extractLiteralValues(member: any, apiPackage: any) {
    if (!member.excerptTokens) return [];

    const tokens = getTypeTokens(member);
    const literalValues: Array<{ name: string; type: string; description: string }> = [];

    tokens.forEach(token => {
        // Extract string literals
        const stringLiterals = extractStringLiterals(token.text);
        literalValues.push(...stringLiterals);

        // Extract from referenced types
        if (token.kind === 'Reference' && token.canonicalReference) {
            const referencedValues = extractFromReferencedType(token.canonicalReference, apiPackage);
            literalValues.push(...referencedValues);
        }
    });

    return literalValues;
}

// Helper to get type tokens
function getTypeTokens(member: any): TypeToken[] {
    return member.excerptTokens.slice(
        member.typeTokenRange?.startIndex || 1,
        member.typeTokenRange?.endIndex || member.excerptTokens.length - 1
    );
}

// Extract string literals from text
function extractStringLiterals(text: string) {
    const patterns = [/'([^']+)'/g, /"([^"]+)"/g];
    const literals: Array<{ name: string; type: string; description: string }> = [];
    
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const value = match[1];
            literals.push({
                name: value,
                type: `"${value}"`,
                description: `String literal value: ${value}`
            });
        }
    });
    
    return literals;
}

// Extract values from referenced types
function extractFromReferencedType(canonicalReference: any, apiPackage: any) {
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
function findTypeByCanonicalReference(apiPackage: any, canonicalReference: any) {
    const typeName = canonicalReference.toString().split('!')[1];
    if (!typeName) return null;

    return apiPackage.entryPoints
        .flatMap((entryPoint: any) => entryPoint.members)
        .find((member: any) => member.name === typeName);
}

// Extract from variable (arrays)
function extractFromVariable(referencedType: any) {
    const varContent = referencedType.excerptTokens?.[1]?.text || '';
    const arrayMatch = varContent.match(/readonly\s*\[([\s\S]*?)\]/);
    if (!arrayMatch) return [];

    const stringMatches = arrayMatch[1].match(/"([^"]+)"/g) || [];
    return stringMatches.map((match: string) => {
        const value = match.replace(/"/g, '');
        return {
            name: value,
            type: `"${value}"`,
            description: `String literal value: ${value}`
        };
    });
}

// Extract from enum
function extractFromEnum(referencedType: any) {
    return referencedType.members
        .filter((enumMember: any) => enumMember.kind === ApiItemKind.EnumMember)
        .map((enumMember: any) => ({
            name: enumMember.name,
            type: enumMember.initializerExcerpt?.text || `"${enumMember.name}"`,
            description: getDocComment(enumMember) || `Enum value: ${enumMember.name}`
        }));
}

function resolveUnionTypes(typeDefinitions: TypeDefinition[]): TypeDefinition[] {
    return typeDefinitions.map(typeDef => {
        const resolution = (typeDef as any)._needsResolution;
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
        const { _needsResolution, detailedType, ...cleanTypeDef } = newTypeDef as any;
        return cleanTypeDef;
    });
}

// Gather values from already processed types
function gatherValuesFromReferencedTypes(member: any, typeDefinitions: TypeDefinition[]) {
    const tokens = getTypeTokens(member);
    const gatheredValues: Array<{ name: string; type: string; description: string }> = [];

    tokens.forEach(token => {
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
function generateTypeExample(signature: string): string {
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

// Resolve object types (third pass)
function resolveObjectTypes(typeDefinitions: TypeDefinition[]): TypeDefinition[] {
    return typeDefinitions.map(typeDef => {
        const detailedType = (typeDef as any).detailedType;
        if (!detailedType || typeDef.params?.length || typeDef.example) {
            return typeDef;
        }

        const signature = detailedType.signature;
        const newTypeDef = { ...typeDef };

        if (genericUtils.isSimpleObjectType(signature)) {
            const properties = genericUtils.parseObjectTypeSignature(signature);
            if (properties.length > 0) {
                newTypeDef.params = properties;
                delete (newTypeDef as any).detailedType;
            } else {
                newTypeDef.example = signature;
                newTypeDef.params = [];
                delete (newTypeDef as any).detailedType;
            }
        } else if (detailedType.isComplex) {
            newTypeDef.example = signature;
            newTypeDef.params = [];
            delete (newTypeDef as any).detailedType;
        }

        return newTypeDef;
    });
}



// Keep CommonJS export for backward compatibility
module.exports = {
  getDocComment,
  getParamDescription,
  getRemarks,
  extractCategoryTags,
  extractInlineTags,
  extractExampleTags,
  templateExample,
  getMethodReleaseTag,
  isMethodDeprecated,
  resolveTypeDefinitions,
}; 