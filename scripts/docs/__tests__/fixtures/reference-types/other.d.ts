/**
 * @public
 */
export interface RemoteOptions {
    deep: boolean;
}

/**
 * @public
 */
export interface RemoteBase {
    /** Options resolved from another file */
    options?: RemoteOptions;
}

/**
 * Alias that never reaches the entry point's exports
 *
 * @public
 */
export type RemoteMode = {
    fast: boolean;
};

/**
 * Collides with the declaration in third.d.ts
 */
type Dup = {
    fromOther: string;
};
