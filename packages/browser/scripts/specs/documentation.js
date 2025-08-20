const utils = require('./utils');
const { NO_DESCRIPTION_AVAILABLE } = require('./constants');
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
    : NO_DESCRIPTION_AVAILABLE;

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
  return extractParamContent(paramBlock) || NO_DESCRIPTION_AVAILABLE;
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


/**
 * to extract category tags
 * @param {any} apiMethod - API method to extract from
 * @returns {string} - Category or empty string
 */
const extractCategoryTags = (tsdocComment) => {
  if (tsdocComment.tagName === '@label') {
    return tsdocComment.tagContent;
  }
  const children = tsdocComment.getChildNodes?.();
  if (children) {
    for (const child of children) {
      const result = extractCategoryTags(child);
      if (result) {
        return result;
      }
    }
  }
  return null;
};

module.exports = {
  getDocComment,
  getParamDescription,
  getRemarks,
  extractCategoryTags,
};