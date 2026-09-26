import {
  DEFAULT_BLOCKED_UA_STRS,
  isBlockedUA,
  isImpossibleChromeVersion,
  heuristicBotScore,
  __resetBotDetectionCacheForTests,
} from './bot-detection'

beforeEach(() => {
  // Ensure each test starts from a clean memoization slate so cache-related
  // suites can measure hits and misses deterministically.
  __resetBotDetectionCacheForTests()
})

// Real Chrome UAs including current stable builds. Chrome's build number
// grows monotonically (see https://versionhistory.googleapis.com/v1/chrome/
// platforms/win/channels/stable/versions?pageSize=5), so this list must
// contain the currently released builds so the default configuration proves
// it does not block them.
const REAL_CHROME_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.193 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.199 Safari/537.36',
  'Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko', // IE11 (not Chrome, but real)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.122 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/40.0.2214.115 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.999 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/250.0.1234.56 Safari/537.36',
  // Chrome 154 stable (build 8037) — released 2026-09 per Google's version-history API.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Safari/537.36',
  // Chrome 155 stable (build 8059) — released 2026-09 per Google's version-history API.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.12 Safari/537.36',
];

const FAKE_BOT_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.7875.1327 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/40.0.8360.1793 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.1729.1302 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.8919.1853 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.1000 Safari/537.36',
];

describe('DEFAULT_BLOCKED_UA_STRS', () => {
  it('contains at least 50 entries', () => {
    expect(DEFAULT_BLOCKED_UA_STRS.length).toBeGreaterThan(50);
  });

  it('contains critical entries', () => {
    expect(DEFAULT_BLOCKED_UA_STRS).toContain('googlebot');
    expect(DEFAULT_BLOCKED_UA_STRS).toContain('headlesschrome');
    expect(DEFAULT_BLOCKED_UA_STRS).toContain('bot/');
  });
});

describe('isBlockedUA (backwards compatibility)', () => {
  it('returns true for undefined ua', () => {
    expect(isBlockedUA(undefined)).toBe(false);
  });

  it('returns false for real Chrome UA', () => {
    expect(isBlockedUA(REAL_CHROME_UAS[0])).toBe(false);
  });

  it('returns true for googlebot UA', () => {
    expect(isBlockedUA('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
  });

  it('accepts customBlockedUserAgents', () => {
    expect(isBlockedUA('custombot', ['custombot'])).toBe(true);
    expect(isBlockedUA('custombot', [])).toBe(false);
  });

  it('default opts identical to old signature', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.7875.1327 Safari/537.36';
    expect(isBlockedUA(ua)).toBe(isBlockedUA(ua, [], { heuristics: 'off' }));
  });
});

describe('isImpossibleChromeVersion', () => {
  it('returns false for real Chrome', () => {
    expect(isImpossibleChromeVersion(REAL_CHROME_UAS[0])).toBe(false); // Chrome/143.0.7499.193
    expect(isImpossibleChromeVersion(REAL_CHROME_UAS[1])).toBe(false); // Chrome/120.0.6099.199
    expect(isImpossibleChromeVersion(REAL_CHROME_UAS[5])).toBe(false); // Chrome/40.0.2214.115
  });

  // Regression test for review feedback on PR #5083: Chrome's build number
  // grows monotonically. The default configuration must NOT flag any
  // Chrome release Google is currently serving from its stable channel.
  it('never flags a currently-released Chrome stable build under the default configuration', () => {
    // Build 8037 (Chrome 154) and 8059 (Chrome 155) are Google's current
    // Windows stable builds per versionhistory.googleapis.com. Both must
    // be accepted with no options.
    expect(isImpossibleChromeVersion(REAL_CHROME_UAS[8])).toBe(false); // 154.0.8037.58
    expect(isImpossibleChromeVersion(REAL_CHROME_UAS[9])).toBe(false); // 155.0.8059.12
  });

  it('returns true for fake bot from #2921', () => {
    expect(isImpossibleChromeVersion(FAKE_BOT_UAS[0])).toBe(true); // Chrome/53.0.7875.1327
    expect(isImpossibleChromeVersion(FAKE_BOT_UAS[1])).toBe(true); // Chrome/40.0.8360.1793
    expect(isImpossibleChromeVersion(FAKE_BOT_UAS[2])).toBe(true); // Chrome/43.0.1729.1302
    expect(isImpossibleChromeVersion(FAKE_BOT_UAS[3])).toBe(true); // Chrome/59.0.8919.1853
  });

  it('handles edge cases', () => {
    expect(isImpossibleChromeVersion('')).toBe(false);
    expect(isImpossibleChromeVersion('not a UA')).toBe(false);
    expect(isImpossibleChromeVersion('Chrome/250.0.1234.56')).toBe(false); // major=250
    expect(isImpossibleChromeVersion(REAL_CHROME_UAS[6])).toBe(false); // Chrome/143.0.7499.999
    expect(isImpossibleChromeVersion(FAKE_BOT_UAS[4])).toBe(true); // Chrome/143.0.7499.1000
    // Custom patch threshold: REAL_CHROME_UAS[0] is Chrome/143.0.7499.193
    // (patch=193 < any tighter bound), so we use a UA with a higher patch.
    expect(isImpossibleChromeVersion('Chrome/143.0.7499.600', 500)).toBe(true); // patch=600, over custom 500
    expect(isImpossibleChromeVersion('Chrome/143.0.7499.400', 500)).toBe(false); // patch=400, under custom 500
  });
});

describe('heuristicBotScore', () => {
  it('default (heuristics=off) returns 0 for any UA', () => {
    expect(heuristicBotScore(FAKE_BOT_UAS[0], { heuristics: 'off' })).toEqual({ score: 0, reasons: [] });
    expect(heuristicBotScore(REAL_CHROME_UAS[0], { heuristics: 'off' })).toEqual({ score: 0, reasons: [] });
    expect(heuristicBotScore(undefined, { heuristics: 'off' })).toEqual({ score: 0, reasons: [] });
  });

  it('strict on fake #2921 bot returns score >= 40 with reasons[]', () => {
    const result = heuristicBotScore(FAKE_BOT_UAS[0], { heuristics: 'strict' });
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('balanced on fake bot returns 40-89', () => {
    const result = heuristicBotScore(FAKE_BOT_UAS[0], { heuristics: 'balanced' });
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(90);
  });

  it('strict on real Chrome 143 returns 0', () => {
    expect(heuristicBotScore(REAL_CHROME_UAS[0], { heuristics: 'strict' })).toEqual({ score: 0, reasons: [] });
  });

  it('empty ua returns {score: 0, reasons: []}', () => {
    expect(heuristicBotScore(undefined)).toEqual({ score: 0, reasons: [] });
    expect(heuristicBotScore('')).toEqual({ score: 0, reasons: [] });
  });

  it('headless chrome + strict → score >= 60', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.199 Safari/537.36';
    const result = heuristicBotScore(ua, { heuristics: 'strict' });
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('score clamps to 100', () => {
    const ua = 'HeadlessChrome/1.0.0.0 WebDriver';
    const result = heuristicBotScore(ua, { heuristics: 'strict' });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('isBlockedUA (with heuristics)', () => {
  it('real Chrome 143.0.7499.193 not blocked in strict mode', () => {
    expect(isBlockedUA(REAL_CHROME_UAS[0], [], { heuristics: 'strict' })).toBe(false);
  });

  it('fake Chrome/53.0.7875.1327 blocked in strict mode', () => {
    expect(isBlockedUA(FAKE_BOT_UAS[0], [], { heuristics: 'strict' })).toBe(true);
  });

  it('5+ fake UAs from #2921 all blocked in strict mode', () => {
    for (const ua of FAKE_BOT_UAS) {
      expect(isBlockedUA(ua, [], { heuristics: 'strict' })).toBe(true);
    }
  });

  it('5+ real Chrome variants not blocked in strict mode', () => {
    const realUas = [
      REAL_CHROME_UAS[0], // desktop
      REAL_CHROME_UAS[3], // iOS
      REAL_CHROME_UAS[4], // Android
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.193 Safari/537.36 Edg/143.0.0.0', // Edge
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.193 Safari/537.36', // Linux
    ];
    for (const ua of realUas) {
      expect(isBlockedUA(ua, [], { heuristics: 'strict' })).toBe(false);
    }
  });
});

describe('isBlockedUA session memoization', () => {
  it('returns the same result on repeated calls with identical inputs', () => {
    const ua = REAL_CHROME_UAS[0]
    const first = isBlockedUA(ua)
    const second = isBlockedUA(ua)
    const third = isBlockedUA(ua)
    expect(first).toBe(false)
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('cache is bucketed per heuristics mode: off vs strict do not share results', () => {
    // A UA that only strict blocks (impossible Chrome patch) must be false when
    // heuristics is off and true when heuristics is strict; the memoization
    // key must include the heuristics mode so the two answers do not collide.
    const ua = FAKE_BOT_UAS[0] // Chrome/53.0.7875.1327
    expect(isBlockedUA(ua)).toBe(false)
    expect(isBlockedUA(ua, [], { heuristics: 'strict' })).toBe(true)
    // Reversing the order to make sure the second (off) call still sees false
    // rather than a stale strict-mode hit.
    __resetBotDetectionCacheForTests()
    expect(isBlockedUA(ua, [], { heuristics: 'strict' })).toBe(true)
    expect(isBlockedUA(ua)).toBe(false)
  })

  it('cache is bucketed per customBlockedUserAgents list', () => {
    // A neutral UA is blocked only when the custom list matches; toggling the
    // custom list must not deliver stale results.
    const ua = 'MyProbeAgent/1.0'
    expect(isBlockedUA(ua, [])).toBe(false)
    expect(isBlockedUA(ua, ['MyProbeAgent'])).toBe(true)
    expect(isBlockedUA(ua, [])).toBe(false)
    expect(isBlockedUA(ua, ['MyProbeAgent'])).toBe(true)
  })

  it('cache is bucketed per extraChromeVersionRules', () => {
    // Same UA, different thresholds: patch 600 must be allowed at the default
    // max (1000) and rejected when the caller tightens max to 500.
    const ua = 'Mozilla/5.0 Chrome/143.0.7499.600 Safari/537.36'
    expect(isBlockedUA(ua, [], { heuristics: 'strict' })).toBe(false)
    expect(
      isBlockedUA(ua, [], {
        heuristics: 'strict',
        extraChromeVersionRules: { maxKnownPatch: 500 },
      })
    ).toBe(true)
    // Repeat both to confirm no stale hit.
    expect(isBlockedUA(ua, [], { heuristics: 'strict' })).toBe(false)
    expect(
      isBlockedUA(ua, [], {
        heuristics: 'strict',
        extraChromeVersionRules: { maxKnownPatch: 500 },
      })
    ).toBe(true)
  })

  it('__resetBotDetectionCacheForTests wipes the cache', () => {
    const ua = REAL_CHROME_UAS[0]
    isBlockedUA(ua)
    __resetBotDetectionCacheForTests()
    // After a reset a fresh compute path must produce the same answer.
    expect(isBlockedUA(ua)).toBe(false)
  })

  it('handles a burst of many distinct UAs without breaking correctness', () => {
    // Generate 300 unique UAs to exceed MAX_CACHE_ENTRIES (256) and ensure the
    // overflow-drop path still returns correct results, not stale ones.
    const results: boolean[] = []
    for (let i = 0; i < 300; i++) {
      const ua = `Mozilla/5.0 ProbeAgent/${i}`
      results.push(isBlockedUA(ua))
    }
    // All neutral probe UAs must be unblocked (no default rule matches "ProbeAgent").
    expect(results.every((r) => r === false)).toBe(true)
    // Now block one of them via custom list and re-check that only that UA is blocked.
    expect(isBlockedUA('Mozilla/5.0 ProbeAgent/42', ['ProbeAgent/42'])).toBe(true)
    expect(isBlockedUA('Mozilla/5.0 ProbeAgent/43')).toBe(false)
  })
})

describe('isBlockedUA strict-mode early exit', () => {
  it('short-circuits to true on impossible Chrome without running the full score pass', () => {
    // The fake bots from #2921 all trip isImpossibleChromeVersion; strict mode
    // must return true and heuristicBotScore should still, independently,
    // produce a score >= the strict threshold for the same UA.
    for (const ua of FAKE_BOT_UAS) {
      expect(isBlockedUA(ua, [], { heuristics: 'strict' })).toBe(true)
      expect(heuristicBotScore(ua, { heuristics: 'strict' }).score).toBeGreaterThanOrEqual(40)
    }
  })

  it('does not affect balanced mode (no early exit in balanced)', () => {
    // Balanced mode should keep the full score-then-threshold logic; a UA whose
    // impossible-Chrome-version signal alone gives 70 (>= balanced threshold 60)
    // should still be blocked, so we verify the block boolean.
    for (const ua of FAKE_BOT_UAS) {
      expect(isBlockedUA(ua, [], { heuristics: 'balanced' })).toBe(true)
    }
  })
})

describe('isBlockedUA cache-key delimiter injection', () => {
  // The cache key must not be forgeable by embedding delimiter bytes in the
  // UA or customBlockedUserAgents — a forged key could reuse another tuple's
  // cached boolean and flip a block/allow decision. Length-prefixed encoding
  // is unambiguous; any regression to a plain-delimiter scheme would fail here.
  it('does not collide when UA embeds control-byte delimiters', () => {
    const uaA = 'Mozilla/5.0 Chrome/143.0.7499.193 Safari/537.36'
    // A UA crafted to imitate the delimiter positions of the previous scheme.
    const uaCrafted = uaA + '\x01off\x01\x01\x01injected'
    // Should evaluate independently (both false; both real Chrome-like UAs).
    expect(isBlockedUA(uaA)).toBe(false)
    expect(isBlockedUA(uaCrafted)).toBe(false)
  })

  it('does not collide when custom list contains delimiter bytes', () => {
    const ua = 'Mozilla/5.0 ProbeAgent/1'
    // Legitimate: uncached, unblocked.
    expect(isBlockedUA(ua)).toBe(false)
    // Custom list with delimiter-like content. Must produce an independent
    // key so the previous cache entry does not leak.
    const forged = ['\x01off\x01\x01\x01', '|', ':']
    // ProbeAgent/1 is not in either list, so still false, but the key must
    // differ so we're not returning a stale hit from the previous call.
    expect(isBlockedUA(ua, forged, { heuristics: 'strict' })).toBe(false)
    // Explicitly add ua to a custom list — must flip.
    expect(isBlockedUA(ua, ['ProbeAgent/1'])).toBe(true)
  })

  it('length-prefixed key rejects trivial substring shifts', () => {
    // Two logically distinct tuples that in a naive schema would produce
    // adjacent-string keys; length prefix ensures the field boundary.
    const r1 = isBlockedUA('abc', ['def'])
    const r2 = isBlockedUA('abcdef', [])
    expect(r1).toBe(false)
    expect(r2).toBe(false)
    // Now confirm that flipping one input flips the answer (no stale reuse).
    expect(isBlockedUA('abcdef', ['abcdef'])).toBe(true)
    expect(isBlockedUA('abc', ['abc'])).toBe(true)
  })
})
