// Deeply compares two objects for equality.
// Use a WeakMap to keep track of visited objects to avoid infinite recursion.
// WeakMap is supported in IE11, see https://caniuse.com/?search=JavaScript%20WeakMap

export function isDeepEqual(obj1: any, obj2: any, visited = new WeakMap()): boolean {
    if (obj1 === obj2) {
        return true
    }

    if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
        return false
    }

    if (visited.has(obj1) && visited.get(obj1) === obj2) {
        return true
    }
    visited.set(obj1, obj2)

    const keys1 = Object.keys(obj1)
    const keys2 = Object.keys(obj2)

    if (keys1.length !== keys2.length) {
        return false
    }

    for (const key of keys1) {
        if (!keys2.includes(key)) {
            return false
        }
        if (!isDeepEqual(obj1[key], obj2[key], visited)) {
            return false
        }
    }

    return true
}
