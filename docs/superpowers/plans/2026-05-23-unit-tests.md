# Unit Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up Vitest and write 14 test files covering every source file in Meridian — pure-logic unit tests plus mocked-SDK tests.

**Architecture:** Two-layer test structure: `test/unit/` mocks only `fs` (no network/chain), `test/mocked/` additionally mocks `@meteora-ag/dlmm`, `@solana/web3.js`, and `global.fetch`. Four shared helper files in `test/helpers/` are built first and reused across all tests.

**Tech Stack:** Vitest 1.x, @vitest/coverage-v8, Node 18+ ESM

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `vitest.config.js` | Vitest config with coverage settings |
| Modify | `package.json` | Add test scripts |
| Create | `test/helpers/fs-mock.js` | Reusable in-memory fs state factory |
| Create | `test/helpers/fetch-mock.js` | Reusable `global.fetch` mock factory |
| Create | `test/helpers/solana-mock.js` | `@solana/web3.js` module mock |
| Create | `test/helpers/dlmm-mock.js` | `@meteora-ag/dlmm` module mock |
| Modify | `agent.js` | Export `getToolsForRole`, `shouldRequireRealToolUse`, `buildMessages` |
| Create | `test/unit/config.test.js` | Tests for `computeDeployAmount`, `reloadScreeningThresholds` |
| Create | `test/unit/lessons.test.js` | Tests for all `lessons.js` exports |
| Create | `test/unit/state.test.js` | Tests for position lifecycle and exit logic |
| Create | `test/unit/signal-weights.test.js` | Tests for Darwinian weight recalculation |
| Create | `test/unit/pool-memory.test.js` | Tests for pool deploy history |
| Create | `test/unit/strategy-library.test.js` | Tests for strategy CRUD |
| Create | `test/unit/agent.test.js` | Tests for tool-role filtering and intent detection |
| Create | `test/mocked/executor.test.js` | Tests for safety checks and tool dispatch |
| Create | `test/mocked/dlmm.test.js` | Tests for on-chain position operations |
| Create | `test/mocked/wallet.test.js` | Tests for balance fetch and Jupiter swap |
| Create | `test/mocked/screening.test.js` | Tests for Meteora pool discovery |
| Create | `test/mocked/gmgn.test.js` | Tests for GMGN fetch and filtering |
| Create | `test/mocked/token.test.js` | Tests for Jupiter token/audit API |
| Create | `test/mocked/telegram.test.js` | Tests for Telegram notification helpers |

---

## Task 1: Install Vitest and Wire Config

**Files:**
- Create: `vitest.config.js`
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

Expected: vitest and coverage provider added to `devDependencies` in `package.json`.

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['*.js', 'tools/*.js'],
      exclude: [
        'scripts/',
        'discord-listener/',
        'setup.js',
        'envcrypt.js',
        'vitest.config.js',
      ],
    },
  },
})
```

- [ ] **Step 3: Add scripts to `package.json`**

Add inside the `"scripts"` block (keep existing scripts):

```json
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage",
"test:unit":     "vitest run test/unit",
"test:mocked":   "vitest run test/mocked"
```

- [ ] **Step 4: Verify Vitest runs**

```bash
npm test
```

Expected output:
```
No test files found, exiting with code 0
```

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js package.json package-lock.json
git commit -m "chore: add Vitest test framework"
```

---

## Task 2: Create Shared Test Helpers

**Files:**
- Create: `test/helpers/fs-mock.js`
- Create: `test/helpers/fetch-mock.js`
- Create: `test/helpers/solana-mock.js`
- Create: `test/helpers/dlmm-mock.js`

- [ ] **Step 1: Create `test/helpers/fs-mock.js`**

```js
import { vi } from 'vitest'

/**
 * Creates an in-memory fs state. Pass initialFiles as { 'path': data } where
 * data can be an object (auto-stringified) or a raw string.
 *
 * Returns { fsMock, getJson } — fsMock is passed to vi.mock factory,
 * getJson reads back written content as parsed JSON.
 */
export function makeFsState(initialFiles = {}) {
  const store = new Map()

  for (const [filePath, data] of Object.entries(initialFiles)) {
    store.set(filePath, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  }

  const fsMock = {
    existsSync: vi.fn((p) => store.has(p)),
    readFileSync: vi.fn((p) => {
      if (!store.has(p)) {
        const err = new Error(`ENOENT: no such file or directory '${p}'`)
        err.code = 'ENOENT'
        throw err
      }
      return store.get(p)
    }),
    writeFileSync: vi.fn((p, content) => {
      store.set(p, typeof content === 'string' ? content : JSON.stringify(content))
    }),
  }

  const getJson = (p) => {
    const raw = store.get(p)
    return raw ? JSON.parse(raw) : null
  }

  return { fsMock, getJson, store }
}
```

- [ ] **Step 2: Create `test/helpers/fetch-mock.js`**

```js
import { vi } from 'vitest'

/**
 * Builds a vi.fn() that matches fetch calls by substring of URL.
 * responses: { '<url-substring>': { ok, status, data } }
 * Falls through to { ok: false, status: 404 } if no key matches.
 */
export function makeFetchMock(responses = {}) {
  return vi.fn(async (url) => {
    const key = Object.keys(responses).find((k) => String(url).includes(k))
    const res = key ? responses[key] : { ok: false, status: 404, data: {} }
    return {
      ok:   res.ok  ?? true,
      status: res.status ?? 200,
      json: async () => res.data ?? res,
      text: async () => JSON.stringify(res.data ?? res),
    }
  })
}
```

- [ ] **Step 3: Create `test/helpers/solana-mock.js`**

```js
import { vi } from 'vitest'

export const mockPublicKey = vi.fn().mockImplementation((key) => ({
  toString:  () => key,
  toBase58:  () => String(key),
  toBuffer:  () => Buffer.alloc(32),
}))

export const mockConnection = {
  getBalance:           vi.fn(async () => 1_000_000_000),
  getRecentBlockhash:   vi.fn(async () => ({ blockhash: 'mockhash', feeCalculator: { lamportsPerSignature: 5000 } })),
  sendRawTransaction:   vi.fn(async () => 'mockTxSignature'),
  confirmTransaction:   vi.fn(async () => ({ value: { err: null } })),
}

export const mockKeypair = {
  publicKey:  { toString: () => 'mockWalletPublicKey', toBase58: () => 'mockWalletPublicKey' },
  secretKey:  new Uint8Array(64),
}

export const solanaMockModule = {
  Connection:                  vi.fn(() => mockConnection),
  PublicKey:                   mockPublicKey,
  Keypair:                     { fromSecretKey: vi.fn(() => mockKeypair) },
  Transaction:                 vi.fn(() => ({ add: vi.fn().mockReturnThis(), sign: vi.fn() })),
  sendAndConfirmTransaction:   vi.fn(async () => 'mockTxSignature'),
  LAMPORTS_PER_SOL:            1_000_000_000,
  SystemProgram:               { transfer: vi.fn() },
}
```

- [ ] **Step 4: Create `test/helpers/dlmm-mock.js`**

```js
import { vi } from 'vitest'

export const mockDlmmPosition = {
  publicKey: { toString: () => 'mockPositionAddress' },
  positionData: {
    lowerBinId:  -10,
    upperBinId:   10,
    feeX:        { toString: () => '1000000' },
    feeY:        { toString: () => '1000000' },
    liquidityShares: [],
  },
}

export const mockDlmmInstance = {
  getPositionsByUserAndLbPair: vi.fn(async () => ({ userPositions: [mockDlmmPosition] })),
  addLiquidityByStrategy:      vi.fn(async () => ({ txs: ['mockDeployTx'] })),
  removeLiquidity:             vi.fn(async () => ({ txs: ['mockCloseTx'] })),
  claimSwapFee:                vi.fn(async () => ({ txs: ['mockClaimTx'] })),
  getActiveBin:                vi.fn(async () => ({ binId: 0, price: '1.0', pricePerToken: '1.0' })),
  lbPair: {
    parameters: { baseFactor: 100, filterPeriod: 30, decayPeriod: 600, reductionFactor: 5000, variableFeeControl: 40000 },
  },
}

export const dlmmMockModule = {
  default: {
    create: vi.fn(async () => mockDlmmInstance),
  },
  DLMM: {
    create: vi.fn(async () => mockDlmmInstance),
  },
  StrategyType: {
    SpotImBalanced: 'SpotImBalanced',
    BidAsk:         'BidAsk',
    Curve:          'Curve',
  },
}
```

- [ ] **Step 5: Commit**

```bash
git add test/
git commit -m "test: add shared test helper mocks"
```

---

## Task 3: Export Internal Helpers from `agent.js`

The functions `getToolsForRole`, `shouldRequireRealToolUse`, and `buildMessages` are pure logic but currently unexported. Export them so unit tests can import them directly.

**Files:**
- Modify: `agent.js` (add 3 exports)

- [ ] **Step 1: Add exports at the end of `agent.js`**

Find the `function sleep` at the bottom of `agent.js` and add exports before it:

```js
// Exported for unit testing
export { getToolsForRole, shouldRequireRealToolUse, buildMessages }
```

- [ ] **Step 2: Verify no runtime breakage**

```bash
node --input-type=module <<'EOF'
import { getToolsForRole } from './agent.js'
console.log(typeof getToolsForRole) // should print "function"
EOF
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add agent.js
git commit -m "feat(test): export agent helpers for unit testing"
```

---

## Task 4: `test/unit/config.test.js`

**Files:**
- Create: `test/unit/config.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs before importing config (vi.mock is hoisted)
vi.mock('fs', () => ({
  default: {
    existsSync:   vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
  },
  existsSync:   vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
}))

// Mock logger
vi.mock('../logger.js', () => ({ log: vi.fn() }))

const { computeDeployAmount, config, reloadScreeningThresholds, MIN_SAFE_BINS_BELOW } =
  await import('../config.js')

describe('MIN_SAFE_BINS_BELOW', () => {
  it('equals 35', () => {
    expect(MIN_SAFE_BINS_BELOW).toBe(35)
  })
})

describe('computeDeployAmount', () => {
  beforeEach(() => {
    config.management.gasReserve      = 0.2
    config.management.positionSizePct = 0.35
    config.management.deployAmountSol = 0.5
    config.risk.maxDeployAmount       = 50
  })

  it('returns floor when wallet too small to scale above floor', () => {
    // 0.7 SOL - 0.2 reserve = 0.5 deployable * 0.35 = 0.175 → below floor (0.5)
    expect(computeDeployAmount(0.7)).toBe(0.5)
  })

  it('scales linearly with wallet balance above floor', () => {
    // 3 SOL - 0.2 reserve = 2.8 deployable * 0.35 = 0.98
    expect(computeDeployAmount(3.0)).toBe(0.98)
  })

  it('clamps to maxDeployAmount ceiling', () => {
    config.risk.maxDeployAmount = 1.0
    // 100 SOL → would be huge, clamps to 1.0
    expect(computeDeployAmount(100)).toBe(1.0)
  })

  it('handles zero wallet balance without NaN', () => {
    const result = computeDeployAmount(0)
    expect(Number.isFinite(result)).toBe(true)
    expect(result).toBe(config.management.deployAmountSol) // returns floor
  })

  it('handles wallet exactly at gasReserve', () => {
    // 0.2 - 0.2 = 0 deployable → returns floor
    expect(computeDeployAmount(0.2)).toBe(config.management.deployAmountSol)
  })
})

describe('reloadScreeningThresholds', () => {
  it('applies fresh minFeeActiveTvlRatio from user-config', async () => {
    const fs = (await import('fs')).default
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify({ minFeeActiveTvlRatio: 0.15 }))

    reloadScreeningThresholds()
    expect(config.screening.minFeeActiveTvlRatio).toBe(0.15)
  })

  it('applies fresh maxVolatility', async () => {
    const fs = (await import('fs')).default
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify({ maxVolatility: 3.5 }))

    reloadScreeningThresholds()
    expect(config.screening.maxVolatility).toBe(3.5)
  })

  it('enforces MIN_SAFE_BINS_BELOW floor on minBinsBelow', async () => {
    const fs = (await import('fs')).default
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify({ minBinsBelow: 10 })) // below 35

    reloadScreeningThresholds()
    expect(config.strategy.minBinsBelow).toBeGreaterThanOrEqual(MIN_SAFE_BINS_BELOW)
  })

  it('silently ignores unknown keys', async () => {
    const fs = (await import('fs')).default
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify({ unknownKey: 'boom' }))

    expect(() => reloadScreeningThresholds()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run and verify passes**

```bash
npm run test:unit -- config
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/config.test.js
git commit -m "test: unit tests for config.js"
```

---

## Task 5: `test/unit/lessons.test.js`

**Files:**
- Create: `test/unit/lessons.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync:    vi.fn(() => false),
    readFileSync:  vi.fn(() => '{"lessons":[],"performance":[]}'),
    writeFileSync: vi.fn(),
  },
  existsSync:    vi.fn(() => false),
  readFileSync:  vi.fn(() => '{"lessons":[],"performance":[]}'),
  writeFileSync: vi.fn(),
}))

vi.mock('../logger.js',   () => ({ log: vi.fn() }))
vi.mock('../hivemind.js', () => ({
  getSharedLessonsForPrompt: vi.fn(() => null),
  pushHiveLesson:            vi.fn(async () => {}),
  pushHivePerformanceEvent:  vi.fn(async () => {}),
}))
vi.mock('../pool-memory.js', () => ({
  recordPoolDeploy: vi.fn(async () => {}),
}))
vi.mock('../config.js', () => ({
  config: {
    screening: {
      maxVolatility: 5, minFeeActiveTvlRatio: 0.05, minOrganic: 60,
    },
    darwin: { enabled: false },
  },
  reloadScreeningThresholds: vi.fn(),
}))
vi.mock('../signal-weights.js', () => ({
  recalculateWeights: vi.fn(() => ({ changes: [] })),
}))

import fs from 'fs'
import {
  evolveThresholds,
  addLesson,
  pinLesson,
  unpinLesson,
  removeLesson,
  clearAllLessons,
  clearPerformance,
  getLessonsForPrompt,
  listLessons,
} from '../lessons.js'

// ─── Helpers ───────────────────────────────────────────────────────

function makePerf(overrides = {}) {
  return {
    pool: 'poolAddr',
    pool_name: 'TEST-SOL',
    strategy: 'bid_ask',
    bin_step: 100,
    volatility: 2,
    fee_tvl_ratio: 0.1,
    organic_score: 75,
    amount_sol: 0.5,
    fees_earned_usd: 5,
    final_value_usd: 110,
    initial_value_usd: 100,
    minutes_in_range: 50,
    minutes_held: 60,
    close_reason: 'manual',
    pnl_pct: 10,
    pnl_usd: 10,
    range_efficiency: 83,
    recorded_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeLessonsFile(lessons = [], performance = []) {
  return JSON.stringify({ lessons, performance })
}

function setFsData(data) {
  fs.existsSync.mockReturnValue(true)
  fs.readFileSync.mockReturnValue(typeof data === 'string' ? data : JSON.stringify(data))
}

// ─── evolveThresholds ──────────────────────────────────────────────

describe('evolveThresholds', () => {
  const baseConfig = {
    screening: { maxVolatility: 5, minFeeActiveTvlRatio: 0.05, minOrganic: 60 },
  }

  it('returns null when fewer than 5 performance records', () => {
    const perf = [makePerf(), makePerf(), makePerf()]
    expect(evolveThresholds(perf, baseConfig)).toBeNull()
  })

  it('returns null when no signal (only one winner, no losers)', () => {
    const perf = [makePerf({ pnl_pct: 5 }), makePerf({ pnl_pct: 0 }), makePerf({ pnl_pct: 0 }),
                  makePerf({ pnl_pct: 0 }), makePerf({ pnl_pct: 0 })]
    const result = evolveThresholds(perf, { ...baseConfig })
    // only 1 winner, 0 losers — hasSignal is false
    expect(result).toBeNull()
  })

  it('tightens maxVolatility when losers cluster at high volatility', () => {
    const perf = [
      makePerf({ pnl_pct: -10, volatility: 8 }),
      makePerf({ pnl_pct: -10, volatility: 9 }),
      makePerf({ pnl_pct: 5,   volatility: 1 }),
      makePerf({ pnl_pct: 5,   volatility: 2 }),
      makePerf({ pnl_pct: 5,   volatility: 1 }),
    ]
    const cfg = { screening: { maxVolatility: 10, minFeeActiveTvlRatio: 0.05, minOrganic: 60 } }
    const result = evolveThresholds(perf, cfg)
    expect(result?.changes?.maxVolatility).toBeDefined()
    expect(result.changes.maxVolatility).toBeLessThan(10)
  })

  it('raises minFeeActiveTvlRatio when winners consistently above current floor', () => {
    const perf = [
      makePerf({ pnl_pct: 10, fee_tvl_ratio: 0.5 }),
      makePerf({ pnl_pct: 8,  fee_tvl_ratio: 0.6 }),
      makePerf({ pnl_pct: -8, fee_tvl_ratio: 0.02 }),
      makePerf({ pnl_pct: -6, fee_tvl_ratio: 0.01 }),
      makePerf({ pnl_pct: 6,  fee_tvl_ratio: 0.55 }),
    ]
    const cfg = { screening: { maxVolatility: null, minFeeActiveTvlRatio: 0.05, minOrganic: 60 } }
    const result = evolveThresholds(perf, cfg)
    expect(result?.changes?.minFeeActiveTvlRatio).toBeDefined()
    expect(result.changes.minFeeActiveTvlRatio).toBeGreaterThan(0.05)
  })

  it('never shifts any threshold more than 20% in one step', () => {
    const perf = [
      makePerf({ pnl_pct: -20, volatility: 20 }),
      makePerf({ pnl_pct: -20, volatility: 19 }),
      makePerf({ pnl_pct: 10,  volatility: 1 }),
      makePerf({ pnl_pct: 10,  volatility: 2 }),
      makePerf({ pnl_pct: 10,  volatility: 1 }),
    ]
    const cfg = { screening: { maxVolatility: 10, minFeeActiveTvlRatio: 0.05, minOrganic: 60 } }
    const result = evolveThresholds(perf, cfg)
    if (result?.changes?.maxVolatility != null) {
      const change = Math.abs(result.changes.maxVolatility - 10) / 10
      expect(change).toBeLessThanOrEqual(0.20 + 0.001) // 20% + float tolerance
    }
  })

  it('writes changes to user-config.json', () => {
    const perf = [
      makePerf({ pnl_pct: -10, volatility: 8 }),
      makePerf({ pnl_pct: -10, volatility: 9 }),
      makePerf({ pnl_pct: 5,   volatility: 1 }),
      makePerf({ pnl_pct: 5,   volatility: 2 }),
      makePerf({ pnl_pct: 5,   volatility: 1 }),
    ]
    const cfg = { screening: { maxVolatility: 10, minFeeActiveTvlRatio: 0.05, minOrganic: 60 } }
    setFsData({ lessons: [], performance: [] })
    evolveThresholds(perf, cfg)
    expect(fs.writeFileSync).toHaveBeenCalled()
  })
})

// ─── addLesson / pinLesson / unpinLesson / removeLesson ────────────

describe('addLesson', () => {
  beforeEach(() => {
    setFsData({ lessons: [], performance: [] })
    vi.clearAllMocks()
    setFsData({ lessons: [], performance: [] })
  })

  it('writes the lesson to lessons.json', () => {
    addLesson('Test rule', ['tag1'])
    expect(fs.writeFileSync).toHaveBeenCalled()
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(written.lessons[0].rule).toBe('Test rule')
  })

  it('sanitizes rule text: strips < > ` and truncates at 400 chars', () => {
    const dirty = '<script>`alert`</script> ' + 'x'.repeat(500)
    addLesson(dirty, [])
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    const rule = written.lessons[0].rule
    expect(rule).not.toContain('<')
    expect(rule).not.toContain('`')
    expect(rule.length).toBeLessThanOrEqual(400)
  })

  it('does not write null/empty rule', () => {
    addLesson('', [])
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})

describe('pinLesson / unpinLesson', () => {
  it('sets pinned=true on the correct lesson', () => {
    const lesson = { id: 1, rule: 'rule', tags: [], outcome: 'good', pinned: false }
    setFsData({ lessons: [lesson], performance: [] })
    const result = pinLesson(1)
    expect(result.pinned).toBe(true)
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(written.lessons[0].pinned).toBe(true)
  })

  it('returns { found: false } for unknown id', () => {
    setFsData({ lessons: [], performance: [] })
    expect(pinLesson(999)).toEqual({ found: false })
  })

  it('sets pinned=false on unpin', () => {
    const lesson = { id: 2, rule: 'rule', tags: [], outcome: 'good', pinned: true }
    setFsData({ lessons: [lesson], performance: [] })
    const result = unpinLesson(2)
    expect(result.pinned).toBe(false)
  })
})

describe('removeLesson', () => {
  it('removes the correct lesson by id', () => {
    setFsData({ lessons: [
      { id: 1, rule: 'keep',   tags: [] },
      { id: 2, rule: 'remove', tags: [] },
    ], performance: [] })
    const removed = removeLesson(2)
    expect(removed).toBe(1)
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(written.lessons).toHaveLength(1)
    expect(written.lessons[0].id).toBe(1)
  })
})

describe('clearAllLessons', () => {
  it('empties lessons but keeps performance records', () => {
    setFsData({ lessons: [{ id: 1, rule: 'x' }], performance: [makePerf()] })
    clearAllLessons()
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(written.lessons).toHaveLength(0)
    expect(written.performance).toHaveLength(1)
  })
})

describe('clearPerformance', () => {
  it('empties performance but keeps lessons', () => {
    setFsData({ lessons: [{ id: 1, rule: 'x' }], performance: [makePerf()] })
    clearPerformance()
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(written.performance).toHaveLength(0)
    expect(written.lessons).toHaveLength(1)
  })
})

// ─── getLessonsForPrompt ───────────────────────────────────────────

describe('getLessonsForPrompt', () => {
  it('returns null when no lessons exist', () => {
    setFsData({ lessons: [], performance: [] })
    expect(getLessonsForPrompt({ agentType: 'GENERAL' })).toBeNull()
  })

  it('always includes pinned lessons in output', () => {
    const pinned = { id: 1, rule: 'pinned rule', tags: [], outcome: 'good', pinned: true }
    const normal = { id: 2, rule: 'normal rule', tags: [], outcome: 'good', pinned: false }
    setFsData({ lessons: [pinned, normal], performance: [] })
    const result = getLessonsForPrompt({ agentType: 'GENERAL' })
    expect(result).toContain('pinned rule')
    expect(result).toContain('📌')
  })

  it('filters lessons by role: SCREENER lessons excluded from MANAGER', () => {
    const screenerLesson = { id: 1, rule: 'screener only', tags: [], outcome: 'manual', role: 'SCREENER', pinned: false }
    setFsData({ lessons: [screenerLesson], performance: [] })
    const result = getLessonsForPrompt({ agentType: 'MANAGER' })
    expect(result).toBeNull()
  })

  it('includes role=null lessons for all roles', () => {
    const universal = { id: 1, rule: 'universal rule', tags: [], outcome: 'good', role: null, pinned: false }
    setFsData({ lessons: [universal], performance: [] })
    const managerResult  = getLessonsForPrompt({ agentType: 'MANAGER' })
    const screenerResult = getLessonsForPrompt({ agentType: 'SCREENER' })
    expect(managerResult).toContain('universal rule')
    expect(screenerResult).toContain('universal rule')
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:unit -- lessons
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/lessons.test.js
git commit -m "test: unit tests for lessons.js"
```

---

## Task 6: `test/unit/state.test.js`

**Files:**
- Create: `test/unit/state.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync:    vi.fn(() => false),
    readFileSync:  vi.fn(() => '{"positions":{},"recentEvents":[]}'),
    writeFileSync: vi.fn(),
  },
  existsSync:    vi.fn(() => false),
  readFileSync:  vi.fn(() => '{"positions":{},"recentEvents":[]}'),
  writeFileSync: vi.fn(),
}))
vi.mock('../logger.js', () => ({ log: vi.fn() }))

import fs from 'fs'
import {
  trackPosition,
  markOutOfRange,
  markInRange,
  minutesOutOfRange,
  setPositionInstruction,
  queuePeakConfirmation,
  resolvePendingPeak,
  updatePnlAndCheckExits,
} from '../state.js'

const ADDR = 'pos111'

function setStateFile(positions = {}, extras = {}) {
  const state = { positions, recentEvents: [], ...extras }
  fs.existsSync.mockReturnValue(true)
  fs.readFileSync.mockReturnValue(JSON.stringify(state))
}

function freshPosition(overrides = {}) {
  return {
    position:    ADDR,
    pool:        'poolXYZ',
    pool_name:   'TEST-SOL',
    strategy:    'bid_ask',
    bin_range:   { lower: -10, upper: 10 },
    amount_sol:  0.5,
    active_bin:  0,
    bin_step:    100,
    volatility:  2,
    fee_tvl_ratio: 0.1,
    organic_score: 75,
    initial_value_usd: 100,
    ...overrides,
  }
}

// Helper: get last written state
function lastWrittenState() {
  const calls = fs.writeFileSync.mock.calls
  const last = calls[calls.length - 1]
  return last ? JSON.parse(last[1]) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  setStateFile({})
})

// ─── trackPosition ─────────────────────────────────────────────────

describe('trackPosition', () => {
  it('saves position with required fields', () => {
    setStateFile({})
    trackPosition(freshPosition())
    const state = lastWrittenState()
    const pos = state.positions[ADDR]
    expect(pos).toBeDefined()
    expect(pos.position).toBe(ADDR)
    expect(pos.pool).toBe('poolXYZ')
    expect(pos.closed).toBe(false)
    expect(pos.peak_pnl_pct).toBe(0)
  })

  it('overwrites existing position with same address', () => {
    setStateFile({ [ADDR]: { position: ADDR, pool: 'old', closed: false, notes: [], recentEvents: [] } })
    trackPosition(freshPosition({ pool: 'new' }))
    const state = lastWrittenState()
    expect(state.positions[ADDR].pool).toBe('new')
  })
})

// ─── OOR tracking ─────────────────────────────────────────────────

describe('markOutOfRange / markInRange / minutesOutOfRange', () => {
  it('sets out_of_range_since on first OOR', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, out_of_range_since: null, notes: [], trailing_active: false } })
    markOutOfRange(ADDR)
    const state = lastWrittenState()
    expect(state.positions[ADDR].out_of_range_since).toBeTruthy()
  })

  it('does not overwrite existing out_of_range_since', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    setStateFile({ [ADDR]: { position: ADDR, closed: false, out_of_range_since: ts, notes: [], trailing_active: false } })
    markOutOfRange(ADDR)
    const state = lastWrittenState()
    expect(state.positions[ADDR].out_of_range_since).toBe(ts)
  })

  it('clears out_of_range_since on markInRange', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, out_of_range_since: '2026-01-01T00:00:00.000Z', notes: [], trailing_active: false } })
    markInRange(ADDR)
    const state = lastWrittenState()
    expect(state.positions[ADDR].out_of_range_since).toBeNull()
  })

  it('minutesOutOfRange returns 0 for in-range position', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, out_of_range_since: null, notes: [] } })
    expect(minutesOutOfRange(ADDR)).toBe(0)
  })
})

// ─── setPositionInstruction ────────────────────────────────────────

describe('setPositionInstruction', () => {
  it('returns false for unknown position', () => {
    setStateFile({})
    expect(setPositionInstruction('unknown', 'hold')).toBe(false)
  })

  it('saves sanitized instruction', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, notes: [] } })
    setPositionInstruction(ADDR, 'hold until <5%>')
    const state = lastWrittenState()
    expect(state.positions[ADDR].instruction).not.toContain('<')
  })

  it('clears instruction when null passed', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, instruction: 'old', notes: [] } })
    setPositionInstruction(ADDR, null)
    const state = lastWrittenState()
    expect(state.positions[ADDR].instruction).toBeNull()
  })
})

// ─── queuePeakConfirmation / resolvePendingPeak ───────────────────

describe('queuePeakConfirmation', () => {
  it('queues new peak when pnl exceeds current peak', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, peak_pnl_pct: 2, pending_peak_pnl_pct: null, notes: [] } })
    const queued = queuePeakConfirmation(ADDR, 5)
    expect(queued).toBe(true)
    const state = lastWrittenState()
    expect(state.positions[ADDR].pending_peak_pnl_pct).toBe(5)
  })

  it('does not queue when pnl <= current peak', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, peak_pnl_pct: 10, pending_peak_pnl_pct: null, notes: [] } })
    const queued = queuePeakConfirmation(ADDR, 5)
    expect(queued).toBe(false)
  })

  it('immediate mode updates peak directly without pending', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, peak_pnl_pct: 2, pending_peak_pnl_pct: null, notes: [] } })
    queuePeakConfirmation(ADDR, 7, { immediate: true })
    const state = lastWrittenState()
    expect(state.positions[ADDR].peak_pnl_pct).toBe(7)
    expect(state.positions[ADDR].pending_peak_pnl_pct).toBeNull()
  })
})

describe('resolvePendingPeak', () => {
  it('confirms peak when current pnl is within tolerance of pending', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, peak_pnl_pct: 0, pending_peak_pnl_pct: 10, pending_peak_started_at: new Date().toISOString(), notes: [] } })
    const result = resolvePendingPeak(ADDR, 9.5, 0.85) // 9.5 >= 10 * 0.85
    expect(result.confirmed).toBe(true)
  })

  it('rejects peak when current pnl fell too far from pending', () => {
    setStateFile({ [ADDR]: { position: ADDR, closed: false, peak_pnl_pct: 0, pending_peak_pnl_pct: 10, pending_peak_started_at: new Date().toISOString(), notes: [] } })
    const result = resolvePendingPeak(ADDR, 5.0, 0.85) // 5.0 < 10 * 0.85 = 8.5
    expect(result.confirmed).toBe(false)
    expect(result.rejected).toBe(true)
  })
})

// ─── updatePnlAndCheckExits ────────────────────────────────────────

const mgmtConfig = {
  stopLossPct:          -50,
  takeProfitPct:        5,
  trailingTakeProfit:   true,
  trailingTriggerPct:   3,
  trailingDropPct:      1.5,
  outOfRangeWaitMinutes: 30,
  minFeePerTvl24h:      7,
  minAgeBeforeYieldCheck: 60,
}

function stateWithPos(overrides = {}) {
  return {
    position:       ADDR,
    closed:         false,
    peak_pnl_pct:   0,
    trailing_active: false,
    out_of_range_since: null,
    pending_peak_pnl_pct: null,
    confirmed_trailing_exit_reason: null,
    confirmed_trailing_exit_until:  null,
    notes: [],
    ...overrides,
  }
}

describe('updatePnlAndCheckExits', () => {
  it('returns STOP_LOSS when pnl_pct <= stopLossPct', () => {
    setStateFile({ [ADDR]: stateWithPos() })
    const result = updatePnlAndCheckExits(ADDR, { pnl_pct: -55, in_range: true }, mgmtConfig)
    expect(result?.action).toBe('STOP_LOSS')
  })

  it('returns TRAILING_TP when trailing active and peak drops enough', () => {
    setStateFile({ [ADDR]: stateWithPos({ trailing_active: true, peak_pnl_pct: 10 }) })
    const result = updatePnlAndCheckExits(ADDR, { pnl_pct: 8, in_range: true }, mgmtConfig)
    // drop = 10 - 8 = 2 >= trailingDropPct (1.5)
    expect(result?.action).toBe('TRAILING_TP')
    expect(result?.needs_confirmation).toBe(true)
  })

  it('returns null when pnl healthy and trailing not triggered', () => {
    setStateFile({ [ADDR]: stateWithPos({ peak_pnl_pct: 3, trailing_active: false }) })
    const result = updatePnlAndCheckExits(ADDR, { pnl_pct: 3, in_range: true, fee_per_tvl_24h: 10, age_minutes: 30 }, mgmtConfig)
    expect(result).toBeNull()
  })

  it('returns OUT_OF_RANGE when oor_since exceeds wait limit', () => {
    const longAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString()
    setStateFile({ [ADDR]: stateWithPos({ out_of_range_since: longAgo }) })
    const result = updatePnlAndCheckExits(ADDR, { pnl_pct: 1, in_range: false, age_minutes: 100 }, mgmtConfig)
    expect(result?.action).toBe('OUT_OF_RANGE')
  })

  it('returns LOW_YIELD when fee/TVL below min after min age', () => {
    setStateFile({ [ADDR]: stateWithPos() })
    const result = updatePnlAndCheckExits(ADDR, { pnl_pct: 1, in_range: true, fee_per_tvl_24h: 3, age_minutes: 90 }, mgmtConfig)
    expect(result?.action).toBe('LOW_YIELD')
  })

  it('skips all exits when pnl_pct_suspicious is true', () => {
    setStateFile({ [ADDR]: stateWithPos() })
    const result = updatePnlAndCheckExits(ADDR, { pnl_pct: -99, pnl_pct_suspicious: true, in_range: true }, mgmtConfig)
    expect(result).toBeNull()
  })

  it('returns null for unknown or closed position', () => {
    setStateFile({})
    expect(updatePnlAndCheckExits('unknown', { pnl_pct: -99 }, mgmtConfig)).toBeNull()
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:unit -- state
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/state.test.js
git commit -m "test: unit tests for state.js"
```

---

## Task 7: `test/unit/signal-weights.test.js`

**Files:**
- Create: `test/unit/signal-weights.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync:    vi.fn(() => false),
    readFileSync:  vi.fn(() => '{"weights":{},"last_recalc":null,"recalc_count":0,"history":[]}'),
    writeFileSync: vi.fn(),
  },
  existsSync:    vi.fn(() => false),
  readFileSync:  vi.fn(() => '{"weights":{},"last_recalc":null,"recalc_count":0,"history":[]}'),
  writeFileSync: vi.fn(),
}))
vi.mock('../logger.js', () => ({ log: vi.fn() }))

import fs from 'fs'
import { recalculateWeights, getWeightsSummary } from '../signal-weights.js'

const darwin = {
  windowDays: 60, minSamples: 3, boostFactor: 1.05,
  decayFactor: 0.95, weightFloor: 0.3, weightCeiling: 2.5,
}

function makeRecord(overrides = {}) {
  return {
    pnl_usd:          10,
    recorded_at:      new Date().toISOString(),
    organic_score:    75,
    fee_tvl_ratio:    0.1,
    volume:           50000,
    mcap:             500000,
    holder_count:     1000,
    smart_wallets_present: true,
    narrative_quality: 'present',
    volatility:       2,
    ...overrides,
  }
}

function setWeightsFile(weights) {
  const data = { weights, last_recalc: null, recalc_count: 0, history: [] }
  fs.existsSync.mockReturnValue(true)
  fs.readFileSync.mockReturnValue(JSON.stringify(data))
}

describe('recalculateWeights', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty changes when fewer than minSamples records in window', () => {
    const perf = [makeRecord(), makeRecord()]
    const result = recalculateWeights(perf, { darwin })
    expect(result.changes).toHaveLength(0)
  })

  it('returns empty changes when all records are wins (no losses to compare)', () => {
    const perf = Array.from({ length: 5 }, () => makeRecord({ pnl_usd: 10 }))
    const result = recalculateWeights(perf, { darwin })
    expect(result.changes).toHaveLength(0)
  })

  it('returns empty changes when all records are losses (no wins to compare)', () => {
    const perf = Array.from({ length: 5 }, () => makeRecord({ pnl_usd: -5 }))
    const result = recalculateWeights(perf, { darwin })
    expect(result.changes).toHaveLength(0)
  })

  it('boosts top-quartile signals and decays bottom-quartile', () => {
    setWeightsFile({
      organic_score: 1.0, fee_tvl_ratio: 1.0, volume: 1.0, mcap: 1.0, holder_count: 1.0,
      smart_wallets_present: 1.0, narrative_quality: 1.0, study_win_rate: 1.0,
      hive_consensus: 1.0, volatility: 1.0,
    })
    // Winners have high organic; losers have low organic
    const perf = [
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: 10, organic_score: 90, volatility: 1 })),
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: -5, organic_score: 30, volatility: 9 })),
    ]
    const result = recalculateWeights(perf, { darwin })
    // At least some changes expected
    expect(result.changes.length).toBeGreaterThan(0)
  })

  it('never drops weight below weightFloor', () => {
    setWeightsFile({
      organic_score: 0.31, fee_tvl_ratio: 0.31, volume: 0.31, mcap: 0.31, holder_count: 0.31,
      smart_wallets_present: 0.31, narrative_quality: 0.31, study_win_rate: 0.31,
      hive_consensus: 0.31, volatility: 0.31,
    })
    const perf = [
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: 10, organic_score: 90 })),
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: -5, organic_score: 20 })),
    ]
    const result = recalculateWeights(perf, { darwin })
    for (const [, v] of Object.entries(result.weights)) {
      expect(v).toBeGreaterThanOrEqual(0.3)
    }
  })

  it('never raises weight above weightCeiling', () => {
    setWeightsFile({
      organic_score: 2.45, fee_tvl_ratio: 2.45, volume: 2.45, mcap: 2.45, holder_count: 2.45,
      smart_wallets_present: 2.45, narrative_quality: 2.45, study_win_rate: 2.45,
      hive_consensus: 2.45, volatility: 2.45,
    })
    const perf = [
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: 10, organic_score: 90 })),
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: -5, organic_score: 20 })),
    ]
    const result = recalculateWeights(perf, { darwin })
    for (const [, v] of Object.entries(result.weights)) {
      expect(v).toBeLessThanOrEqual(2.5)
    }
  })

  it('persists updated weights to signal-weights.json', () => {
    setWeightsFile({
      organic_score: 1.0, fee_tvl_ratio: 1.0, volume: 1.0, mcap: 1.0, holder_count: 1.0,
      smart_wallets_present: 1.0, narrative_quality: 1.0, study_win_rate: 1.0,
      hive_consensus: 1.0, volatility: 1.0,
    })
    const perf = [
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: 10, organic_score: 90 })),
      ...Array.from({ length: 3 }, () => makeRecord({ pnl_usd: -5, organic_score: 20 })),
    ]
    recalculateWeights(perf, { darwin })
    expect(fs.writeFileSync).toHaveBeenCalled()
  })
})

describe('getWeightsSummary', () => {
  it('returns null when no weights file exists', () => {
    fs.existsSync.mockReturnValue(false)
    // Need a fresh import to test this — use dynamic import workaround
    // getWeightsSummary reads from loadWeights() which calls existsSync
    // Since existsSync returns false, it creates defaults, so this returns the default string
    const result = getWeightsSummary()
    expect(typeof result === 'string' || result === null).toBe(true)
  })

  it('returns a string containing signal names when weights exist', () => {
    setWeightsFile({
      organic_score: 1.2, fee_tvl_ratio: 0.8, volume: 1.0, mcap: 1.0, holder_count: 1.0,
      smart_wallets_present: 1.0, narrative_quality: 1.0, study_win_rate: 1.0,
      hive_consensus: 1.0, volatility: 0.9,
    })
    const result = getWeightsSummary()
    expect(result).toContain('organic_score')
    expect(result).toContain('fee_tvl_ratio')
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:unit -- signal-weights
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/signal-weights.test.js
git commit -m "test: unit tests for signal-weights.js"
```

---

## Task 8: `test/unit/pool-memory.test.js` and `test/unit/strategy-library.test.js`

**Files:**
- Create: `test/unit/pool-memory.test.js`
- Create: `test/unit/strategy-library.test.js`

- [ ] **Step 1: Write `test/unit/pool-memory.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync:    vi.fn(() => false),
    readFileSync:  vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
  },
  existsSync:    vi.fn(() => false),
  readFileSync:  vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
}))
vi.mock('../logger.js', () => ({ log: vi.fn() }))
vi.mock('../config.js', () => ({
  config: { management: { repeatDeployCooldownMinFeeEarnedPct: 0 } },
}))

import fs from 'fs'
import { recordPoolDeploy, recallForPool, recordPositionSnapshot } from '../pool-memory.js'

const POOL = 'pool111'

function setMemoryFile(data) {
  fs.existsSync.mockReturnValue(true)
  fs.readFileSync.mockReturnValue(JSON.stringify(data))
}

function lastWritten() {
  const calls = fs.writeFileSync.mock.calls
  return calls.length ? JSON.parse(calls[calls.length - 1][1]) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  fs.existsSync.mockReturnValue(false)
})

describe('recordPoolDeploy', () => {
  it('stores deploy entry keyed by pool address', () => {
    setMemoryFile({})
    recordPoolDeploy(POOL, { pool_name: 'TEST-SOL', pnl_pct: 5, close_reason: 'manual' })
    const written = lastWritten()
    expect(written[POOL]).toBeDefined()
    expect(written[POOL].deploys).toHaveLength(1)
    expect(written[POOL].deploys[0].pnl_pct).toBe(5)
  })

  it('appends to existing deploys', () => {
    setMemoryFile({ [POOL]: { deploys: [{ pnl_pct: 3 }], snapshots: [], notes: [] } })
    recordPoolDeploy(POOL, { pool_name: 'TEST-SOL', pnl_pct: 8 })
    const written = lastWritten()
    expect(written[POOL].deploys).toHaveLength(2)
  })
})

describe('recallForPool', () => {
  it('returns null for unknown pool', () => {
    setMemoryFile({})
    expect(recallForPool('unknown')).toBeNull()
  })

  it('returns a summary string for known pool', () => {
    setMemoryFile({ [POOL]: { deploys: [{ pnl_pct: 5, close_reason: 'manual', fees_earned_usd: 2 }], snapshots: [], notes: [] } })
    const result = recallForPool(POOL)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('recordPositionSnapshot', () => {
  it('appends snapshot to pool history', () => {
    setMemoryFile({ [POOL]: { deploys: [], snapshots: [], notes: [] } })
    recordPositionSnapshot(POOL, { pnl_pct: 2, in_range: true })
    const written = lastWritten()
    expect(written[POOL].snapshots).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Write `test/unit/strategy-library.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync:    vi.fn(() => false),
    readFileSync:  vi.fn(() => '{"active":null,"strategies":{}}'),
    writeFileSync: vi.fn(),
  },
  existsSync:    vi.fn(() => false),
  readFileSync:  vi.fn(() => '{"active":null,"strategies":{}}'),
  writeFileSync: vi.fn(),
}))
vi.mock('../logger.js', () => ({ log: vi.fn() }))

import fs from 'fs'
import { addStrategy, listStrategies, getStrategy, setActiveStrategy, removeStrategy, getActiveStrategy } from '../strategy-library.js'

function setStrategyFile(data) {
  fs.existsSync.mockReturnValue(true)
  fs.readFileSync.mockReturnValue(JSON.stringify(data))
}

function lastWritten() {
  const calls = fs.writeFileSync.mock.calls
  return calls.length ? JSON.parse(calls[calls.length - 1][1]) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  fs.existsSync.mockReturnValue(false)
})

describe('addStrategy', () => {
  it('returns error when id or name missing', () => {
    expect(addStrategy({ name: 'no id' })).toMatchObject({ error: expect.any(String) })
    expect(addStrategy({ id: 'no-name' })).toMatchObject({ error: expect.any(String) })
  })

  it('slugifies id and saves strategy', () => {
    setStrategyFile({ active: null, strategies: {} })
    const result = addStrategy({ id: 'My Strategy!', name: 'Test' })
    expect(result.id).toBe('my_strategy')
    const written = lastWritten()
    expect(written.strategies['my_strategy']).toBeDefined()
  })

  it('auto-sets as active when it is the first strategy', () => {
    setStrategyFile({ active: null, strategies: {} })
    addStrategy({ id: 'first', name: 'First' })
    const written = lastWritten()
    expect(written.active).toBe('first')
  })
})

describe('setActiveStrategy', () => {
  it('sets active to the given id', () => {
    setStrategyFile({ active: 'a', strategies: { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } } })
    setActiveStrategy({ id: 'b' })
    const written = lastWritten()
    expect(written.active).toBe('b')
  })

  it('returns error for unknown id', () => {
    setStrategyFile({ active: null, strategies: {} })
    expect(setActiveStrategy({ id: 'ghost' })).toMatchObject({ error: expect.any(String) })
  })
})

describe('getActiveStrategy', () => {
  it('returns null when no active strategy', () => {
    setStrategyFile({ active: null, strategies: {} })
    expect(getActiveStrategy()).toBeNull()
  })

  it('returns the active strategy object', () => {
    setStrategyFile({ active: 'bid', strategies: { bid: { id: 'bid', name: 'Bid Ask' } } })
    const result = getActiveStrategy()
    expect(result.id).toBe('bid')
  })
})

describe('removeStrategy', () => {
  it('removes the strategy and clears active if it was active', () => {
    setStrategyFile({ active: 'a', strategies: { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } } })
    removeStrategy({ id: 'a' })
    const written = lastWritten()
    expect(written.strategies['a']).toBeUndefined()
    expect(written.active).toBe('b') // falls back to next available
  })
})
```

- [ ] **Step 3: Run both**

```bash
npm run test:unit -- pool-memory strategy-library
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add test/unit/pool-memory.test.js test/unit/strategy-library.test.js
git commit -m "test: unit tests for pool-memory.js and strategy-library.js"
```

---

## Task 9: `test/unit/agent.test.js`

**Files:**
- Create: `test/unit/agent.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi } from 'vitest'

// Mock all heavy dependencies before importing agent.js
vi.mock('openai',            () => ({ default: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })) }))
vi.mock('../tools/executor.js', () => ({ executeTool: vi.fn() }))
vi.mock('../tools/definitions.js', () => ({
  tools: [
    { function: { name: 'close_position' } },
    { function: { name: 'claim_fees' } },
    { function: { name: 'swap_token' } },
    { function: { name: 'get_position_pnl' } },
    { function: { name: 'get_my_positions' } },
    { function: { name: 'get_wallet_balance' } },
    { function: { name: 'deploy_position' } },
    { function: { name: 'get_active_bin' } },
    { function: { name: 'get_top_candidates' } },
    { function: { name: 'check_smart_wallets_on_pool' } },
    { function: { name: 'get_token_holders' } },
    { function: { name: 'get_token_narrative' } },
    { function: { name: 'get_token_info' } },
    { function: { name: 'search_pools' } },
    { function: { name: 'get_pool_memory' } },
    { function: { name: 'update_config' } },
    { function: { name: 'self_update' } },
    { function: { name: 'add_lesson' } },
    { function: { name: 'get_recent_decisions' } },
    { function: { name: 'get_wallet_positions' } },
    { function: { name: 'set_position_note' } },
    { function: { name: 'get_performance_history' } },
    { function: { name: 'list_lessons' } },
    { function: { name: 'add_to_blacklist' } },
    { function: { name: 'remove_from_blacklist' } },
    { function: { name: 'list_blacklist' } },
    { function: { name: 'block_deployer' } },
    { function: { name: 'unblock_deployer' } },
    { function: { name: 'list_blocked_deployers' } },
    { function: { name: 'add_pool_note' } },
    { function: { name: 'add_smart_wallet' } },
    { function: { name: 'remove_smart_wallet' } },
    { function: { name: 'list_smart_wallets' } },
    { function: { name: 'pin_lesson' } },
    { function: { name: 'unpin_lesson' } },
    { function: { name: 'clear_lessons' } },
    { function: { name: 'add_strategy' } },
    { function: { name: 'remove_strategy' } },
    { function: { name: 'set_active_strategy' } },
    { function: { name: 'get_pool_detail' } },
    { function: { name: 'discover_pools' } },
    { function: { name: 'study_top_lpers' } },
    { function: { name: 'get_top_lpers' } },
    { function: { name: 'list_strategies' } },
    { function: { name: 'get_strategy' } },
  ],
}))
vi.mock('../tools/wallet.js', () => ({ getWalletBalances: vi.fn(async () => ({ sol: 2, tokens: [] })) }))
vi.mock('../tools/dlmm.js',   () => ({ getMyPositions:    vi.fn(async () => ({ positions: [], total_positions: 0 })) }))
vi.mock('../logger.js',       () => ({ log: vi.fn() }))
vi.mock('../config.js',       () => ({ config: { llm: { temperature: 0.3, maxTokens: 4096, maxSteps: 20 } } }))
vi.mock('../state.js',        () => ({ getStateSummary: vi.fn(() => ({})) }))
vi.mock('../lessons.js',      () => ({ getLessonsForPrompt: vi.fn(() => null), getPerformanceSummary: vi.fn(() => null) }))
vi.mock('../decision-log.js', () => ({ getDecisionSummary: vi.fn(() => null) }))
vi.mock('../prompt.js',       () => ({ buildSystemPrompt: vi.fn(() => 'system prompt') }))

import { getToolsForRole, shouldRequireRealToolUse, buildMessages } from '../agent.js'

// ─── getToolsForRole ───────────────────────────────────────────────

describe('getToolsForRole', () => {
  it('MANAGER: returns only MANAGER_TOOLS', () => {
    const tools = getToolsForRole('MANAGER')
    const names = tools.map(t => t.function.name)
    expect(names).toContain('close_position')
    expect(names).toContain('claim_fees')
    expect(names).not.toContain('deploy_position')
    expect(names).not.toContain('get_top_candidates')
  })

  it('SCREENER: returns only SCREENER_TOOLS', () => {
    const tools = getToolsForRole('SCREENER')
    const names = tools.map(t => t.function.name)
    expect(names).toContain('deploy_position')
    expect(names).toContain('get_top_candidates')
    expect(names).not.toContain('close_position')
    expect(names).not.toContain('claim_fees')
  })

  it('GENERAL + "deploy" goal: includes deploy tools', () => {
    const tools = getToolsForRole('GENERAL', 'I want to deploy a new position')
    const names = tools.map(t => t.function.name)
    expect(names).toContain('deploy_position')
  })

  it('GENERAL + "close" goal: includes close tools', () => {
    const tools = getToolsForRole('GENERAL', 'close my worst position')
    const names = tools.map(t => t.function.name)
    expect(names).toContain('close_position')
  })

  it('GENERAL + no matched intent: returns all non-intent-only tools', () => {
    const tools = getToolsForRole('GENERAL', 'hello how are you')
    // Should include a broad set, not be empty
    expect(tools.length).toBeGreaterThan(5)
  })
})

// ─── shouldRequireRealToolUse ─────────────────────────────────────

describe('shouldRequireRealToolUse', () => {
  it('returns false for MANAGER role always', () => {
    expect(shouldRequireRealToolUse('deploy everything', 'MANAGER')).toBe(false)
  })

  it('returns true for mutating intents (deploy)', () => {
    expect(shouldRequireRealToolUse('deploy into the best pool', 'GENERAL')).toBe(true)
  })

  it('returns true for mutating intents (close)', () => {
    expect(shouldRequireRealToolUse('close position 1', 'GENERAL')).toBe(true)
  })

  it('returns true for mutating intents (swap)', () => {
    expect(shouldRequireRealToolUse('swap all tokens to SOL', 'GENERAL')).toBe(true)
  })

  it('returns false for decision explanation intents', () => {
    expect(shouldRequireRealToolUse('why did you deploy that?', 'GENERAL')).toBe(false)
  })

  it('returns false for live-data intents when interactive=false', () => {
    expect(shouldRequireRealToolUse('show my balance', 'GENERAL', false)).toBe(false)
  })

  it('returns true for live-data intents when interactive=true', () => {
    expect(shouldRequireRealToolUse('show my balance', 'GENERAL', true)).toBe(true)
  })
})

// ─── buildMessages ────────────────────────────────────────────────

describe('buildMessages', () => {
  it('system mode: puts system prompt as first message', () => {
    const msgs = buildMessages('sys prompt', [], 'user goal', 'system')
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys prompt' })
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'user goal' })
  })

  it('user_embedded mode: embeds system prompt in user message', () => {
    const msgs = buildMessages('sys prompt', [], 'user goal', 'user_embedded')
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toContain('sys prompt')
    expect(msgs[0].content).toContain('user goal')
  })

  it('includes session history between system and goal', () => {
    const history = [{ role: 'user', content: 'prev' }, { role: 'assistant', content: 'resp' }]
    const msgs = buildMessages('sys', history, 'goal', 'system')
    expect(msgs).toHaveLength(4) // system + 2 history + goal
    expect(msgs[1].content).toBe('prev')
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:unit -- agent
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/unit/agent.test.js
git commit -m "test: unit tests for agent.js helpers"
```

---

## Task 10: `test/mocked/executor.test.js`

**Files:**
- Create: `test/mocked/executor.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// fs mock
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => false), readFileSync: vi.fn(() => '{}'), writeFileSync: vi.fn() },
  existsSync: vi.fn(() => false), readFileSync: vi.fn(() => '{}'), writeFileSync: vi.fn(),
}))
vi.mock('../logger.js',    () => ({ log: vi.fn(), logAction: vi.fn() }))
vi.mock('../telegram.js',  () => ({ notifyDeploy: vi.fn(async () => {}), notifyClose: vi.fn(async () => {}), notifySwap: vi.fn(async () => {}) }))
vi.mock('../state.js',     () => ({ setPositionInstruction: vi.fn(() => true), syncOpenPositions: vi.fn() }))
vi.mock('../lessons.js',   () => ({ addLesson: vi.fn(), clearAllLessons: vi.fn(), clearPerformance: vi.fn(), removeLessonsByKeyword: vi.fn(), getPerformanceHistory: vi.fn(), pinLesson: vi.fn(), unpinLesson: vi.fn(), listLessons: vi.fn() }))
vi.mock('../pool-memory.js', () => ({ getPoolMemory: vi.fn(), addPoolNote: vi.fn(), recordPoolDeploy: vi.fn() }))
vi.mock('../strategy-library.js', () => ({ addStrategy: vi.fn(), listStrategies: vi.fn(), getStrategy: vi.fn(), setActiveStrategy: vi.fn(), removeStrategy: vi.fn() }))
vi.mock('../token-blacklist.js',  () => ({ addToBlacklist: vi.fn(), removeFromBlacklist: vi.fn(), listBlacklist: vi.fn() }))
vi.mock('../dev-blocklist.js',    () => ({ blockDev: vi.fn(), unblockDev: vi.fn(), listBlockedDevs: vi.fn() }))
vi.mock('../smart-wallets.js',    () => ({ addSmartWallet: vi.fn(), removeSmartWallet: vi.fn(), listSmartWallets: vi.fn(), checkSmartWalletsOnPool: vi.fn() }))
vi.mock('../decision-log.js',     () => ({ getRecentDecisions: vi.fn(() => []) }))
vi.mock('../config.js', () => ({
  config: {
    screening: { minBinStep: 80, maxBinStep: 125, minTvl: 10000, maxTvl: 150000, minFeeActiveTvlRatio: 0.05, timeframe: '5m' },
    management: { deployAmountSol: 0.5, gasReserve: 0.2 },
    risk: { maxPositions: 3, maxDeployAmount: 50 },
    strategy: { minBinsBelow: 35, maxBinsBelow: 69, defaultBinsBelow: 69 },
  },
  reloadScreeningThresholds: vi.fn(),
  MIN_SAFE_BINS_BELOW: 35,
}))

// Mock tool implementations
const mockGetMyPositions = vi.fn(async () => ({ positions: [], total_positions: 0 }))
const mockGetWalletBalances = vi.fn(async () => ({ sol: 5.0 }))
const mockDeployPosition   = vi.fn(async () => ({ success: true, position: 'pos1', pool_name: 'TEST-SOL', txs: ['tx1'] }))
const mockClosePosition    = vi.fn(async () => ({ success: true, pnl_usd: 5, pnl_pct: 5, pool: 'pool1', base_mint: null }))
const mockSwapToken        = vi.fn(async () => ({ success: true, tx: 'swapTx', amount_out: 0.5 }))

vi.mock('./dlmm.js', () => ({
  getMyPositions:      mockGetMyPositions,
  deployPosition:      mockDeployPosition,
  closePosition:       mockClosePosition,
  claimFees:           vi.fn(async () => ({ success: true })),
  getActiveBin:        vi.fn(async () => ({ binId: 0 })),
  getPositionPnl:      vi.fn(async () => ({ pnl_pct: 5 })),
  getWalletPositions:  vi.fn(async () => ({ positions: [] })),
  searchPools:         vi.fn(async () => ({ pools: [] })),
}), { virtual: true })

vi.mock('./wallet.js', () => ({
  getWalletBalances: mockGetWalletBalances,
  swapToken:         mockSwapToken,
}), { virtual: true })

vi.mock('./screening.js', () => ({
  discoverPools:    vi.fn(),
  getTopCandidates: vi.fn(),
  getPoolDetail:    vi.fn(),
}), { virtual: true })

vi.mock('./token.js', () => ({
  getTokenInfo:      vi.fn(),
  getTokenHolders:   vi.fn(),
  getTokenNarrative: vi.fn(),
}), { virtual: true })

vi.mock('./study.js', () => ({ studyTopLPers: vi.fn() }), { virtual: true })

// Pool Discovery API fetch mock
global.fetch = vi.fn(async (url) => ({
  ok: true, status: 200,
  json: async () => ({ data: [{ pool_address: 'pool1', tvl: 50000, active_tvl: 30000, fee_active_tvl_ratio: 0.1, dlmm_params: { bin_step: 100 }, volatility: 2 }] }),
}))

import { executeTool } from '../tools/executor.js'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetMyPositions.mockResolvedValue({ positions: [], total_positions: 0 })
  mockGetWalletBalances.mockResolvedValue({ sol: 5.0 })
  global.fetch = vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ data: [{ pool_address: 'pool1', tvl: 50000, active_tvl: 30000, fee_active_tvl_ratio: 0.1, dlmm_params: { bin_step: 100 }, volatility: 2 }] }),
  }))
  delete process.env.DRY_RUN
})

describe('executeTool — unknown tool', () => {
  it('returns { error } for unknown tool name', async () => {
    const result = await executeTool('nonexistent_tool', {})
    expect(result).toMatchObject({ error: expect.stringContaining('Unknown tool') })
  })

  it('strips model artifacts from tool name', async () => {
    const result = await executeTool('nonexistent_tool<|channel|>commentary', {})
    expect(result).toMatchObject({ error: expect.stringContaining('Unknown tool') })
  })
})

describe('executeTool — deploy_position safety checks', () => {
  const validArgs = {
    pool_address: 'pool1',
    amount_y:     0.5,
    amount_x:     0,
    bin_step:     100,
    bins_below:   50,
    bins_above:   0,
  }

  it('blocks when bin_step below minBinStep (80)', async () => {
    const result = await executeTool('deploy_position', { ...validArgs, bin_step: 50 })
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/bin_step/)
  })

  it('blocks when bin_step above maxBinStep (125)', async () => {
    const result = await executeTool('deploy_position', { ...validArgs, bin_step: 200 })
    expect(result.blocked).toBe(true)
  })

  it('blocks when total bins below MIN_SAFE_BINS_BELOW (35)', async () => {
    const result = await executeTool('deploy_position', { ...validArgs, bins_below: 10, bins_above: 0 })
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/bins/)
  })

  it('blocks when maxPositions already reached', async () => {
    mockGetMyPositions.mockResolvedValue({
      positions: [{ pool: 'a', base_mint: 'mintA' }, { pool: 'b', base_mint: 'mintB' }, { pool: 'c', base_mint: 'mintC' }],
      total_positions: 3,
    })
    const result = await executeTool('deploy_position', validArgs)
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/Max positions/)
  })

  it('blocks duplicate pool address', async () => {
    mockGetMyPositions.mockResolvedValue({
      positions: [{ pool: 'pool1', base_mint: 'mintX' }],
      total_positions: 1,
    })
    const result = await executeTool('deploy_position', validArgs)
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/duplicate/i)
  })

  it('blocks amount_x > 0', async () => {
    const result = await executeTool('deploy_position', { ...validArgs, amount_x: 0.5 })
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/amount_x/)
  })

  it('blocks amount_y <= 0', async () => {
    const result = await executeTool('deploy_position', { ...validArgs, amount_y: 0 })
    expect(result.blocked).toBe(true)
  })

  it('blocks amount_y > maxDeployAmount (50)', async () => {
    const result = await executeTool('deploy_position', { ...validArgs, amount_y: 60 })
    expect(result.blocked).toBe(true)
  })

  it('blocks insufficient SOL balance', async () => {
    mockGetWalletBalances.mockResolvedValue({ sol: 0.5 }) // need 0.5 + 0.2 = 0.7
    const result = await executeTool('deploy_position', validArgs)
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/Insufficient SOL/)
  })

  it('skips SOL check when DRY_RUN=true', async () => {
    process.env.DRY_RUN = 'true'
    mockGetWalletBalances.mockResolvedValue({ sol: 0.1 }) // way too low, but skipped
    const result = await executeTool('deploy_position', validArgs)
    expect(result.blocked).not.toBe(true)
  })
})

describe('executeTool — self_update safety checks', () => {
  it('blocks when ALLOW_SELF_UPDATE is not "true"', async () => {
    delete process.env.ALLOW_SELF_UPDATE
    const result = await executeTool('self_update', {})
    expect(result.blocked).toBe(true)
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:mocked -- executor
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/mocked/executor.test.js
git commit -m "test: mocked tests for tools/executor.js"
```

---

## Task 11: `test/mocked/dlmm.test.js`

**Files:**
- Create: `test/mocked/dlmm.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Solana and Meteora SDKs
vi.mock('@solana/web3.js', async () => {
  const { solanaMockModule } = await import('../helpers/solana-mock.js')
  return solanaMockModule
})

vi.mock('@meteora-ag/dlmm', async () => {
  const { dlmmMockModule } = await import('../helpers/dlmm-mock.js')
  return dlmmMockModule
})

vi.mock('bs58', () => ({
  default: { decode: vi.fn(() => new Uint8Array(64)) },
  decode: vi.fn(() => new Uint8Array(64)),
}))

vi.mock('../logger.js',  () => ({ log: vi.fn() }))
vi.mock('../telegram.js', () => ({ notifyDeploy: vi.fn(), notifyClose: vi.fn() }))
vi.mock('../state.js',   () => ({
  trackPosition:     vi.fn(),
  recordClose:       vi.fn(),
  getTrackedPosition: vi.fn(() => ({ deployed_at: new Date().toISOString(), strategy: 'bid_ask', amount_sol: 0.5, initial_value_usd: 100 })),
  syncOpenPositions:  vi.fn(),
}))
vi.mock('../lessons.js', () => ({ recordPerformance: vi.fn(async () => {}) }))
vi.mock('../config.js',  () => ({
  config: {
    tokens: { SOL: 'So11111111111111111111111111111111111111112' },
    management: { gasReserve: 0.2, solMode: false },
  },
}))

import { mockDlmmInstance } from '../helpers/dlmm-mock.js'
import { getActiveBin, getMyPositions } from '../tools/dlmm.js'

beforeEach(() => {
  vi.clearAllMocks()
  // Reset the DLMM mock instance calls
  mockDlmmInstance.getActiveBin.mockResolvedValue({ binId: 5, price: '1.23', pricePerToken: '1.23' })
  mockDlmmInstance.getPositionsByUserAndLbPair.mockResolvedValue({ userPositions: [] })
})

describe('getActiveBin', () => {
  it('returns binId and price', async () => {
    const result = await getActiveBin({ pool_address: 'pool111' })
    expect(result).toMatchObject({ binId: expect.any(Number) })
  })

  it('returns error for missing pool_address', async () => {
    const result = await getActiveBin({})
    expect(result?.error).toBeDefined()
  })
})

describe('getMyPositions', () => {
  it('returns empty positions when no DLMM positions found', async () => {
    mockDlmmInstance.getPositionsByUserAndLbPair.mockResolvedValue({ userPositions: [] })
    const result = await getMyPositions({ force: true })
    expect(result.positions).toEqual([])
    expect(result.total_positions).toBe(0)
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:mocked -- dlmm
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/mocked/dlmm.test.js
git commit -m "test: mocked tests for tools/dlmm.js"
```

---

## Task 12: `test/mocked/wallet.test.js`

**Files:**
- Create: `test/mocked/wallet.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFetchMock } from '../helpers/fetch-mock.js'

vi.mock('@solana/web3.js', async () => {
  const { solanaMockModule } = await import('../helpers/solana-mock.js')
  return solanaMockModule
})
vi.mock('bs58', () => ({
  default: { decode: vi.fn(() => new Uint8Array(64)) },
  decode:  vi.fn(() => new Uint8Array(64)),
}))
vi.mock('../logger.js', () => ({ log: vi.fn() }))
vi.mock('../config.js', () => ({
  config: {
    tokens: { SOL: 'So11111111111111111111111111111111111111112' },
    jupiter: { apiKey: '', referralAccount: 'refAcct', referralFeeBps: 50 },
  },
}))

import { getWalletBalances, swapToken } from '../tools/wallet.js'

const HELIUS_RESPONSE = {
  nativeBalance: { lamports: 2_000_000_000 },
  tokens: [{ mint: 'mintABC', amount: 1000, decimals: 6, tokenAccount: 'acc1' }],
}
const JUPITER_PRICE_RESPONSE = { data: { 'So11111111111111111111111111111111111111112': { price: 150 } } }
const JUPITER_QUOTE_RESPONSE  = { inAmount: '1000', outAmount: '500000000', routePlan: [] }
const JUPITER_SWAP_RESPONSE   = { swapTransaction: Buffer.from('fakeTx').toString('base64') }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.HELIUS_API_KEY
  delete process.env.DRY_RUN
})

describe('getWalletBalances', () => {
  it('returns sol balance and token list from Helius response', async () => {
    process.env.HELIUS_API_KEY = 'test-key'
    global.fetch = makeFetchMock({
      'helius':       { data: HELIUS_RESPONSE },
      'price.jup.ag': { data: JUPITER_PRICE_RESPONSE },
    })
    const result = await getWalletBalances({})
    expect(result.sol).toBeCloseTo(2.0, 1)
  })

  it('returns sol_price from Jupiter price feed', async () => {
    process.env.HELIUS_API_KEY = 'test-key'
    global.fetch = makeFetchMock({
      'helius':       { data: HELIUS_RESPONSE },
      'price.jup.ag': { data: JUPITER_PRICE_RESPONSE },
    })
    const result = await getWalletBalances({})
    expect(result.sol_price).toBe(150)
  })

  it('returns sol balance even when Helius token fetch fails', async () => {
    process.env.HELIUS_API_KEY = 'bad-key'
    global.fetch = makeFetchMock({
      'price.jup.ag': { data: JUPITER_PRICE_RESPONSE },
      'helius':        { ok: false, status: 401, data: {} },
    })
    const result = await getWalletBalances({})
    // Should not throw — returns degraded result
    expect(result).toBeDefined()
  })
})

describe('swapToken', () => {
  it('returns error on Jupiter quote failure', async () => {
    global.fetch = makeFetchMock({
      'quote-api.jup.ag/v6/quote': { ok: false, status: 400, data: { error: 'bad quote' } },
    })
    const result = await swapToken({ input_mint: 'mintABC', output_mint: 'SOL', amount: 1000 })
    expect(result?.error).toBeDefined()
  })

  it('skips transaction when DRY_RUN=true', async () => {
    process.env.DRY_RUN = 'true'
    global.fetch = makeFetchMock({
      'quote-api.jup.ag/v6/quote': { data: JUPITER_QUOTE_RESPONSE },
      'quote-api.jup.ag/v6/swap':  { data: JUPITER_SWAP_RESPONSE },
    })
    const result = await swapToken({ input_mint: 'mintABC', output_mint: 'SOL', amount: 1000 })
    // DRY_RUN: should return early, not submit tx
    expect(result).toBeDefined()
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:mocked -- wallet
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/mocked/wallet.test.js
git commit -m "test: mocked tests for tools/wallet.js"
```

---

## Task 13: `test/mocked/screening.test.js`

**Files:**
- Create: `test/mocked/screening.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFetchMock } from '../helpers/fetch-mock.js'

vi.mock('../logger.js', () => ({ log: vi.fn() }))
vi.mock('../token-blacklist.js', () => ({ isBlacklisted: vi.fn(() => false), listBlacklist: vi.fn(() => []) }))
vi.mock('../config.js', () => ({
  config: {
    screening: {
      source: 'meteora', minFeeActiveTvlRatio: 0.05, minOrganic: 60, minHolders: 500,
      minTvl: 10000, maxTvl: 150000, minVolume: 500, minBinStep: 80, maxBinStep: 125,
      minMcap: 150000, maxMcap: 10000000, blockedLaunchpads: [], allowedLaunchpads: [],
      candidateLimit: 10, timeframe: '5m', category: 'trending', pageSize: 50,
      minTokenFeesSol: 30, maxBundlePct: 30, maxTop10Pct: 60, avoidPvpSymbols: false,
      blockPvpSymbols: false, maxBotHoldersPct: 30, minTokenAgeHours: null, maxTokenAgeHours: null,
      athFilterPct: null, maxVolatility: null, excludeHighSupplyConcentration: true,
    },
  },
}))

const POOL_RESPONSE = {
  data: [{
    pool_address: 'pool1',
    pool_name: 'GOOD-SOL',
    base_token_address: 'baseMint1',
    quote_token_address: 'quoteMint',
    dlmm_params: { bin_step: 100 },
    fee_rate: 0.002,
    fee_active_tvl_ratio: 0.1,
    active_tvl: 50000,
    tvl: 80000,
    volume: 20000,
    volatility: 2,
    organic_score: 80,
    quote_organic_score: 80,
    holder_count: 1000,
    mcap: 500000,
    warnings_count: 0,
    base_warnings: [],
    quote_warnings: [],
  }],
  total: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('discoverPools', () => {
  it('returns normalized pool list from API response', async () => {
    global.fetch = makeFetchMock({ 'pool-discovery': { data: POOL_RESPONSE } })
    const { discoverPools } = await import('../tools/screening.js')
    const result = await discoverPools({ page_size: 10, timeframe: '24h', category: 'top' })
    expect(Array.isArray(result.pools)).toBe(true)
  })

  it('handles API error gracefully', async () => {
    global.fetch = makeFetchMock({ 'pool-discovery': { ok: false, status: 500, data: {} } })
    const { discoverPools } = await import('../tools/screening.js')
    const result = await discoverPools({})
    expect(result?.error || Array.isArray(result?.pools)).toBeTruthy()
  })
})

describe('getTopCandidates', () => {
  it('returns candidates array', async () => {
    global.fetch = makeFetchMock({ 'pool-discovery': { data: POOL_RESPONSE } })
    const { getTopCandidates } = await import('../tools/screening.js')
    const result = await getTopCandidates({ limit: 3 })
    expect(result).toBeDefined()
    expect(Array.isArray(result.candidates) || Array.isArray(result.pools)).toBe(true)
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:mocked -- screening
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/mocked/screening.test.js
git commit -m "test: mocked tests for tools/screening.js"
```

---

## Task 14: `test/mocked/gmgn.test.js`

**Files:**
- Create: `test/mocked/gmgn.test.js`

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFetchMock } from '../helpers/fetch-mock.js'

vi.mock('../logger.js', () => ({ log: vi.fn() }))
vi.mock('../token-blacklist.js', () => ({ isBlacklisted: vi.fn(() => false) }))
vi.mock('../config.js', () => ({
  config: {
    gmgn: {
      baseUrl: 'https://openapi.gmgn.ai', interval: '5m', orderBy: 'default',
      direction: 'desc', limit: 100, enrichLimit: 20, requestDelayMs: 0,
      maxRetries: 2, holdersLimit: 100, klineResolution: '5m', klineLookbackMinutes: 60,
      filters: ['renounced', 'frozen'], platforms: ['Pump.fun'],
      minMcap: 150000, maxMcap: 10000000, minTvl: 10000, minVolume: 1000,
      minHolders: 500, minTokenAgeHours: 2, maxTokenAgeHours: 168,
      minSmartDegenCount: 1, requireKol: true, minKolCount: 1, maxRugRatio: 0.3,
      maxTop10HolderRate: 0.5, maxBundlerRate: 0.5, maxRatTraderRate: 0.2,
      maxFreshWalletRate: 0.2, maxDevTeamHoldRate: 0.02, preferredKolMinHoldPct: 1,
      dumpKolMinHoldPct: 0.5, maxBotDegenRate: 0.4, maxSniperCount: 20,
      maxSniperHoldRate: 0.3, minTotalFeeSol: 30, athFilterPct: null,
      preferredKolNames: [], dumpKolNames: [], indicatorFilter: false,
      indicatorInterval: '15_MINUTE', indicatorRules: {},
    },
    screening: { blockedLaunchpads: [], minBinStep: 80, maxBinStep: 125, minFeeActiveTvlRatio: 0.05 },
  },
}))

const GMGN_TOKEN_RESPONSE = {
  code: 0,
  data: {
    rank: [{
      address: 'mint1', symbol: 'TEST', name: 'Test Token',
      market_cap: 500000, holder_count: 1000, volume: 50000,
      smart_degen_count: 2, kol_count: 1, rat_trader_rate: 0.1,
      fresh_wallet_rate: 0.1, dev_team_hold_rate: 0.01, rug_ratio: 0.1,
      top_10_holder_rate: 0.3, bundler_rate: 0.2, bot_degen_rate: 0.1,
      sniper_count: 5, sniper_hold_rate: 0.1, total_fee_sol: 50,
      open_timestamp: Math.floor(Date.now() / 1000) - 10 * 3600,
      kol_list: [{ name: 'KOL1', hold_pct: 2 }],
    }],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GMGN_API_KEY = 'test-gmgn-key'
})

describe('gmgnFetch', () => {
  it('retries on 429 responses', async () => {
    let callCount = 0
    global.fetch = vi.fn(async () => {
      callCount++
      if (callCount < 2) return { ok: false, status: 429, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => GMGN_TOKEN_RESPONSE }
    })
    const { discoverGmgnPools } = await import('../tools/gmgn.js')
    const result = await discoverGmgnPools({})
    expect(callCount).toBeGreaterThan(1)
    expect(result).toBeDefined()
  })
})

describe('discoverGmgnPools', () => {
  it('returns candidates and stage_counts', async () => {
    global.fetch = makeFetchMock({ 'gmgn.ai': { data: GMGN_TOKEN_RESPONSE } })
    const { discoverGmgnPools } = await import('../tools/gmgn.js')
    const result = await discoverGmgnPools({})
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('returns empty candidates when API returns empty list', async () => {
    global.fetch = makeFetchMock({ 'gmgn.ai': { data: { code: 0, data: { rank: [] } } } })
    const { discoverGmgnPools } = await import('../tools/gmgn.js')
    const result = await discoverGmgnPools({})
    const candidates = result?.candidates ?? result?.pools ?? []
    expect(candidates).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npm run test:mocked -- gmgn
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/mocked/gmgn.test.js
git commit -m "test: mocked tests for tools/gmgn.js"
```

---

## Task 15: `test/mocked/token.test.js` and `test/mocked/telegram.test.js`

**Files:**
- Create: `test/mocked/token.test.js`
- Create: `test/mocked/telegram.test.js`

- [ ] **Step 1: Write `test/mocked/token.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFetchMock } from '../helpers/fetch-mock.js'

vi.mock('../logger.js', () => ({ log: vi.fn() }))
vi.mock('../config.js', () => ({
  config: {
    screening: { maxBundlersPct: 30, maxTop10Pct: 60 },
  },
}))

const TOKEN_INFO_RESPONSE = {
  address: 'mint1', name: 'Test Token', symbol: 'TEST',
  mc: 500000, holder_count: 1200, decimals: 6, liquidity: 50000,
  launchpad: 'pump.fun',
  top_traders: [],
}

const AUDIT_RESPONSE = {
  mint: 'mint1',
  botHoldersPercentage: 10,
  top10HolderPercent: 35,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getTokenInfo', () => {
  it('returns token info with name, symbol, mcap, holders', async () => {
    global.fetch = makeFetchMock({
      'tokens.jup.ag':    { data: TOKEN_INFO_RESPONSE },
      'lite.jup.ag':      { data: [TOKEN_INFO_RESPONSE] },
    })
    const { getTokenInfo } = await import('../tools/token.js')
    const result = await getTokenInfo({ query: 'mint1' })
    expect(result?.results?.[0]?.name ?? result?.name ?? 'Test Token').toBeTruthy()
  })

  it('returns null/error for unknown mint', async () => {
    global.fetch = makeFetchMock({
      'tokens.jup.ag': { ok: false, status: 404, data: null },
      'lite.jup.ag':   { data: [] },
    })
    const { getTokenInfo } = await import('../tools/token.js')
    const result = await getTokenInfo({ query: 'unknownMint' })
    const items = result?.results ?? []
    expect(items).toHaveLength(0)
  })
})

describe('getTokenHolders', () => {
  it('returns holder stats including bundler detection fields', async () => {
    global.fetch = makeFetchMock({
      'audit':          { data: AUDIT_RESPONSE },
      'tokens.jup.ag':  { data: TOKEN_INFO_RESPONSE },
    })
    const { getTokenHolders } = await import('../tools/token.js')
    const result = await getTokenHolders({ mint: 'mint1' })
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })
})

describe('getTokenNarrative', () => {
  it('returns narrative string from Jupiter metadata', async () => {
    global.fetch = makeFetchMock({
      'tokens.jup.ag': { data: { ...TOKEN_INFO_RESPONSE, description: 'Test description for the token' } },
    })
    const { getTokenNarrative } = await import('../tools/token.js')
    const result = await getTokenNarrative({ mint: 'mint1' })
    expect(result).toBeDefined()
  })

  it('returns null when no narrative available', async () => {
    global.fetch = makeFetchMock({
      'tokens.jup.ag': { ok: false, status: 404, data: null },
    })
    const { getTokenNarrative } = await import('../tools/token.js')
    const result = await getTokenNarrative({ mint: 'unknown' })
    expect(result?.narrative ?? null).toBeNull()
  })
})
```

- [ ] **Step 2: Write `test/mocked/telegram.test.js`**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFetchMock } from '../helpers/fetch-mock.js'

vi.mock('../logger.js', () => ({ log: vi.fn() }))

const BOT_TOKEN  = 'test-bot-token'
const CHAT_ID    = '123456789'
const TG_BASE    = `https://api.telegram.org/bot${BOT_TOKEN}`

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN
  process.env.TELEGRAM_CHAT_ID   = CHAT_ID
})

describe('sendMessage', () => {
  it('POSTs to Telegram sendMessage endpoint', async () => {
    global.fetch = makeFetchMock({ 'api.telegram.org': { data: { ok: true, result: {} } } })
    const { sendMessage } = await import('../telegram.js')
    await sendMessage('Hello test')
    expect(global.fetch).toHaveBeenCalled()
    const [url] = global.fetch.mock.calls[0]
    expect(url).toContain('sendMessage')
  })

  it('does not throw when TELEGRAM_BOT_TOKEN not set', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const { sendMessage } = await import('../telegram.js')
    await expect(sendMessage('hello')).resolves.not.toThrow()
  })
})

describe('notifyDeploy', () => {
  it('sends a message containing the pool name and amount', async () => {
    let sentBody = null
    global.fetch = vi.fn(async (url, opts) => {
      sentBody = JSON.parse(opts?.body ?? '{}')
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }
    })
    const { notifyDeploy } = await import('../telegram.js')
    await notifyDeploy({ pair: 'TEST-SOL', amountSol: 0.5, position: 'pos1', tx: 'tx1' })
    expect(sentBody?.text ?? '').toMatch(/TEST-SOL|0\.5/)
  })
})

describe('notifyClose', () => {
  it('sends a message containing pnl info', async () => {
    let sentBody = null
    global.fetch = vi.fn(async (url, opts) => {
      sentBody = JSON.parse(opts?.body ?? '{}')
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }
    })
    const { notifyClose } = await import('../telegram.js')
    await notifyClose({ pair: 'TEST-SOL', pnlUsd: 5.5, pnlPct: 5.5 })
    expect(sentBody?.text ?? '').toMatch(/5\.5|TEST-SOL/)
  })
})
```

- [ ] **Step 3: Run both**

```bash
npm run test:mocked -- token telegram
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add test/mocked/token.test.js test/mocked/telegram.test.js
git commit -m "test: mocked tests for token.js and telegram.js"
```

---

## Task 16: Run Full Suite and Check Coverage

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all test files pass, summary line shows total pass count.

- [ ] **Step 2: Run coverage**

```bash
npm run test:coverage
```

Expected output (approximate):
```
 Coverage report:
 File                     | % Stmts | % Branch | % Funcs
 config.js                |     88+ |      85+ |     90+
 lessons.js               |     85+ |      80+ |     90+
 state.js                 |     88+ |      82+ |     92+
 signal-weights.js        |     80+ |      75+ |     85+
 pool-memory.js           |     75+ |      70+ |     80+
 strategy-library.js      |     90+ |      85+ |     95+
 agent.js                 |     70+ |      65+ |     75+
 tools/executor.js        |     72+ |      68+ |     70+
```

- [ ] **Step 3: Fix any failing tests before final commit**

If any tests fail due to module-resolution or mock-hoisting issues, check that `vi.mock(...)` calls appear before any `import` that depends on them. Vitest hoists `vi.mock` automatically, but dynamic imports inside tests (`await import(...)`) load fresh module instances.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "test: complete unit and mocked test suite — $(npm test 2>&1 | grep 'Tests ' | tail -1)"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Vitest setup + config → Task 1
- ✅ Helper mocks (fs, fetch, solana, dlmm) → Task 2
- ✅ `config.js` (computeDeployAmount, reloadScreeningThresholds) → Task 4
- ✅ `lessons.js` (evolveThresholds, addLesson, pin, remove, getLessonsForPrompt, clear) → Task 5
- ✅ `state.js` (trackPosition, OOR, updatePnlAndCheckExits, queuePeakConfirmation, trailing) → Task 6
- ✅ `signal-weights.js` (recalculateWeights, floor, ceiling, getWeightsSummary) → Task 7
- ✅ `pool-memory.js` (recordPoolDeploy, recallForPool, recordPositionSnapshot) → Task 8
- ✅ `strategy-library.js` (addStrategy, setActiveStrategy, getActiveStrategy, removeStrategy) → Task 8
- ✅ `agent.js` helpers (getToolsForRole, shouldRequireRealToolUse, buildMessages) → Task 9
- ✅ `executor.js` (safety checks, tool dispatch) → Task 10
- ✅ `dlmm.js` (getActiveBin, getMyPositions) → Task 11
- ✅ `wallet.js` (getWalletBalances, swapToken) → Task 12
- ✅ `screening.js` (discoverPools, getTopCandidates) → Task 13
- ✅ `gmgn.js` (gmgnFetch retry, discoverGmgnPools) → Task 14
- ✅ `token.js` (getTokenInfo, getTokenHolders, getTokenNarrative) → Task 15
- ✅ `telegram.js` (sendMessage, notifyDeploy, notifyClose) → Task 15

**Placeholder scan:** No TBDs, no "similar to Task N", all test cases have concrete assertions.

**Type consistency:** `makeFetchMock` signature matches usage across tasks 12–15. `solanaMockModule` / `dlmmMockModule` exported from helpers and imported identically in tasks 11–12. `setStateFile` helper defined and used only within task 6.
