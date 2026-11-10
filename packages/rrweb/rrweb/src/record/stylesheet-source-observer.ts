import {
  disableStyleRuleSources,
  clearStyleRuleSources,
  exposeStyleRuleSource,
  resetStyleRuleSources,
  trackStyleRuleSourceRealm,
} from '@posthog/rrweb-snapshot';
import type { IWindow, listenerHandler } from '@posthog/rrweb-types';
import { callAllSafely } from '../utils';

type RealmGuard = {
  win: IWindow;
  prototype: object;
  owners: number;
  dispose: listenerHandler;
};
const guards = new Map<IWindow, RealmGuard>();
const sessions = new WeakMap<listenerHandler, StyleRuleSourceSession>();
let currentSession: StyleRuleSourceSession | undefined;
// Only source invalidation survives the handoff; event-producing observers stop.
let handoff:
  | {
      previous: StyleRuleSourceSession;
      next?: StyleRuleSourceSession;
      valid: boolean;
      stopStarted: boolean;
      stopCompleted: boolean;
      retained: Set<RealmGuard>;
    }
  | undefined;

function initSourceGuard(win: IWindow): listenerHandler {
  const restoreDeclarations: listenerHandler[] = [];
  // An escaped mutable handle can change var() without changing cssText.
  const observeDeclaration = (prototype: object, name: string) => {
    const mutationMethod =
      name === 'appendRule' || name === 'deleteRule' || name === 'insertRule';
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor) {
      if (name === 'style' || mutationMethod) disableStyleRuleSources();
      return;
    }
    const mutableHandle =
      name === 'style' || name === 'styleMap' || name === 'media';
    if (
      !descriptor.configurable ||
      (mutableHandle && !descriptor.get) ||
      (mutationMethod && typeof descriptor.value !== 'function')
    ) {
      disableStyleRuleSources();
      return;
    }
    const replacement = { ...descriptor };
    if (mutationMethod) {
      replacement.value = new Proxy(descriptor.value, {
        apply(target, thisArg: CSSRule, argumentsList: unknown[]) {
          const result = target.apply(thisArg, argumentsList);
          exposeStyleRuleSource(thisArg);
          return result;
        },
      });
    }
    if (descriptor.get && mutableHandle) {
      const originalGet = descriptor.get;
      replacement.get = function (this: CSSRule) {
        const result = originalGet.call(this);
        exposeStyleRuleSource(this);
        return result;
      };
    }
    if (descriptor.set) {
      const originalSet = descriptor.set;
      replacement.set = function (this: CSSRule, value: unknown) {
        const result = originalSet.call(this, value);
        exposeStyleRuleSource(this);
        return result;
      };
    }
    try {
      Object.defineProperty(prototype, name, replacement);
      restoreDeclarations.push(() => {
        const current = Object.getOwnPropertyDescriptor(prototype, name);
        if (
          current?.get === replacement.get &&
          current?.set === replacement.set &&
          current?.value === replacement.value
        ) {
          Object.defineProperty(prototype, name, descriptor);
        }
      });
    } catch {
      disableStyleRuleSources();
    }
  };
  try {
    const newerRuleTypes = win as IWindow & {
      CSSNestedDeclarations?: { prototype: object };
      CSSMarginRule?: { prototype: object };
      CSSPositionTryRule?: { prototype: object };
    };
    for (const ruleType of [
      win.CSSStyleRule,
      win.CSSKeyframeRule,
      win.CSSPageRule,
      win.CSSFontFaceRule,
      newerRuleTypes.CSSNestedDeclarations,
      newerRuleTypes.CSSMarginRule,
      newerRuleTypes.CSSPositionTryRule,
    ]) {
      if (!ruleType) continue;
      observeDeclaration(ruleType.prototype, 'style');
      observeDeclaration(ruleType.prototype, 'styleMap');
    }
    for (const ruleType of [win.CSSMediaRule, win.CSSImportRule]) {
      if (ruleType) observeDeclaration(ruleType.prototype, 'media');
    }
    if (win.CSSStyleRule)
      observeDeclaration(win.CSSStyleRule.prototype, 'selectorText');
    if (win.CSSKeyframeRule)
      observeDeclaration(win.CSSKeyframeRule.prototype, 'keyText');
    if (win.CSSKeyframesRule) {
      observeDeclaration(win.CSSKeyframesRule.prototype, 'name');
      observeDeclaration(win.CSSKeyframesRule.prototype, 'appendRule');
      observeDeclaration(win.CSSKeyframesRule.prototype, 'deleteRule');
    }
    const groupingTypes = win.CSSGroupingRule
      ? [win.CSSGroupingRule]
      : [win.CSSMediaRule, win.CSSConditionRule, win.CSSSupportsRule];
    for (const ruleType of groupingTypes) {
      if (!ruleType) continue;
      observeDeclaration(ruleType.prototype, 'insertRule');
      observeDeclaration(ruleType.prototype, 'deleteRule');
    }
    const rulePrototype = win.CSSRule?.prototype;
    if (
      rulePrototype &&
      Object.getOwnPropertyDescriptor(rulePrototype, 'cssText')?.set
    ) {
      observeDeclaration(rulePrototype, 'cssText');
    }
    return () => callAllSafely(restoreDeclarations);
  } catch (error) {
    callAllSafely(restoreDeclarations);
    disableStyleRuleSources();
    throw error;
  }
}

function disposeGuard(guard: RealmGuard): void {
  guard.dispose();
  if (guards.get(guard.win) === guard) guards.delete(guard.win);
}

function cancelHandoff(): void {
  if (!handoff?.valid) return;
  handoff.valid = false;
  if (currentSession?.stopped) disableStyleRuleSources();
  else clearStyleRuleSources();
}

export class StyleRuleSourceSession {
  private owned = new Map<IWindow, listenerHandler>();
  private pending = new Set<IWindow>();
  stopped: boolean = false;
  ready: boolean = false;

  constructor(
    private win: IWindow,
    recordDOM: boolean,
  ) {
    try {
      const previous = handoff;
      const canContinue =
        recordDOM &&
        previous?.valid &&
        previous.stopCompleted &&
        !previous.next &&
        ['interactive', 'complete'].includes(win.document.readyState);
      if (canContinue) {
        previous.next = this;
        for (const guard of previous.retained) {
          try {
            if (
              guard.win.CSSRule.prototype === guard.prototype &&
              (guard.win === win || guard.win.frameElement?.isConnected)
            ) {
              this.acquire(guard.win);
              if (guard.win !== win) this.pending.add(guard.win);
            }
          } catch {
            // A navigated realm cannot transfer its old source safely.
          }
        }
      } else {
        cancelHandoff();
        if (previous) {
          for (const guard of previous.retained) {
            if (guard.owners === 0) disposeGuard(guard);
          }
          previous.retained.clear();
        }
        resetStyleRuleSources();
      }
      currentSession = this;
      if (recordDOM) this.acquire(win);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  private acquire(win: IWindow): listenerHandler {
    if (!win.CSSRule) {
      disableStyleRuleSources();
      return () => {};
    }
    const owned = this.owned.get(win);
    if (owned) return owned;
    let guard = guards.get(win);
    if (!guard) {
      const releaseRealm = trackStyleRuleSourceRealm(win.CSSRule.prototype);
      let restore: listenerHandler;
      try {
        restore = initSourceGuard(win);
      } catch (error) {
        releaseRealm();
        throw error;
      }
      guard = {
        win,
        prototype: win.CSSRule.prototype,
        owners: 0,
        dispose: () => callAllSafely([releaseRealm, restore]),
      };
      guards.set(win, guard);
    }
    const acquired = guard;
    acquired.owners++;
    const release = () => {
      if (this.owned.get(win) !== release) return;
      this.owned.delete(win);
      this.pending.delete(win);
      acquired.owners--;
      if (acquired.owners === 0) {
        if (
          handoff?.valid &&
          handoff.previous === this &&
          handoff.stopStarted
        ) {
          handoff.retained.add(acquired);
        } else disposeGuard(acquired);
      }
    };
    this.owned.set(win, release);
    return release;
  }

  observe(win: IWindow): listenerHandler {
    this.prune();
    this.pending.delete(win);
    return win === this.win ? () => {} : this.acquire(win);
  }

  prune(): void {
    for (const win of this.pending) {
      try {
        const guard = guards.get(win);
        if (
          win.frameElement?.isConnected &&
          win.CSSRule.prototype === guard?.prototype
        )
          continue;
      } catch {
        // Cross-origin navigation ends ownership of the old realm.
      }
      this.owned.get(win)?.();
    }
  }

  beforeStop(): void {
    if (handoff?.previous === this && handoff.valid && !handoff.stopStarted) {
      handoff.stopStarted = true;
    } else cancelHandoff();
  }

  stop(): void {
    if (this.stopped) return;
    for (const release of [...this.owned.values()]) release();
    this.stopped = true;
    if (handoff?.valid && handoff.previous === this) {
      handoff.stopCompleted = true;
    } else if (currentSession === this) {
      disableStyleRuleSources();
      currentSession = undefined;
    }
  }
}

export function registerStyleRuleSourceSession(
  stop: listenerHandler,
  session: StyleRuleSourceSession,
): void {
  sessions.set(stop, session);
}

export function withStyleRuleSourceHandoff(
  stop: listenerHandler,
  restart: (cancel: listenerHandler) => void,
): void {
  const previous = sessions.get(stop);
  if (!previous || previous.stopped || currentSession !== previous || handoff) {
    cancelHandoff();
    restart(() => {});
    return;
  }
  const scope = {
    previous,
    next: undefined as StyleRuleSourceSession | undefined,
    valid: true,
    stopStarted: false,
    stopCompleted: false,
    retained: new Set<RealmGuard>(),
  };
  handoff = scope;
  try {
    restart(() => {
      if (handoff === scope) cancelHandoff();
    });
  } finally {
    if (!scope.next?.ready) cancelHandoff();
    for (const guard of scope.retained) {
      if (guard.owners === 0) disposeGuard(guard);
    }
    scope.retained.clear();
    if (handoff === scope) handoff = undefined;
  }
}
