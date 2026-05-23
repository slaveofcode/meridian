# Unit Test Suite — Design Spec
**Date:** 2026-05-23  
**Scope:** Full test coverage for all source files in the Meridian codebase  
**Framework:** Vitest  
**Status:** Approved, pending implementation

---

## Goals

Validate all source files via automated tests to catch regressions before deploying changes. Covers both pure business logic (unit layer) and external SDK wiring (mocked layer). Tests run fully in-memory — no wallet, no Solana RPC, no live APIs required.

---

## Setup & Configuration

### Install
```bash
npm install --save-dev vitest @vitest/coverage-v8
```

### `vitest.config.js` (project root)
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
      exclude: ['scripts/', 'discord-listener/', 'setup.js', 'envcrypt.js'],
    },
  },
})
```

### `package.json` scripts
```json
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage",
"test:unit":     "vitest run test/unit",
"test:mocked":   "vitest run test/mocked"
```

---

## Directory Layout

```
test/
  helpers/
    fs-mock.js          # reusable fs mock factory (vi.mock('fs', ...))
    fetch-mock.js       # global.fetch mock factory with canned responses
    solana-mock.js      # @solana/web3.js Connection, PublicKey, Transaction mocks
    dlmm-mock.js        # @meteora-ag/dlmm DLMM class mock
  unit/
    lessons.test.js
    config.test.js
    state.test.js
    signal-weights.test.js
    pool-memory.test.js
    strategy-library.test.js
    agent.test.js
  mocked/
    executor.test.js
    dlmm.test.js
    wallet.test.js
    screening.test.js
    gmgn.test.js
    token.test.js
    telegram.test.js
vitest.config.js
```

---

## Layer 1 — Unit Tests (Pure Logic, `fs` mocked)

Files in this layer have no network or Solana dependencies. The only mock is `vi.mock('fs')` to intercept JSON reads/writes.

### `test/unit/lessons.test.js`
Covers: `lessons.js`

**`evolveThresholds()`**
- Returns null when fewer than 5 performance records
- Tightens `maxVolatility` when losers cluster at high volatility (uses 25th percentile of loser vols)
- Loosens `maxVolatility` when all winners, no losers (uses 75th percentile of winner vols)
- Raises `minFeeActiveTvlRatio` when winners consistently above current floor
- Raises `minOrganic` when winner avg > loser avg by ≥ 10
- Never shifts any threshold more than 20% in one step (`MAX_CHANGE_PER_STEP`)
- Persists changes to `user-config.json` via `fs.writeFileSync`
- Applies changes to live config object immediately (in-place mutation)

**`derivLesson()` (tested via `recordPerformance`)**
- Returns null for "neutral" outcome (pnl_pct 0–5, low fee yield)
- Generates AVOID rule when `range_efficiency < 30` and outcome is bad
- Generates PREFER rule when `range_efficiency > 80` and outcome is good
- Assigns high confidence (0.88) for bad outcome with strong negative evidence

**`getLessonsForPrompt()`**
- Returns null when no lessons exist
- Pinned lessons always appear in Tier 1 (up to PINNED_CAP)
- Role-matched lessons filtered correctly for SCREENER vs MANAGER
- Respects PINNED_CAP, ROLE_CAP, RECENT_CAP total limits
- Pinned lessons respect role filter (SCREENER lesson not injected for MANAGER)

**Lesson CRUD**
- `addLesson`: sanitizes rule text (strips `<>\`` and newlines, truncates at 400 chars)
- `pinLesson` / `unpinLesson`: toggles pinned flag and persists
- `removeLesson`: removes correct entry by id, leaves others intact
- `clearAllLessons`: empties lessons array but keeps performance records
- `clearPerformance`: empties performance array but keeps lessons

---

### `test/unit/config.test.js`
Covers: `config.js`

**`computeDeployAmount(walletSol)`**
- Returns `deployAmountSol` floor when wallet too small to scale
- Scales linearly with wallet balance (compounding formula)
- Clamps to `maxDeployAmount` ceiling
- Handles zero wallet balance (returns floor, no NaN)

**`reloadScreeningThresholds()`**
- Applies fresh `minFeeActiveTvlRatio` from `user-config.json`
- Applies fresh `maxVolatility`
- Enforces `MIN_SAFE_BINS_BELOW = 35` floor on `minBinsBelow`
- Silently ignores unknown keys

---

### `test/unit/state.test.js`
Covers: `state.js`

**`trackPosition()`**
- Saves position to state with all required fields
- Overwrites existing entry with same address

**OOR tracking**
- `markOutOfRange`: sets `oor_since` timestamp on first call
- `markInRange`: clears `oor_since`
- `minutesOutOfRange`: returns correct elapsed minutes

**`updatePnlAndCheckExits()`**
- Returns `STOP_LOSS` action when `pnl_pct < stopLossPct`
- Returns `TAKE_PROFIT` action when `pnl_pct >= takeProfitPct`
- Activates trailing TP when `pnl_pct >= trailingTriggerPct` and updates peak
- Returns `TRAILING_TP` action when peak drops by `trailingDropPct`
- Returns null when position healthy and in range
- Skips suspicious pnl ticks (`pnl_pct_suspicious` flag)

**`queuePeakConfirmation()` / `resolvePendingPeak()`**
- Queues pending peak only when pnl exceeds prior recorded peak
- Resolves confirmation within tolerance band
- Rejects confirmation outside tolerance band (drops the pending peak)

---

### `test/unit/signal-weights.test.js`
Covers: `signal-weights.js`

**`recalculateWeights()`**
- Boosts weight for signal correlating with winners
- Decays weight for signal correlating with losers
- Never goes below `weightFloor` (0.3)
- Never exceeds `weightCeiling` (2.5)
- Skips recalc when fewer than `minSamples` (10) records

**`getWeightsSummary()`**
- Returns null when no weights file exists
- Returns formatted string with all signal weights listed

---

### `test/unit/pool-memory.test.js`
Covers: `pool-memory.js`

- `recordPoolDeploy`: stores entry keyed by pool address
- `recallForPool`: returns null for unknown pool; returns summary string for known pool
- `recordPositionSnapshot`: appends snapshot to pool history, trims old snapshots

---

### `test/unit/strategy-library.test.js`
Covers: `strategy-library.js`

- `addStrategy`: validates required fields (name, lp_strategy)
- `setActiveStrategy`: marks one strategy active, clears active flag on all others
- `getActiveStrategy`: returns null when no strategy is active
- `removeStrategy`: deletes correct entry by name, returns count removed

---

### `test/unit/agent.test.js`
Covers: pure helper functions in `agent.js`

**`getToolsForRole()`**
- MANAGER: returns only tools in `MANAGER_TOOLS` set
- SCREENER: returns only tools in `SCREENER_TOOLS` set
- GENERAL + "deploy" intent: includes deploy-related tools
- GENERAL + "close" intent: includes close-related tools
- GENERAL + no intent match: returns all non-intent-only tools

**`shouldRequireRealToolUse()`**
- Returns true for `MUTATING_TOOL_INTENTS` ("deploy", "close", "swap", "claim")
- Returns false for MANAGER role (always)
- Returns false for decision explanation intents ("why did you...")
- Returns true for `LIVE_DATA_TOOL_INTENTS` only when `interactive=true`

---

## Layer 2 — Mocked Tests (SDK/I/O Wiring)

Files in this layer mock network calls, Solana SDK, and Meteora SDK. Tests verify logic flow, param passing, and error handling.

### `test/mocked/executor.test.js`
Covers: `tools/executor.js`

**`runSafetyChecks()` — deploy_position**
- Blocks: `bin_step` below `minBinStep`
- Blocks: `bin_step` above `maxBinStep`
- Blocks: total bins (`bins_below + bins_above`) < `MIN_SAFE_BINS_BELOW` (35)
- Blocks: `maxPositions` already reached (force-fresh position count)
- Blocks: duplicate pool (same `pool_address` already open)
- Blocks: duplicate base token (same `base_mint` in another pool)
- Blocks: `amount_x > 0` (tokenX-only not supported)
- Blocks: `amount_y <= 0`
- Blocks: `amount_y < deployAmountSol` floor
- Blocks: `amount_y > maxDeployAmount` ceiling
- Blocks: SOL balance insufficient (`balance < amount_y + gasReserve`)
- Skips SOL balance check when `DRY_RUN=true`
- Blocks: pool TVL below `minTvl`
- Blocks: pool TVL above `maxTvl`
- Blocks: `fee_active_tvl_ratio` below `minFeeActiveTvlRatio`
- Passes: all valid args produce `{ pass: true }`

**`runSafetyChecks()` — self_update**
- Blocks when `ALLOW_SELF_UPDATE != "true"`
- Blocks when `process.stdin.isTTY` is false

**`executeTool()`**
- Returns `{ error }` for unknown tool name
- Strips model artifacts (`<|channel|>`) from tool name before dispatch
- Calls `notifyDeploy` on successful `deploy_position`
- Calls `notifyClose` on successful `close_position`
- Auto-swaps base token to SOL after close when base balance ≥ $0.10
- Skips auto-swap when `skip_swap=true`
- Auto-swaps claimed token after `claim_fees` when `autoSwapAfterClaim=true`
- Returns `{ blocked: true, reason }` when safety check fails
- `update_config`: applies to live config + persists to `user-config.json`
- `update_config`: restarts cron jobs when interval keys changed
- `update_config`: redacts sensitive keys in logs (`gmgnApiKey`, `hiveMindApiKey`)
- `update_config`: saves a lesson for self-tuning events (excluding interval keys)

---

### `test/mocked/dlmm.test.js`
Covers: `tools/dlmm.js`  
Mocks: `@meteora-ag/dlmm` DLMM class, `@solana/web3.js` Connection + `sendAndConfirmTransaction`

**`getMyPositions()`**
- Returns empty positions array when wallet has no DLMM positions
- Returns normalized position objects with `pnl_pct`, `in_range`, `age_minutes`
- Uses cache when `force=false` and cache is fresh
- Force-fetches and updates cache when `force=true`

**`getPositionPnl()`**
- Returns `pnl_usd`, `pnl_pct`, `fees_earned_usd` for open position
- Returns error when position address not found

**`deployPosition()`**
- Calls `DLMM.create` and `addLiquidityByStrategy` with correct params
- Returns `pool_name`, position address, tx signature, `price_range`, `range_coverage`
- Calls `trackPosition` in `state.js` after successful deploy
- Returns error object on transaction failure (RPC error)

**`closePosition()`**
- Calls `removeLiquidity` and `closePosition` on DLMM instance
- Calls `recordPerformance` in `lessons.js` after close
- Returns `pnl_usd`, `pnl_pct`, `fees_earned_sol`

**`claimFees()`**
- Calls `claimSwapFee` on DLMM instance
- Returns `fees_earned_usd`, `base_mint`
- Returns error when no unclaimed fees available

**`getActiveBin()`**
- Returns `binId` and price for current active bin

---

### `test/mocked/wallet.test.js`
Covers: `tools/wallet.js`  
Mocks: `global.fetch` (Helius RPC, Jupiter price + swap API)

**`getWalletBalances()`**
- Returns `sol` balance and `tokens` list from Helius response
- Returns `sol_usd` and `sol_price` from Jupiter price feed
- Returns empty `tokens` array on Helius error (graceful degradation)
- Falls back to basic RPC when `HELIUS_API_KEY` not set

**`swapToken()`**
- Calls Jupiter `/quote` then `/swap` with correct params
- Submits transaction to RPC and returns tx signature
- Returns `amount_in`, `amount_out` after successful swap
- Returns error on Jupiter quote failure
- Skips transaction submission when `DRY_RUN=true`

---

### `test/mocked/screening.test.js`
Covers: `tools/screening.js`  
Mocks: `global.fetch` (Meteora Pool Discovery API)

**`discoverPools()`**
- Returns normalized pool list from API response
- Filters out pools missing required fields (`tvl`, `organic_score`)
- Respects `page_size`, `timeframe`, `category` params

**`getTopCandidates()`**
- Filters by `blockedLaunchpads` before returning candidates
- Filters by `minFeeActiveTvlRatio`, `minOrganic`, `minHolders`
- Scores and ranks candidates by `fee_tvl_ratio` + `organic_score`
- Returns empty `candidates` array when all filtered out
- Returns `filtered_examples` with per-candidate disqualification reasons

---

### `test/mocked/gmgn.test.js`
Covers: `tools/gmgn.js`  
Mocks: `global.fetch` (GMGN OpenAPI)

**`gmgnFetch()`**
- Adds `GMGN_API_KEY` header when set
- Retries up to `maxRetries` on 429/5xx responses
- Respects `requestDelayMs` delay between retries
- Throws after exhausting all retries

**`discoverGmgnPools()`**
- Applies `minMcap`, `minHolders`, `maxBundlerRate` hard filters
- Applies KOL requirement filter when `requireKol=true`
- Applies indicator filter when `indicatorFilter=true`
- Returns `stage_counts` funnel report with per-stage drop counts
- Returns `all_filtered` entries with rejection reasons

---

### `test/mocked/token.test.js`
Covers: `tools/token.js`  
Mocks: `global.fetch` (Jupiter token API, Jupiter audit API)

**`getTokenInfo()`**
- Returns `name`, `symbol`, `mcap`, `holders`, `launchpad` from Jupiter
- Returns audit fields: `bot_holders_pct`, `top_holders_pct`
- Returns null for unknown mint

**`getTokenHolders()`**
- Detects bundlers via `common_funder` signal
- Detects bundlers via `funded_same_window` signal
- Returns `bundler_pct`, `top10_pct`, `flagged_wallets`
- Passes when `bundler_pct < maxBundlersPct` threshold

**`getTokenNarrative()`**
- Returns narrative string from Jupiter metadata
- Returns null when no narrative available

---

### `test/mocked/telegram.test.js`
Covers: `telegram.js`  
Mocks: `global.fetch` (Telegram Bot API)

**`sendMessage()`**
- Sends message to configured `TELEGRAM_CHAT_ID`
- Retries on network error
- Silently no-ops when `TELEGRAM_BOT_TOKEN` not configured

**`notifyDeploy()`**
- Formats deploy message with pool name, amount SOL, price range
- Includes Solscan tx link

**`notifyClose()`**
- Formats close message with `pnl_usd` and `pnl_pct`
- Uses profit emoji for positive PnL, loss emoji for negative

---

## Coverage Targets

| Layer | Target | Rationale |
|-------|--------|-----------|
| Unit (pure logic) | ≥ 90% | No external deps — full branch coverage achievable |
| Mocked (SDK wiring) | ≥ 70% | Covers happy path + main error paths |
| Overall | ≥ 75% | Realistic for a project with heavy SDK surface area |

---

## Explicit Exclusions

| File | Reason |
|------|--------|
| `index.js` | Orchestration glue; covered indirectly via executor + agent tests |
| `cli.js` | Interactive REPL; better covered by manual smoke test |
| `briefing.js` | Thin wrapper over Telegram HTML; low logic density |
| `hivemind.js` | External service sync; mocking adds little value |
| `envcrypt.js` | Build-time utility; not part of runtime logic |
| `setup.js` | Interactive installer; not part of runtime logic |
| `scripts/` | Build scripts; not part of runtime logic |
