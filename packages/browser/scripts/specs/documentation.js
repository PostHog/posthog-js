const utils = require('./utils');

// Documentation extraction functions
const hasDocumentationSummary = (apiItem) => 
  Boolean(apiItem.tsdocComment?.summarySection);

const extractSummaryText = (apiItem) =>
  utils.renderDocNodeToText(apiItem.tsdocComment.summarySection);

/**
 * to get documentation comment
 * @param {any} apiItem - API item to extract documentation from
 * @returns {string} - Documentation comment or default message
 */
const getDocComment = (apiItem) => 
  hasDocumentationSummary(apiItem) 
    ? extractSummaryText(apiItem)
    : 'No description available';

// for parameter documentation
const findParamBlock = (apiMethod, paramName) =>
  apiMethod.tsdocComment?.params?.tryGetBlockByName(paramName);

const extractParamContent = (paramBlock) =>
  paramBlock?.content ? utils.renderDocNodeToText(paramBlock.content) : null;

/**
 * to get parameter description
 * @param {any} apiMethod - API method containing parameter
 * @param {string} paramName - Name of parameter
 * @returns {string} - Parameter description or default message
 */
const getParamDescription = (apiMethod, paramName) => {
  const paramBlock = findParamBlock(apiMethod, paramName);
  return extractParamContent(paramBlock) || 'No description available';
};

// for remarks extraction
const hasRemarks = (apiItem) => 
  Boolean(apiItem.tsdocComment?.remarksBlock);

const extractRemarksContent = (apiItem) =>
  utils.renderDocNodeToText(apiItem.tsdocComment.remarksBlock.content);

/**
 * to get remarks
 * @param {any} apiItem - API item to extract remarks from
 * @returns {string|null} - Remarks content or null
 */
const getRemarks = (apiItem) => 
  hasRemarks(apiItem) ? extractRemarksContent(apiItem) : null;

// for category extraction
const findLabelTag = (inlineTags) => 
  inlineTags.find(tag => tag.tagName === '@label');

const extractCategoryFromTags = (inlineTags) => 
  findLabelTag(inlineTags)?.tagContent || '';

/**
 * to extract category tags
 * @param {any} apiMethod - API method to extract from
 * @returns {string} - Category or empty string
 */
const extractCategoryTags = (apiMethod) => {
  const inlineTags = extractInlineTags(apiMethod.tsdocComment);
  return extractCategoryFromTags(inlineTags);
};

// for inline tag extraction
const isInlineOrLinkTag = (node) => 
  node.kind === 'LinkTag' || node.kind === 'InlineTag';

/**
 * to extract inline tags from doc node
 * @param {any} docNode - Documentation node
 * @returns {any[]} - Array of inline tags
 */
const extractInlineTags = (docNode) => {
  if (!docNode) return [];
  
  const inlineTags = [];
  
  const traverse = (node) => {
    if (!node) return;
    if (isInlineOrLinkTag(node)) {
      inlineTags.push(node);
    }
    node.getChildNodes?.()?.forEach(traverse);
  };
  
  traverse(docNode);
  return inlineTags;
};

module.exports = {
  getDocComment,
  getParamDescription,
  getRemarks,
  extractCategoryTags,
  extractInlineTags,
};