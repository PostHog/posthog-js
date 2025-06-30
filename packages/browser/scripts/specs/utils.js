const { TSDocConfiguration, TSDocParser } = require('@microsoft/tsdoc');

// for node rendering
const nodeRenderers = {
  PlainText: (node) => node.text || '',
  CodeSpan: (node) => `\`${node.code || ''}\``,
  FencedCodeBlock: (node) => `\`\`\`${node.language || ''}\n${node.code || ''}\n\`\`\``,
  Paragraph: (node) => renderDocNodeToText(node) + '\n',
  SoftBreak: () => ' ',
  default: (node) => node.nodes ? renderDocNodeToText(node) : ''
};

/**
 *  to render a single doc node
 * @param {any} node - Document node to render
 * @returns {string} - Rendered text
 */
const renderNode = (node) => {
  const renderer = nodeRenderers[node.kind] || nodeRenderers.default;
  return renderer(node);
};

/**
 *  to render doc node tree to text
 * @param {any} docNode - Document node
 * @returns {string} - Rendered text
 */
const renderDocNodeToText = (docNode) => {
  if (!docNode?.nodes) return '';
  return docNode.nodes.map(renderNode).join('').trim();
};

// for comment extraction
const commentPatterns = [
  /^(\s*\/\/\s*)(.+)$/,
  /^(\s*#\s*)(.+)$/
];

/**
 *  to extract first comment from content
 * @param {string} content - Content to extract from
 * @returns {{title: string}} - Extracted comment
 */
const extractFirstComment = (content) => {
  const firstLine = content.trim().split('\n')[0]?.trim() || '';
  
  for (const pattern of commentPatterns) {
    const match = firstLine.match(pattern);
    if (match) {
      return { title: match[2]?.trim() || '' };
    }
  }
  
  return { title: '' };
};

// for code node processing
const codeNodeProcessors = {
  PlainText: (node) => node.text,
  Paragraph: (node) => {
    const processed = processCodeNodes(node.nodes);
    return processed + (processed ? '\n' : '');
  },
  SoftBreak: () => '\n',
  FencedCode: (node) => node.code || '',
  ErrorText: (node) => node.text || '',
  default: (node) => node.nodes ? processCodeNodes(node.nodes) : ''
};

/**
 *  to process a single code node
 * @param {any} node - Code node to process
 * @returns {string} - Processed text
 */
const processCodeNode = (node) => {
  const processor = codeNodeProcessors[node.kind] || codeNodeProcessors.default;
  return processor(node);
};

/**
 *  to process code nodes
 * @param {any} nodes - Nodes to process
 * @returns {string} - Processed text
 */
const processCodeNodes = (nodes) => {
  if (!nodes) return '';
  return nodes.map(processCodeNode).join('');
};

// for type checking
const complexTypePatterns = [/[|&]/, /typeof /, /keyof /];

/**
 *  to check if signature is a simple object type
 * @param {string} signature - Type signature
 * @returns {boolean} - Whether it's a simple object type
 */
const isSimpleObjectType = (signature) => {
  const trimmed = signature.trim();
  return trimmed.startsWith('{') && 
         trimmed.endsWith('}') && 
         !complexTypePatterns.some(pattern => pattern.test(trimmed));
};

// for property parsing
const cleanObjectSignature = (signature) => 
  signature.replace(/^\s*{\s*|\s*}\s*$/g, '').trim();

const isNotNull = (prop) => prop !== null;

/**
 *  to parse object type signature into properties
 * @param {string} signature - Object type signature
 * @returns {Array<{name: string, type: string, description: string}>} - Parsed properties
 */
const parseObjectTypeSignature = (signature) => {
  const cleaned = cleanObjectSignature(signature);
  if (!cleaned) return [];

  return splitObjectProperties(cleaned)
    .map(parseProperty)
    .filter(isNotNull);
};

/**
 *  to split object properties handling nested structures
 * @param {string} content - Property content to split
 * @returns {string[]} - Split properties
 */
const splitObjectProperties = (content) => {
  const state = { parts: [], current: '', depth: 0, inAngleBrackets: 0 };
  
  const processChar = (char) => {
    const charHandlers = {
      '{': () => state.depth++,
      '}': () => state.depth--,
      '<': () => state.inAngleBrackets++,
      '>': () => state.inAngleBrackets--,
      ';': () => {
        if (state.depth === 0 && state.inAngleBrackets === 0) {
          state.parts.push(state.current.trim());
          state.current = '';
          return true; // Skip adding char
        }
        return false;
      }
    };
    
    const handler = charHandlers[char];
    const shouldSkip = handler && handler();
    
    if (!shouldSkip) {
      state.current += char;
    }
  };
  
  for (const char of content) {
    processChar(char);
  }
  
  if (state.current.trim()) {
    state.parts.push(state.current.trim());
  }
  
  return state.parts;
};

/**
 *  to parse individual property
 * @param {string} part - Property string to parse
 * @returns {{name: string, type: string, description: string} | null} - Parsed property
 */
const parseProperty = (part) => {
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
};

// for callback detection
const callbackIndicators = ['callback', 'function', '=>', '()'];

/**
 *  to check if type string indicates a callback
 * @param {string} typeString - Type string to check
 * @returns {boolean} - Whether it's a callback type
 */
const isCallbackType = (typeString) => 
  callbackIndicators.some(indicator => 
    typeString.toLowerCase().includes(indicator.toLowerCase()) ||
    typeString.includes(indicator)
  );

/**
 * to generate callback example for callback types
 * @param {string} typeString - The function type string (e.g., "SurveyCallback")
 * @returns {string|null} - Simple callback example or null if not a callback
 */
const generateCallbackExample = (typeString) => 
  isCallbackType(typeString) ? '() => {}' : null;

// for string manipulation and formatting
/**
 * to convert text to lowercase ID format
 * @param {string} text - Text to convert
 * @returns {string} - Lowercase ID with underscores
 */
const textToId = (text) => 
  text.toLowerCase().replace(/ /g, '_');

/**
 * to create parameter list string
 * @param {any[]} params - Array of parameters
 * @returns {string} - Formatted parameter list
 */
const formatParameterList = (params) => 
  (params || []).map(p => `<${p.name}>`).join(', ');

/**
 * to generate template example code
 * @param {string} methodName - Name of the method
 * @param {string} paramList - Formatted parameter list
 * @returns {string} - Generated example code
 */
const generateExampleCode = (methodName, paramList) =>
  `// Generated example for ${methodName}\nposthog.${methodName}(${paramList});`;

/**
 * to check if array has items
 * @param {any[]} array - Array to check
 * @returns {boolean} - Whether array has items
 */
const hasItems = (array) => 
  array && array.length > 0;

/**
 * to create string literal descriptor
 * @param {string} value - The literal value
 * @returns {{name: string, type: string, description: string}} - String literal descriptor
 */
const createStringLiteral = (value) => ({
  name: value,
  type: `"${value}"`,
  description: `String literal value: ${value}`
});

module.exports = {
  renderDocNodeToText,
  extractFirstComment,
  processCodeNodes,
  parseObjectTypeSignature,
  isSimpleObjectType,
  generateCallbackExample,
  isCallbackType,
  textToId,
  formatParameterList,
  generateExampleCode,
  hasItems,
  createStringLiteral,
};
