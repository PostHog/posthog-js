/**
 * Babel plugin that transforms Vite's import.meta.glob() calls into
 * static module maps with dynamic import() for use with Jest in ESM mode.
 *
 * Transforms:
 *   import.meta.glob('./**\/*.ts')
 * Into:
 *   { './foo.ts': () => import('./foo.ts'), './bar.ts': () => import('./bar.ts') }
 */
const fs = require('fs')
const path = require('path')

function matchGlob(pattern, filePath) {
  // Convert glob pattern to regex
  // Handle **/ separately: it matches zero or more directory segments
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*/g, '[^/]*')
  return new RegExp('^' + regexStr + '$').test(filePath)
}

function findFiles(dir) {
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: false })
  return entries
    .map((entry) => './' + entry.toString().replace(/\\/g, '/'))
    .filter((entry) => {
      try {
        return fs.statSync(path.join(dir, entry)).isFile()
      } catch {
        return false
      }
    })
}

module.exports = function ({ types: t }) {
  return {
    visitor: {
      CallExpression(nodePath, state) {
        const callee = nodePath.node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'MetaProperty' &&
          callee.object.meta.name === 'import' &&
          callee.object.property.name === 'meta' &&
          callee.property.name === 'glob' &&
          nodePath.node.arguments.length >= 1 &&
          nodePath.node.arguments[0].type === 'StringLiteral'
        ) {
          const pattern = nodePath.node.arguments[0].value
          const sourceDir = path.dirname(state.filename)
          const files = findFiles(sourceDir)
            .filter((f) => matchGlob(pattern, f))
            .filter((f) => !f.includes('/node_modules/'))
            .sort()

          const properties = files.map((file) =>
            t.objectProperty(
              t.stringLiteral(file),
              t.arrowFunctionExpression(
                [],
                t.callExpression(t.import(), [t.stringLiteral(file)])
              )
            )
          )

          nodePath.replaceWith(t.objectExpression(properties))
        }
      },
    },
  }
}
