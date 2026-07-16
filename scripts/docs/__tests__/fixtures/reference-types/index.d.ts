import type { RemoteBase } from './other';
import type { ThirdBase } from './third';

/**
 * Base configuration shared by all clients
 *
 * @public
 */
export interface BaseConfig {
    /** URL of the API host */
    api_host: string;
    /** Called when the client is ready */
    loaded: (client: unknown) => void;
    /** Optional project token */
    token?: string;
    /** @deprecated Use api_host */
    old_host?: string;
    /** Internal preview toggle */
    __internal_flag?: boolean;
}

/**
 * Object-shaped alias built from Omit and an intersection
 *
 * @public
 */
export type Config = Omit<BaseConfig, 'loaded'> & {
    /** Called with the initialized client */
    loaded: (client: BaseConfig) => void;
    debug?: boolean;
};

/**
 * Plain object literal alias
 *
 * @public
 */
export type FlagVariant = {
    flag: string;
    variant: string;
};

/**
 * Genuine callback alias
 *
 * @public
 */
export type LoadedCallback = (client: BaseConfig) => void;

/**
 * String literal union alias
 *
 * @public
 */
export type Fruit = 'apple' | 'banana' | 'cherry';

/**
 * Alias with only an index signature
 *
 * @public
 */
export type PropertyFilters = {
    [propertyName: string]: {
        values: string[];
    };
};

/**
 * @public
 */
export interface QuestionA {
    kind: string;
    a: string;
}

/**
 * @public
 */
export interface QuestionB {
    kind: string;
    b: string;
}

/**
 * Union of interfaces
 *
 * @public
 */
export type Question = QuestionA | QuestionB;

/**
 * Generic alias, not resolvable without type arguments
 *
 * @public
 */
export type WithoutKind<T> = Omit<T, 'kind'>;

/**
 * Tuple alias
 *
 * @public
 */
export type Pair = [name: string, value: number];

/**
 * Union that the checker collapses to plain string
 *
 * @public
 */
export type LooseId = 'special' | string;

/**
 * Intersection mixing a lexically imported property type with one that is only
 * reachable through the checker
 *
 * @public
 */
export type Remote = RemoteBase & {
    local?: string;
    extra?: ThirdBase;
};

/**
 * Callable object: a call signature alongside named properties
 *
 * @public
 */
export type CallableWithProps = {
    (input: string): boolean;
    /** Human-readable label */
    label: string;
};

/**
 * Members in every deprecation shape
 *
 * @public
 */
export interface DeprecationShapes {
    /** Current option */
    current: string;
    /**
     * Legacy timeout in ms.
     *
     * @deprecated Use current instead
     */
    legacy_timeout?: number;
    /** @deprecated */
    retired?: boolean;
    /** @deprecated Gone. Use current **/
    legacy_typo?: string;
    /** This is **important** */
    emphasized?: string;
    /** @deprecated Use current instead */
    __legacy_flag?: boolean;
}

/**
 * Alias flattening the same members through the checker path
 *
 * @public
 */
export type DeprecationShapesAlias = DeprecationShapes & {
    extra?: string;
};

/**
 * @public
 */
export declare enum Mode {
    /** Standard mode */
    Standard = "standard",
    /** @deprecated Use Standard */
    Legacy = "legacy"
}

/**
 * Referenced by the public API but not exported
 */
type HiddenOptions = {
    /** Enables verbose output */
    verbose: boolean;
};

/**
 * @public
 */
export declare function configure(options: HiddenOptions): void;
