import { PostHogFeatureFlag } from '../../types'
import type { FeatureFlagValue } from '@posthog/core'

class DependencyGraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DependencyGraphError'
    Error.captureStackTrace(this, this.constructor)
    Object.setPrototypeOf(this, DependencyGraphError.prototype)
  }
}

class CyclicDependencyError extends DependencyGraphError {
  public flagKey: string

  constructor(flagKey: string) {
    super(`Cyclic dependency detected involving flag: ${flagKey}`)
    this.name = 'CyclicDependencyError'
    this.flagKey = flagKey
    Object.setPrototypeOf(this, CyclicDependencyError.prototype)
  }
}

class DependencyGraph {
  private dependencies: Map<string, Set<string>> = new Map() // flag_key -> set of flags it depends on
  private dependents: Map<string, Set<string>> = new Map() // flag_key -> set of flags that depend on it
  private flags: Set<string> = new Set()
  private evaluationCache: Map<string, FeatureFlagValue> = new Map()

  addFlag(flagKey: string): void {
    this.flags.add(flagKey)
    if (!this.dependencies.has(flagKey)) {
      this.dependencies.set(flagKey, new Set())
    }
    if (!this.dependents.has(flagKey)) {
      this.dependents.set(flagKey, new Set())
    }
  }

  addDependency(flagKey: string, dependencyKey: string): void {
    this.addFlag(flagKey)
    this.addFlag(dependencyKey)

    this.dependencies.get(flagKey)!.add(dependencyKey)
    this.dependents.get(dependencyKey)!.add(flagKey)
  }

  getDependencies(flagKey: string): Set<string> {
    return new Set(this.dependencies.get(flagKey) || [])
  }

  getDependents(flagKey: string): Set<string> {
    return new Set(this.dependents.get(flagKey) || [])
  }

  getAllFlags(): Set<string> {
    return new Set(this.flags)
  }

  removeFlag(flagKey: string): void {
    this.flags.delete(flagKey)

    // Remove dependencies FROM this flag
    const dependencies = this.dependencies.get(flagKey) || new Set()
    for (const dependency of dependencies) {
      this.dependents.get(dependency)?.delete(flagKey)
    }
    this.dependencies.delete(flagKey)

    // Remove dependencies TO this flag
    const dependents = this.dependents.get(flagKey) || new Set()
    for (const dependent of dependents) {
      this.dependencies.get(dependent)?.delete(flagKey)
    }
    this.dependents.delete(flagKey)

    // Clear any cached result
    this.evaluationCache.delete(flagKey)
  }

  removeCycles(): string[] {
    const cycleFlags = this.detectCycles()
    for (const flagKey of cycleFlags) {
      this.removeFlag(flagKey)
    }
    return cycleFlags
  }

  cacheResult(flagKey: string, result: FeatureFlagValue): void {
    this.evaluationCache.set(flagKey, result)
  }

  getCachedResult(flagKey: string): FeatureFlagValue | undefined {
    return this.evaluationCache.get(flagKey)
  }

  clearCache(): void {
    this.evaluationCache.clear()
  }

  detectCycles(): string[] {
    const visited = new Set<string>()
    const recStack = new Set<string>()
    const allCycleFlags = new Set<string>()

    const dfs = (flagKey: string, path: string[]): boolean => {
      if (recStack.has(flagKey)) {
        // Found a cycle - add all flags in the cycle path from the repeated flag onwards
        const cycleStartIndex = path.indexOf(flagKey)
        for (let i = cycleStartIndex; i < path.length; i++) {
          allCycleFlags.add(path[i])
        }
        allCycleFlags.add(flagKey)
        return true
      }
      if (visited.has(flagKey)) {
        return false
      }

      visited.add(flagKey)
      recStack.add(flagKey)
      path.push(flagKey)

      const dependencies = this.dependencies.get(flagKey) || new Set()
      for (const dependency of dependencies) {
        if (dfs(dependency, path)) {
          // Don't return early - we want to find all cycles
        }
      }

      path.pop()
      recStack.delete(flagKey)
      return false
    }

    // Check all flags to find all cycles
    for (const flag of this.flags) {
      if (!visited.has(flag)) {
        dfs(flag, [])
      }
    }

    return Array.from(allCycleFlags)
  }

  topologicalSort(): string[] {
    // Calculate in-degrees (number of dependencies for each flag)
    const inDegree = new Map<string, number>()
    for (const flag of this.flags) {
      inDegree.set(flag, this.dependencies.get(flag)?.size || 0)
    }

    // Find flags with no dependencies
    const queue: string[] = []
    for (const [flag, degree] of inDegree) {
      if (degree === 0) {
        queue.push(flag)
      }
    }

    const result: string[] = []

    while (queue.length > 0) {
      const flagKey = queue.shift()!
      result.push(flagKey)

      // Update in-degrees of dependents
      const dependents = this.dependents.get(flagKey) || new Set()
      for (const dependent of dependents) {
        const currentDegree = inDegree.get(dependent)!
        inDegree.set(dependent, currentDegree - 1)
        if (inDegree.get(dependent) === 0) {
          queue.push(dependent)
        }
      }
    }

    // Check for cycles
    if (result.length !== this.flags.size) {
      const remainingFlags = Array.from(this.flags).filter((flag) => !result.includes(flag))
      throw new CyclicDependencyError(remainingFlags[0])
    }

    return result
  }

  filterByKeys(requestedKeys: Set<string>): DependencyGraph {
    const filteredGraph = new DependencyGraph()

    // BFS to find all flags that need to be included
    const queue = Array.from(requestedKeys)
    const requiredFlags = new Set(requestedKeys)

    while (queue.length > 0) {
      const flagKey = queue.shift()!
      if (this.flags.has(flagKey)) {
        const dependencies = this.dependencies.get(flagKey) || new Set()
        for (const dependency of dependencies) {
          if (!requiredFlags.has(dependency)) {
            requiredFlags.add(dependency)
            queue.push(dependency)
          }
        }
      }
    }

    // Build filtered graph with preserved dependencies
    for (const flagKey of requiredFlags) {
      if (this.flags.has(flagKey)) {
        filteredGraph.addFlag(flagKey)
        const dependencies = this.dependencies.get(flagKey) || new Set()
        for (const dependency of dependencies) {
          if (requiredFlags.has(dependency)) {
            filteredGraph.addDependency(flagKey, dependency)
          }
        }
      }
    }

    return filteredGraph
  }
}

function extractFlagDependencies(featureFlag: PostHogFeatureFlag): Set<string> {
  const dependencies = new Set<string>()
  const flagConditions = featureFlag.filters?.groups || []

  for (const condition of flagConditions) {
    const properties = condition.properties || []
    for (const prop of properties) {
      if (prop.type === 'flag') {
        const dependencyKey = prop.key
        if (dependencyKey) {
          dependencies.add(String(dependencyKey))
        }
      }
    }
  }

  return dependencies
}

function buildDependencyGraph(featureFlags: PostHogFeatureFlag[]): {
  graph: DependencyGraph
  idToKeyMapping: Map<string, string>
  removedFlags: string[]
} {
  const graph = new DependencyGraph()
  const idToKeyMapping = new Map<string, string>()

  // First pass: create ID to key mapping and add all flags
  for (const flag of featureFlags) {
    graph.addFlag(flag.key)
    if (flag.id !== undefined) {
      idToKeyMapping.set(String(flag.id), flag.key)
    }
  }

  // Second pass: add dependencies using ID to key mapping
  for (const flag of featureFlags) {
    const dependencies = extractFlagDependencies(flag)
    for (const dependencyId of dependencies) {
      const dependencyKey = idToKeyMapping.get(dependencyId)
      if (dependencyKey) {
        graph.addDependency(flag.key, dependencyKey)
      }
    }
  }

  // Third pass: detect and remove cycles proactively
  const removedFlags = graph.removeCycles()

  return { graph, idToKeyMapping, removedFlags }
}

function matchFlagDependency(filterValue: FeatureFlagValue, flagResult: FeatureFlagValue): boolean {
  if (filterValue === true) {
    // True matches any enabled state (not false)
    return flagResult !== false
  } else if (filterValue === false) {
    // False matches only disabled state (exactly false)
    return flagResult === false
  } else {
    // String value matches exact variant name
    return flagResult === filterValue
  }
}

export {
  DependencyGraph,
  DependencyGraphError,
  CyclicDependencyError,
  extractFlagDependencies,
  buildDependencyGraph,
  matchFlagDependency,
}
