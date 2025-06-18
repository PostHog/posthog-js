const { TSDocConfiguration, TSDocParser } = require('@microsoft/tsdoc');
const { ApiDocumentedItem, ReleaseTag } = require('@microsoft/api-extractor-model');

function getDocComment(apiItem: any) {
  if (!apiItem.tsdocComment) {
    return 'No description available';
  }

  // Get the summary section
  const summarySection = apiItem.tsdocComment.summarySection;
  if (summarySection) {
    return renderDocNodeToText(summarySection);
  }

  return 'No description available';
}

function getParamDescription(apiMethod: any, paramName: string) {
  if (!apiMethod.tsdocComment || !apiMethod.tsdocComment.params) {
    return 'No description available';
  }

  // Look for @param tags
  const paramBlocks = apiMethod.tsdocComment.params;
  const paramBlock = paramBlocks.tryGetBlockByName(paramName);

  if (paramBlock && paramBlock.content) {
    return renderDocNodeToText(paramBlock.content);
  }

  return 'No description available';
}

// Combined renderDocNodeToText implementation
function renderDocNodeToText(docNode: any) {
  if (!docNode || !docNode.nodes) return '';

  let result = '';
  for (const node of docNode.nodes) {
    switch (node.kind) {
      case 'PlainText':
        // Prefer .text || '' for safety
        result += node.text || '';
        break;
      case 'CodeSpan':
        result += `\`${node.code || ''}\``;
        break;
      case 'FencedCodeBlock':
        result += `\`\`\`${node.language || ''}\n${node.code || ''}\n\`\`\``;
        break;
      case 'Paragraph':
        // Recursively render and add a newline
        result += renderDocNodeToText(node) + '\n';
        break;
      case 'SoftBreak':
        // Use space for soft break (as in the more complete version)
        result += ' ';
        break;
      default:
        if (node.nodes) {
          result += renderDocNodeToText(node);
        }
        break;
    }
  }
  return result.trim();
}

function extractFirstComment(content: string): { title: string } {
  const lines = content.trim().split('\n');

  let title = '';
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    const commentMatch = firstLine.match(/^(\s*\/\/\s*|\s*#\s*)(.+)$/);
    if (commentMatch) {
      title = commentMatch[2].trim();
    }
  }
  return { title };
}


function extractInlineTags(docNode: any): any[] {
  const inlineTags: any[] = [];
  
  // Recursively traverse the document tree
  function traverse(node: any): void {
    if (!node) return;
    // Check for inline tags
    if (node.kind === 'LinkTag') {
      const linkTag = node;
      inlineTags.push(linkTag);
    } else if (node.kind === 'InlineTag') {
      const inlineTag = node;
      inlineTags.push(inlineTag);
    }
    
    // Traverse child nodes
    for (const child of node.getChildNodes()) {
      traverse(child);
    }
  }
  
  traverse(docNode);
  return inlineTags;
}

function extractCategoryTags(apiMethod: any): string {
  const inlineTags = extractInlineTags(apiMethod.tsdocComment);
  const categories: any[] = [];
  for (const tag of inlineTags) {
    if (tag.tagName === '@label') {
      categories.push(tag.tagContent);
    }
  }
  return categories[0] || '';
}

function extractExampleTags(apiMethod: any) {
  if (!apiMethod.tsdocComment || !apiMethod.tsdocComment._customBlocks) {
    return [];
  }
  const examples: any[] = [];
  for (const block of apiMethod.tsdocComment._customBlocks) {
    if (block.blockTag && block.blockTag.tagName === '@example') {
      const example = {
        id: '',
        name: '',
        code: '',
      };
      if (block.content && block.content.nodes) {
        const rawContent = processCodeNodes(block.content.nodes);
        const { title } = extractFirstComment(rawContent);
        example.id = title.toLowerCase().replace(/ /g, '_');
        example.name = title;
        example.code = rawContent;
      }
      examples.push(example);
    }
  }
  if (examples.length === 0) {
    return [templateExample(apiMethod)];
  }
  return examples;
}

function processCodeNodes(nodes: any) {
  let result = '';

  if (!nodes) {
    return '';
  }

  for (const node of nodes) {
    switch (node.kind) {
      case 'PlainText':
        result += node.text;
        break;
      case 'Paragraph':
        result += processCodeNodes(node.nodes);
        if (result && !result.endsWith('\n')) {
          result += '\n';
        }
        break;
      case 'SoftBreak':
        result += '\n';
        break;
      case 'FencedCode':
        result += `${node.code || ''}`;
        break;
      case 'ErrorText':
        result += node.text || '';
        break;
      default:
        // Handle other node types if needed
        if (node.nodes) {
          result += processCodeNodes(node.nodes);
        }
        break;
    }
  }
  return result;
}

function getRemarks(apiItem: any) {
  if (!apiItem.tsdocComment || !apiItem.tsdocComment.remarksBlock) {
    return null;
  }

  return renderDocNodeToText(apiItem.tsdocComment.remarksBlock.content);
}

// template example for a method when not using @example
function templateExample(apiMethod: any) {
  const methodName = apiMethod.name;
  const params = apiMethod.params || [];

  const paramList = params.map((p: any) => `<${p.name}>`).join(', ');

  const example = `
// Generated example for ${methodName}
posthog.${methodName}(${paramList});
    `;

  return {
    id: methodName.toLowerCase().replace(/ /g, '_'),
    name: `Generated example for ${methodName}`,
    code: example
  };
}

function getMethodReleaseTag(apiMethod: any): string {
  switch (apiMethod.releaseTag) {
    case ReleaseTag.Internal:
      return 'internal';
    case ReleaseTag.Alpha:
      return 'alpha';
    case ReleaseTag.Beta:
      return 'beta';
    case ReleaseTag.Public:
      return 'public';
    default:
      return 'public'; // fallback
  }
}

function isMethodDeprecated(apiMethod: any): boolean {
  return apiMethod.tsdocComment?.deprecatedBlock !== undefined;
}

module.exports = {
  getDocComment,
  getParamDescription,
  extractExampleTags,
  getRemarks,
  extractCategoryTags,
  getMethodReleaseTag,
  isMethodDeprecated
};
