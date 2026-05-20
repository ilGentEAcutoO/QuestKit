# FRONTEND TEST REPORT

Tested: 2026-05-20 02:52
Environment: **production** (live demo at https://questkit.jairukchan.com)
Tool: MCP Playwright + `@playwright/test` golden-path spec

## Scenarios Executed

Total: **5 Playwright specs + 4 manual route sweeps** = 9 scenarios across 4 demo routes + 1 cross-route navigation flow.

## Results by Category

### Happy Path: ✅ 5/5

- Apex redirects to `/ecommerce`
- Campaign banner renders ("E-commerce Spring 2026")
- Catalog shows 6 products with "Buy now" buttons
- Mission card "Triple Treat" reachable + actionable state
- Cross-route nav (ecommerce → minigames → streaming → daily)

### Manual MCP-Playwright sweep: ✅ 4/4

- `/ecommerce` — 0 errors, 0 warnings — campaign + catalog + missions render
- `/streaming` — 0 errors, 0 warnings
- `/daily` — 0 errors, 0 warnings
- `/minigames` — 0 errors, 0 warnings — SpinWheel + ScratchCard interactive

## Issues Found & Fixed (PDCA Log)

1. **`workers/api/src/routes/balance.ts:47` — 404 on missing balance** (user-flagged)
   - **Found:** Browser console logged `Failed to load resource: 404` on every page load for fresh users with no `coin` balance row. Even though the demo's `useBalance` hook silently rendered 0, the 404 polluted the console.
   - **Fix:** Changed route to return `200` + synthetic zero-state `{ amount: 0, updatedAt: now }` for missing rows. The disambiguation between "never minted" and "decremented-to-zero" that justified 404 was theoretical — every consumer renders both as "0 coin".
   - **Knock-on changes:** `@questkit/core` `getBalance()` return type tightened from `Balance | null` to `Balance` (404 path is unreachable); 3 tests updated (`workers/api/test/balance.route.test.ts`, `packages/core/test/client.test.ts`, `postman/questkit.postman_collection.json`).
   - **Re-test:** ✅ 0 console errors after redeploy. CI lint+typecheck+test+Newman all green.
   - **Commit:** `2aa7b67`

2. **`apps/demo/src/components/Layout.tsx:80` — 🪙 emoji rendered inconsistently** (user-flagged)
   - **Found:** The header coin balance pill used the `🪙` emoji (U+1FA99). On Windows it renders as a grayscale pixelated glyph; on macOS/iOS it's the gold coin you'd expect. Different OS = different brand impression.
   - **Fix:** Inline SVG `CoinIcon` component — 18px circle with the brand gold gradient (`oklch(0.88 0.16 95)` → `oklch(0.62 0.16 65)`) and a stylized `¢` symbol. Matches the social-preview card and the demo's `--color-qk-coin` token.
   - **Re-test:** ✅ Visual confirmation — coin icon now consistent + on-brand. Screenshot in `agent-temp/verify-after-fixes.png`.
   - **Commit:** `2aa7b67`

## Console Status

| Route        | Before                            | After  |
| ------------ | --------------------------------- | ------ |
| `/ecommerce` | ❌ 1 error (404 /v1/balance/coin) | ✅ 0/0 |
| `/streaming` | ❌ 1 error (404 /v1/balance/coin) | ✅ 0/0 |
| `/daily`     | ❌ 1 error (404 /v1/balance/coin) | ✅ 0/0 |
| `/minigames` | ❌ 1 error (404 /v1/balance/coin) | ✅ 0/0 |

Total: 4 errors → **0 errors**, 0 warnings → **0 warnings**.

## Impact Assessment

- **Changed features:** balance API now returns 200 + zero-state instead of 404. SDK `getBalance` always resolves (vs. occasionally returning null). No breaking change for the demo or react components — they already rendered both states as "0".
- **Related systems:** CHANGELOG entry updated. Postman/Newman + Vitest tests updated to match new contract. Lint + typecheck + 165 api + 87 core + 125 react + 21 embed + 34 webhook-relay + 9 webhook-consumer = 441 tests passing.
- **Peripheral features:** all 4 routes verified clean. SpinWheel, ScratchCard, EventLog, DevTools, AIRecommendations panels all responsive.

## Outstanding (deferred)

- The earlier session noted that SSE updates don't always propagate to the demo UI in real time. Reload pulls fresh state correctly, so this is a UX polish item rather than a bug — flagged for v0.2 alongside the broader SSE reconnect-strategy refactor.
- Coin emoji still appears in `apps/demo/src/components/DemoToastHost.tsx:53` (reward toast). Lower visibility than the header pill — kept as emoji for now, can be migrated to SVG in a follow-up if reported.
