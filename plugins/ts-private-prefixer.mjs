import ts from 'typescript'

const prefix = '_ಠ_ಠ_'

/**
 * Custom TypeScript transformer factory that adds prefixes to private properties and methods, and updates
 * all references within the class.
 */
export default function privatePrefixerTransformer(program) {
    return (context) => {
        const renamedSymbols = new Map()
        const typeChecker = program.getTypeChecker()

        const updatePropertyAccesses = (node) => {
            // Handle property accesses (this.property or ClassName.staticProperty)
            if (ts.isPropertyAccessExpression(node)) {
                const symbol = typeChecker.getSymbolAtLocation(node.name)
                if (symbol && renamedSymbols.has(symbol)) {
                    const newName = renamedSymbols.get(symbol)
                    return ts.factory.updatePropertyAccessExpression(
                        node,
                        node.expression,
                        ts.factory.createIdentifier(newName)
                    )
                }
            }
            // Handle bracket notation property access (this['property'] or ClassName['property'])
            else if (
                ts.isElementAccessExpression(node) &&
                node.argumentExpression.kind === ts.SyntaxKind.StringLiteral
            ) {
                const propName = node.argumentExpression.text
                for (const [symbol, newName] of renamedSymbols.entries()) {
                    if (symbol.escapedName === propName) {
                        return ts.factory.updateElementAccessExpression(
                            node,
                            node.expression,
                            ts.factory.createStringLiteral(newName)
                        )
                    }
                }
            }

            return ts.visitEachChild(node, updatePropertyAccesses, context)
        }

        const visit = (node) => {
            if (ts.isClassDeclaration(node)) {
                const processedMembers = []
                let needsReferenceUpdate = false

                // First pass: rename private properties and methods, avoid messing with static
                for (const member of node.members) {
                    // Skip renaming properties with initializers in the class body
                    if (ts.isPropertyDeclaration(member) && member.initializer) {
                        processedMembers.push(member)
                        continue
                    }

                    if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) {
                        let name

                        if (ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member)) {
                            name = member.name
                        }

                        if (name && ts.isIdentifier(name) && !name.text.startsWith(prefix)) {
                            const symbol = typeChecker.getSymbolAtLocation(name)
                            const newName = `${prefix}${name.text}`

                            if (symbol) {
                                renamedSymbols.set(symbol, newName)
                                needsReferenceUpdate = true
                            }

                            if (ts.isPropertyDeclaration(member)) {
                                const newMember = ts.factory.updatePropertyDeclaration(
                                    member,
                                    member.modifiers,
                                    ts.factory.createIdentifier(newName),
                                    member.questionToken,
                                    member.type,
                                    member.initializer
                                )
                                processedMembers.push(newMember)
                                continue
                            } else if (ts.isMethodDeclaration(member)) {
                                const newMember = ts.factory.updateMethodDeclaration(
                                    member,
                                    member.modifiers,
                                    member.asteriskToken,
                                    ts.factory.createIdentifier(newName),
                                    member.questionToken,
                                    member.typeParameters,
                                    member.parameters,
                                    member.type,
                                    member.body
                                )
                                processedMembers.push(newMember)
                                continue
                            }
                        }
                    }

                    processedMembers.push(member)
                }

                const updatedClass = ts.factory.updateClassDeclaration(
                    node,
                    node.modifiers,
                    node.name,
                    node.typeParameters,
                    node.heritageClauses,
                    processedMembers
                )

                // If we renamed anything, we need to update references
                if (needsReferenceUpdate) {
                    // Second pass: update references within method bodies
                    return ts.visitEachChild(updatedClass, updatePropertyAccesses, context)
                }

                return updatedClass
            }

            return ts.visitEachChild(node, visit, context)
        }

        return (sourceFile) => ts.visitNode(sourceFile, visit)
    }
}
