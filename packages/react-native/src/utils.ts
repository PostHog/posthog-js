// @ts-expect-error: HermesInternal is not defined in non-Hermes environments
export const isHermes = () => !!global.HermesInternal
