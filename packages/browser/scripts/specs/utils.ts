const { TSDocConfiguration, TSDocParser } = require('@microsoft/tsdoc');

function renderDocNodeToText(docNode: any): string {
  if (!docNode?.nodes) return '';

  return docNode.nodes.map((node: any) => {
    switch (node.kind) {
      case 'PlainText': return node.text || '';
      case 'CodeSpan': return `\`${node.code || ''}\``;
      case 'FencedCodeBlock': return `\`\`\`${node.language || ''}\n${node.code || ''}\n\`\`\``;
      case 'Paragraph': return renderDocNodeToText(node) + '\n';
      case 'SoftBreak': return ' ';
      default: return node.nodes ? renderDocNodeToText(node) : '';
    }
  }).join('').trim();
}

function extractFirstComment(content: string): { title: string } {
  const firstLine = content.trim().split('\n')[0]?.trim() || '';
  const commentMatch = firstLine.match(/^(\s*\/\/\s*|\s*#\s*)(.+)$/);
  return { title: commentMatch?.[2]?.trim() || '' };
}

function processCodeNodes(nodes: any): string {
  if (!nodes) return '';
  
  return nodes.map((node: any) => {
    switch (node.kind) {
      case 'PlainText': return node.text;
      case 'Paragraph': return processCodeNodes(node.nodes) + (processCodeNodes(node.nodes) ? '\n' : '');
      case 'SoftBreak': return '\n';
      case 'FencedCode': return node.code || '';
      case 'ErrorText': return node.text || '';
      default: return node.nodes ? processCodeNodes(node.nodes) : '';
    }
  }).join('');
}

// Check if signature is a simple object type
function isSimpleObjectType(signature: string): boolean {
  const trimmed = signature.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}') && 
         !/[|&]|typeof |keyof /.test(trimmed);
}

// Parse object type signature into properties
function parseObjectTypeSignature(signature: string) {
  const cleaned = signature.replace(/^\s*{\s*|\s*}\s*$/g, '').trim();
  if (!cleaned) return [];

  return splitObjectProperties(cleaned)
    .map(parseProperty)
    .filter((prop): prop is { name: string; type: string; description: string } => prop !== null);
}

// Split object properties handling nested structures
function splitObjectProperties(content: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inAngleBrackets = 0;

  for (const char of content) {
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '<') inAngleBrackets++;
    else if (char === '>') inAngleBrackets--;
    else if (char === ';' && depth === 0 && inAngleBrackets === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  
  return parts;
}

// Parse individual property
function parseProperty(part: string) {
  const colonIndex = part.indexOf(':');
  if (colonIndex === -1) return null;

  let name = part.substring(0, colonIndex).trim();
  let type = part.substring(colonIndex + 1).trim();

  const isOptional = name.endsWith('?');
  if (isOptional) {
    name = name.slice(0, -1).trim();
    type = type.replace(/\s*\|\s*undefined$/, '');
  }

  return name && type ? {
    name,
    type: isOptional ? `${type} | undefined` : type,
    description: 'No description available'
  } : null;
}

module.exports = {
  renderDocNodeToText,
  extractFirstComment,
  processCodeNodes,
  parseObjectTypeSignature,
  isSimpleObjectType,
};
