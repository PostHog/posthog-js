import {
  DependencyGraph,
  CyclicDependencyError,
  buildDependencyGraph,
  extractFlagDependencies,
  matchFlagDependency,
} from '../src/extensions/feature-flags/dependency-graph'
import { PostHogFeatureFlag } from '../src/types'

describe('DependencyGraph', () => {
  let graph: DependencyGraph

  beforeEach(() => {
    graph = new DependencyGraph()
  })

  describe('addFlag', () => {
    it('should add a flag to the graph', () => {
      graph.addFlag('flag1')
      expect(graph.getAllFlags()).toContain('flag1')
    })

    it('should initialize empty dependencies and dependents', () => {
      graph.addFlag('flag1')
      expect(graph.getDependencies('flag1')).toEqual(new Set())
      expect(graph.getDependents('flag1')).toEqual(new Set())
    })
  })

  describe('addDependency', () => {
    it('should add dependency relationship', () => {
      graph.addDependency('flag1', 'flag2')

      expect(graph.getDependencies('flag1')).toContain('flag2')
      expect(graph.getDependents('flag2')).toContain('flag1')
    })

    it('should automatically add flags if they do not exist', () => {
      graph.addDependency('flag1', 'flag2')

      expect(graph.getAllFlags()).toContain('flag1')
      expect(graph.getAllFlags()).toContain('flag2')
    })
  })

  describe('cache management', () => {
    it('should cache and retrieve results', () => {
      graph.cacheResult('flag1', 'variant1')
      expect(graph.getCachedResult('flag1')).toBe('variant1')
    })

    it('should return undefined for uncached flags', () => {
      expect(graph.getCachedResult('nonexistent')).toBeUndefined()
    })

    it('should clear cache', () => {
      graph.cacheResult('flag1', true)
      graph.clearCache()
      expect(graph.getCachedResult('flag1')).toBeUndefined()
    })
  })

  describe('detectCycles', () => {
    it('should detect no cycles in acyclic graph', () => {
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag3')

      expect(graph.detectCycles()).toEqual([])
    })

    it('should detect simple cycle', () => {
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag1')

      const cycles = graph.detectCycles()
      expect(cycles.length).toBeGreaterThan(0)
      expect(cycles).toContain('flag1')
      expect(cycles).toContain('flag2')
    })

    it('should detect complex cycle', () => {
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag3')
      graph.addDependency('flag3', 'flag1')

      const cycles = graph.detectCycles()
      expect(cycles.length).toBeGreaterThan(0)
    })
  })

  describe('topologicalSort', () => {
    it('should sort flags in dependency order', () => {
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag3')
      graph.addFlag('flag4') // Independent flag

      const sorted = graph.topologicalSort()

      // flag3 should come before flag2, flag2 should come before flag1
      expect(sorted.indexOf('flag3')).toBeLessThan(sorted.indexOf('flag2'))
      expect(sorted.indexOf('flag2')).toBeLessThan(sorted.indexOf('flag1'))
      expect(sorted).toContain('flag4')
    })

    it('should throw error on cyclic dependencies', () => {
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag1')

      expect(() => graph.topologicalSort()).toThrow(CyclicDependencyError)
    })

    it('should handle empty graph', () => {
      expect(graph.topologicalSort()).toEqual([])
    })

    it('should handle single flag', () => {
      graph.addFlag('flag1')
      expect(graph.topologicalSort()).toEqual(['flag1'])
    })
  })

  describe('removeFlag', () => {
    it('should remove flag and all its relationships', () => {
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag3', 'flag1')
      graph.cacheResult('flag1', true)

      graph.removeFlag('flag1')

      expect(graph.getAllFlags()).not.toContain('flag1')
      expect(graph.getDependencies('flag3')).not.toContain('flag1')
      expect(graph.getDependents('flag2')).not.toContain('flag1')
      expect(graph.getCachedResult('flag1')).toBeUndefined()
    })

    it('should handle removing non-existent flag gracefully', () => {
      graph.addFlag('flag1')

      expect(() => graph.removeFlag('nonexistent')).not.toThrow()
      expect(graph.getAllFlags()).toContain('flag1')
    })
  })

  describe('removeCycles', () => {
    it('should remove all flags involved in cycles', () => {
      // Create cycle: flag1 -> flag2 -> flag1
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag1')
      graph.addFlag('flag3') // Independent flag

      const removedFlags = graph.removeCycles()

      expect(removedFlags).toEqual(expect.arrayContaining(['flag1', 'flag2']))
      expect(graph.getAllFlags()).toContain('flag3')
      expect(graph.getAllFlags()).not.toContain('flag1')
      expect(graph.getAllFlags()).not.toContain('flag2')
    })

    it('should return empty array when no cycles exist', () => {
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag3')

      const removedFlags = graph.removeCycles()

      expect(removedFlags).toEqual([])
      expect(graph.getAllFlags()).toEqual(new Set(['flag1', 'flag2', 'flag3']))
    })
  })

  describe('filterByKeys', () => {
    beforeEach(() => {
      // Create a complex dependency graph
      graph.addDependency('flag1', 'flag2')
      graph.addDependency('flag2', 'flag3')
      graph.addDependency('flag4', 'flag5')
      graph.addFlag('flag6') // Independent flag
    })

    it('should filter to requested keys and their dependencies', () => {
      const filtered = graph.filterByKeys(new Set(['flag1']))

      expect(filtered.getAllFlags()).toEqual(new Set(['flag1', 'flag2', 'flag3']))
    })

    it('should include multiple requested keys and their dependencies', () => {
      const filtered = graph.filterByKeys(new Set(['flag1', 'flag4']))

      expect(filtered.getAllFlags()).toEqual(new Set(['flag1', 'flag2', 'flag3', 'flag4', 'flag5']))
    })

    it('should handle non-existent flags gracefully', () => {
      const filtered = graph.filterByKeys(new Set(['nonexistent']))

      expect(filtered.getAllFlags()).toEqual(new Set())
    })

    it('should preserve dependency relationships in filtered graph', () => {
      const filtered = graph.filterByKeys(new Set(['flag1']))

      expect(filtered.getDependencies('flag1')).toContain('flag2')
      expect(filtered.getDependencies('flag2')).toContain('flag3')
    })
  })
})

describe('extractFlagDependencies', () => {
  it('should extract flag dependencies from feature flag', () => {
    const flag: PostHogFeatureFlag = {
      id: 1,
      key: 'test-flag',
      active: true,
      filters: {
        groups: [
          {
            properties: [
              { type: 'flag', key: '123', value: true },
              { type: 'person', key: 'email', value: 'test@example.com' },
              { type: 'flag', key: '456', value: 'variant1' },
            ],
            rollout_percentage: 100,
          },
        ],
      },
    }

    const dependencies = extractFlagDependencies(flag)
    expect(dependencies).toEqual(new Set(['123', '456']))
  })

  it('should handle flags without dependencies', () => {
    const flag: PostHogFeatureFlag = {
      id: 1,
      key: 'test-flag',
      active: true,
      filters: {
        groups: [
          {
            properties: [{ type: 'person', key: 'email', value: 'test@example.com' }],
            rollout_percentage: 100,
          },
        ],
      },
    }

    const dependencies = extractFlagDependencies(flag)
    expect(dependencies).toEqual(new Set())
  })

  it('should handle flags with empty filters', () => {
    const flag: PostHogFeatureFlag = {
      id: 1,
      key: 'test-flag',
      active: true,
    }

    const dependencies = extractFlagDependencies(flag)
    expect(dependencies).toEqual(new Set())
  })
})

describe('buildDependencyGraph', () => {
  it('should build graph from feature flags', () => {
    const flags: PostHogFeatureFlag[] = [
      {
        id: 1,
        key: 'flag1',
        active: true,
        filters: {
          groups: [
            {
              properties: [{ type: 'flag', key: '2', value: true }],
              rollout_percentage: 100,
            },
          ],
        },
      },
      {
        id: 2,
        key: 'flag2',
        active: true,
      },
      {
        id: 3,
        key: 'flag3',
        active: true,
        filters: {
          groups: [
            {
              properties: [{ type: 'flag', key: '1', value: false }],
              rollout_percentage: 100,
            },
          ],
        },
      },
    ]

    const { graph, idToKeyMapping, removedFlags } = buildDependencyGraph(flags)

    // Check ID to key mapping
    expect(idToKeyMapping.get('1')).toBe('flag1')
    expect(idToKeyMapping.get('2')).toBe('flag2')
    expect(idToKeyMapping.get('3')).toBe('flag3')

    // Check dependencies
    expect(graph.getDependencies('flag1')).toContain('flag2')
    expect(graph.getDependencies('flag3')).toContain('flag1')

    // Check all flags are added
    expect(graph.getAllFlags()).toEqual(new Set(['flag1', 'flag2', 'flag3']))

    // No cycles should be removed
    expect(removedFlags).toEqual([])
  })

  it('should handle missing dependency references gracefully', () => {
    const flags: PostHogFeatureFlag[] = [
      {
        id: 1,
        key: 'flag1',
        active: true,
        filters: {
          groups: [
            {
              properties: [{ type: 'flag', key: '999', value: true }], // Non-existent flag
              rollout_percentage: 100,
            },
          ],
        },
      },
    ]

    const { graph, removedFlags } = buildDependencyGraph(flags)

    // Should still add the flag but not create dependency to non-existent flag
    expect(graph.getAllFlags()).toContain('flag1')
    expect(graph.getDependencies('flag1')).toEqual(new Set())
    expect(removedFlags).toEqual([])
  })

  it('should remove cyclic dependencies during build', () => {
    const flags: PostHogFeatureFlag[] = [
      {
        id: 1,
        key: 'flag1',
        active: true,
        filters: {
          groups: [
            {
              properties: [{ type: 'flag', key: '2', value: true }],
              rollout_percentage: 100,
            },
          ],
        },
      },
      {
        id: 2,
        key: 'flag2',
        active: true,
        filters: {
          groups: [
            {
              properties: [{ type: 'flag', key: '1', value: false }], // Creates cycle
              rollout_percentage: 100,
            },
          ],
        },
      },
      {
        id: 3,
        key: 'flag3',
        active: true, // Independent flag
      },
    ]

    const { graph, idToKeyMapping, removedFlags } = buildDependencyGraph(flags)

    // Check that cyclic flags were removed
    expect(removedFlags).toEqual(expect.arrayContaining(['flag1', 'flag2']))

    // Independent flag should remain
    expect(graph.getAllFlags()).toContain('flag3')
    expect(graph.getAllFlags()).not.toContain('flag1')
    expect(graph.getAllFlags()).not.toContain('flag2')

    // ID mapping should still be preserved
    expect(idToKeyMapping.get('1')).toBe('flag1')
    expect(idToKeyMapping.get('2')).toBe('flag2')
    expect(idToKeyMapping.get('3')).toBe('flag3')
  })
})

describe('matchFlagDependency', () => {
  it('should match true filter with any non-false result', () => {
    expect(matchFlagDependency(true, true)).toBe(true)
    expect(matchFlagDependency(true, 'variant1')).toBe(true)
    expect(matchFlagDependency(true, false)).toBe(false)
  })

  it('should match false filter only with false result', () => {
    expect(matchFlagDependency(false, false)).toBe(true)
    expect(matchFlagDependency(false, true)).toBe(false)
    expect(matchFlagDependency(false, 'variant1')).toBe(false)
  })

  it('should match string filter with exact variant', () => {
    expect(matchFlagDependency('variant1', 'variant1')).toBe(true)
    expect(matchFlagDependency('variant1', 'variant2')).toBe(false)
    expect(matchFlagDependency('variant1', true)).toBe(false)
    expect(matchFlagDependency('variant1', false)).toBe(false)
  })
})
