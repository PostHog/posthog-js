/**
 * @public
 */
export interface ThirdBase {
    tag?: string;
}

/**
 * Collides with the declaration in other.d.ts
 */
type Dup = {
    fromThird: string;
};
