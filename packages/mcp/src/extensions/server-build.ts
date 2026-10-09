export const MAX_SERVER_BUILD_LENGTH = 256

/** Rejects build identifiers that the event pipeline cannot record exactly. */
export function validateServerBuild(serverBuild: unknown): string | undefined {
  if (serverBuild === undefined) {
    return
  }
  if (typeof serverBuild !== 'string' || serverBuild.length === 0) {
    throw new TypeError('serverBuild must be a non-empty string.')
  }
  if (serverBuild.length > MAX_SERVER_BUILD_LENGTH) {
    throw new RangeError(`serverBuild must not exceed ${MAX_SERVER_BUILD_LENGTH} characters.`)
  }
  return serverBuild
}
