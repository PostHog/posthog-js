// CSSOM loses var()-bearing shorthands after a longhand override. Save source
// only for those rules; ordinary rules retain their existing serialization.
type RuleSource = { text: string; cssText: string };
let sources = new WeakMap<CSSRule, RuleSource>();
let sourceParents = new WeakSet<CSSRule>();
let exposedRules = new WeakSet<CSSRule>();
let disabled = false;

export function hasEmptyShorthandLonghand(css: string): boolean {
  return /(?:^|[\s;{}])-?[a-zA-Z][\w-]*\s*:\s*;/.test(css);
}

function splitRules(text: string): string[] {
  const rules: string[] = [];
  let start = 0;
  let braces = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote = '';
  let comment = false;
  let ruleStarted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (comment) {
      if (char === '*' && text[i + 1] === '/') {
        comment = false;
        i++;
      }
      continue;
    }
    if (char === '\\') {
      ruleStarted = true;
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      comment = true;
      i++;
      continue;
    }
    // CDO/CDC tokens are ignored by stylesheet parsing, but not insertRule.
    if (!ruleStarted) {
      const length = text.startsWith('<!--', i)
        ? 4
        : text.startsWith('-->', i)
          ? 3
          : 0;
      if (length) {
        i += length - 1;
        start = i + 1;
        continue;
      }
    }
    if (' \t\n\r\f'.indexOf(char) === -1) ruleStarted = true;
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') parentheses++;
    else if (char === ')') parentheses--;
    else if (char === '[') brackets++;
    else if (char === ']') brackets--;
    if (parentheses || brackets) continue;
    if (char === '{') braces++;
    else if (char === '}') braces--;
    if ((char === '}' && braces === 0) || (char === ';' && braces === 0)) {
      rules.push(text.slice(start, i + 1).trim());
      start = i + 1;
      ruleStarted = false;
    }
  }
  return braces || parentheses || brackets || quote || comment ? [] : rules;
}

export function invalidateStyleRuleSource(rule: CSSRule | null): void {
  try {
    while (rule) {
      sources.delete(rule);
      rule = rule.parentRule;
    }
  } catch {
    disableStyleRuleSources();
  }
}

export function rememberStyleRuleSource(rule: CSSRule, text: string): void {
  try {
    invalidateStyleRuleSource(rule);
    if (
      disabled ||
      exposedRules.has(rule) ||
      typeof text !== 'string' ||
      !text.includes('var(')
    )
      return;
    // Deferred link inlining must remain sliceable, rather than validating a
    // retained grouping rule with a synchronous read of its entire cssText.
    if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules.length > 0) {
      let sheet = rule.parentStyleSheet;
      while (sheet?.ownerRule) sheet = sheet.ownerRule.parentStyleSheet;
      if (sheet?.ownerNode?.nodeName === 'LINK') return;
    }
    const cssText = rule.cssText;
    if (hasEmptyShorthandLonghand(cssText)) {
      sources.set(rule, { text, cssText });
      let parent = rule.parentRule;
      while (parent) {
        sourceParents.add(parent);
        parent = parent.parentRule;
      }
    }
  } catch {
    // Source capture must not change a successful native CSSOM operation.
  }
}

export function rememberStylesheetSource(
  sheet: CSSStyleSheet,
  text: string,
): void {
  try {
    if (disabled || typeof text !== 'string' || !text.includes('var(')) return;
    const rules = Array.from(sheet.cssRules);
    if (!rules.some((rule) => hasEmptyShorthandLonghand(rule.cssText))) return;
    const authored = splitRules(text);
    // A browser can discard unsupported or invalid rules. Do not pair source
    // fragments with different rules when the two parsers disagree.
    if (authored.length !== rules.length) return;
    rules.forEach((rule, index) =>
      rememberStyleRuleSource(rule, authored[index]),
    );
  } catch {
    // Source capture must not change a successful native CSSOM operation.
  }
}

export function getStyleRuleSource(rule: CSSRule): string | undefined {
  const source = sources.get(rule);
  if (!source) return;
  if (source.cssText !== rule.cssText) {
    sources.delete(rule);
    return;
  }
  return source.text;
}

export function hasStyleRuleSourceChildren(rule: CSSRule): boolean {
  return sourceParents.has(rule);
}

export function exposeStyleRuleSource(rule: CSSRule): void {
  invalidateStyleRuleSource(rule);
  try {
    let current: CSSRule | null = rule;
    while (current) {
      exposedRules.add(current);
      current = current.parentRule;
    }
  } catch {
    disableStyleRuleSources();
  }
}

export function disableStyleRuleSources(): void {
  sources = new WeakMap();
  sourceParents = new WeakSet();
  disabled = true;
}

export function resetStyleRuleSources(): void {
  sources = new WeakMap();
  sourceParents = new WeakSet();
  exposedRules = new WeakSet();
  disabled = false;
}
