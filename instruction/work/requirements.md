# Requirements — Phase 8 / v0.1.4

> Saved: 2026-05-20 18:20
> Source: direct user message (Thai)

## Original wording (verbatim)

> คือเหมือนโปรแกรมยังไม่สมบูรณ์อ่ะ ใน demo คือกด claim ไปแล้วบางทีก็ค้าง
> แล้วก็เเลข 19/5 6/1 มันคืออะไรไม่เห็นมันลดลง คือหน้าอื่น ๆ ก็ค้างไปเลย
> logging... อะไรเงี้ย หน้า watch ก็ค้าง reset demo user แล้วก็ไม่เห็น
> reset สิ่งที่ claimed ไปแล้ว คือแน่ใจแล้วหรอว่ามันใช้ได้อ่ะ
> AI picks ก็เจอ 502 นายใช้อะไรทำงาน worker มันรองรับจริงไหม
> ตัวที่เชื่อมต่อกันมันเสร็จหมดแล้วแน่ใช่ไหม
> เช็คงานด้วยการคลิกและการลองใช้จริง ๆ ผ่าน บราวเซอร์คลิกให้ละเอียดเลยครับ
> ตอนนี้มันใช้ไม่ได้เลย เก็บให้ครบทุกปุ่ม ทุก scenario นะต้องทำงานได้
> /workflow-plan แก้เดี๋ยวนี้ https://questkit.jairukchan.com/ecommerce

## Reported defects (live demo)

1. Claim button hangs ("Claiming…" forever, never resolves)
2. Counter displays nonsense: `19/5` and `6/1` never decrement
3. Other pages stuck on "logging…"
4. Watch page (Streaming) hangs
5. Reset demo user does not actually reset claimed missions
6. AI picks endpoint returns 502
7. Doubt that Cloudflare Workers backend is fully wired up / can actually support the workload

## Acceptance criteria

- ✅ Every button on every demo route (ecommerce, streaming, daily, minigames) works on the live deployed URL
- ✅ Every E2E scenario covered by a Playwright test executed against the live deploy
- ✅ No 502/timeout/console-error during a 10-minute end-to-end smoke run
- ✅ Counter never displays a value greater than target (display-cap or progress-reset)
- ✅ Reset demo user clears server-side state too — claimed missions return to claimable
- ✅ AI picks returns recommendations OR a graceful empty-state with cached fallback (no raw 502)
- ✅ Production deploy is reproducible from CI — no more manual `wrangler deploy` from a dev machine
- ✅ D1 migrations applied automatically in CI

## Out of scope

- v0.2 features (Vue adapter, multi-provider webhooks, leaderboards)
- Architectural rewrites (SSE → WebSocket etc.)
- Workers AI model migration beyond a graceful fallback for the current deprecation window
