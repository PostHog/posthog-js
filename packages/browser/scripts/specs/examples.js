const utils = require('./utils');

// for example extraction
const isExampleBlock = (block) => 
  block.blockTag?.tagName === '@example';

const processExampleBlock = (block) => {
  const rawContent = utils.processCodeNodes(block.content?.nodes);
  const { title } = utils.extractFirstComment(rawContent);
  return {
    id: utils.textToId(title),
    name: title,
    code: rawContent,
  };
};

const createTemplateExample = (apiMethod) => {
  const methodName = apiMethod.name;
  const paramList = utils.formatParameterList(apiMethod.params);
  return {
    id: utils.textToId(methodName),
    name: `Generated example for ${methodName}`,
    code: utils.generateExampleCode(methodName, paramList)
  };
};

/**
 * to extract example tags
 * @param {any} apiMethod - API method to extract examples from
 * @returns {any[]} - Array of examples
 */
const extractExampleTags = (apiMethod) => {
  const customBlocks = apiMethod.tsdocComment?._customBlocks || [];
  const examples = customBlocks
    .filter(isExampleBlock)
    .map(processExampleBlock);

  return utils.hasItems(examples) ? examples : [createTemplateExample(apiMethod)];
};

// Alias for backward compatibility
const templateExample = createTemplateExample;

module.exports = {
  extractExampleTags,
  templateExample,
  createTemplateExample,
};