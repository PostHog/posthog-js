function reportPrivateMemberWithoutLeadingUnderscore(context, member, identifier) {
    if (member.accessibility !== 'private' || identifier.type !== 'Identifier' || identifier.name.startsWith('_')) {
        return
    }

    context.report({ node: identifier, messageId: 'leadingUnderscore', data: { name: identifier.name } })
}

function checkPrivateMember(context, node) {
    if (node.kind !== 'constructor') {
        reportPrivateMemberWithoutLeadingUnderscore(context, node, node.key)
    }
}

module.exports = {
    meta: {
        type: 'suggestion',
        messages: {
            leadingUnderscore: "Private member '{{name}}' must have a leading underscore.",
        },
    },
    create(context) {
        return {
            MethodDefinition(node) {
                checkPrivateMember(context, node)
            },
            PropertyDefinition(node) {
                checkPrivateMember(context, node)
            },
            TSAbstractMethodDefinition(node) {
                checkPrivateMember(context, node)
            },
            TSAbstractPropertyDefinition(node) {
                checkPrivateMember(context, node)
            },
            TSParameterProperty(node) {
                const parameter = node.parameter.type === 'AssignmentPattern' ? node.parameter.left : node.parameter
                reportPrivateMemberWithoutLeadingUnderscore(context, node, parameter)
            },
        }
    },
}
