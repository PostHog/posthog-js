import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { QuestionLayout } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance, SurveyAppearanceTheme } from '../src/surveys/surveys-utils'

// Walks a React element tree and returns true if any node is rendered with
// the given component type.
function treeContainsType(node: unknown, type: React.ComponentType<any>): boolean {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return false
  }
  if (Array.isArray(node)) {
    return node.some((child) => treeContainsType(child, type))
  }
  const element = node as React.ReactElement
  if (element.type === type) {
    return true
  }
  const children = (element.props as { children?: unknown } | undefined)?.children
  return treeContainsType(children, type)
}

describe('QuestionLayout disableScrolling', () => {
  const appearance: SurveyAppearanceTheme = { ...defaultSurveyAppearance }

  const renderTree = (overrides: Partial<SurveyAppearanceTheme> = {}): React.ReactElement => {
    const child = React.createElement('Text', { key: 'q' }, 'question body')
    const footer = React.createElement('View', { key: 'f' }, 'submit')
    return QuestionLayout({
      appearance: { ...appearance, ...overrides },
      children: child,
      footer,
    })
  }

  it('wraps children in a ScrollView by default', () => {
    const tree = renderTree()
    expect(tree.type).toBe(View)
    expect(treeContainsType(tree, ScrollView)).toBe(true)
  })

  it('drops the ScrollView when appearance.disableScrolling is true', () => {
    const tree = renderTree({ disableScrolling: true })
    expect(tree.type).toBe(View)
    expect(treeContainsType(tree, ScrollView)).toBe(false)
  })

  it('still renders the footer when scrolling is disabled', () => {
    const footer = React.createElement('View', { testID: 'footer' }, 'submit')
    const tree = QuestionLayout({
      appearance: { ...appearance, disableScrolling: true },
      children: React.createElement('Text', null, 'q'),
      footer,
    })
    const containerChildren = React.Children.toArray(
      (tree.props as { children: React.ReactNode }).children
    ) as React.ReactElement[]
    const footerNode = containerChildren.find((child) => (child.props as { testID?: string }).testID === 'footer')
    expect(footerNode).toBeDefined()
    expect(treeContainsType(tree, ScrollView)).toBe(false)
  })
})
