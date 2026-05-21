# Requirements — Phase 9 / v0.1.5

> Created: 2026-05-21 10:15
> Source: User messages from `/workflow-plan` session, captured verbatim

## Original user requests (verbatim, in chronological order)

### 1. Phase 9 status check + scope decision

> เหมือนนายจะบอกว่า phase 9 ว่าแต่มันเสร็จรึยังเนี่ยหลากยกละนะ

(Interpreted: question about whether Phase 9 was already underway. Answer: it was not — Phase 8 was archived, no Phase 9 plan existed yet.)

### 2. Bug reports (production smoke of v0.1.4)

> ตอนนี้กด claim ไปมี toast ข้นได้ 100 coin แต่ coin ไม่เข้าจริงและ จำนวนที่ claim ได้ก็ไม่ลดลง

> อันนี้หน้า e-com นะที่เพิ่งบอกไป

> อีกหน้าือ steaming claim daily watcher มาแล้ว coin ขึ้น แต่ 1/1 ไม่ลด

> หน้า daily steak checkin แล้วกด claim badge เสร็จ ก็ไม่ลดจาก 1/1 เหมือนกัน

> หน้า mini game scratch card กับ spin wheel ขึ้นว่าได้ทองแต่ไม่เข้า coin จริง

> ส่วน AI picks unavailable right now.

(Frustration after extended planning):

> เนี่ยปัญหาที่บอกไปแต่แรกไมไ่ด้แก้เลย แล้วแก้อะไรอยู่ งงมาก

### 3. Scope decisions (from Q&A)

- **Phase 9 scope:** `TASK-011 + TASK-012 รวม (v0.1.5 ฉบับเต็ม)` — bundle CI gate + polish into v0.1.5
- **Plan mode:** `Finalize เลย (พร้อมลุย)` — populate todos.md immediately
- **After bug reports:** `ปิดแผน Phase 9 ให้เสร็จก่อน (รวม bugs + TASK-011 + TASK-012)` — keep planning; absorb new bugs into Phase 9

### 4. Final user direction

> เอางี้ แก้ให้หมครับที่เป็น bug อ่ะ
>
> ขอรอบนี้รอบเดียวจบเลย

(Interpreted: fix every confirmed bug; finalize plan in one shot, no more Q&A.)

## Bug ↔ symptom map (research-mapped, traceable to user wording)

| User-reported                 | Plan ID | Page         | Mapped to research cluster            |
| ----------------------------- | ------- | ------------ | ------------------------------------- |
| `coin ไม่เข้าจริง`            | B1      | /ecommerce   | C1 (claim broadcast)                  |
| `จำนวนที่ claim ได้ก็ไม่ลดลง` | B1      | /ecommerce   | C1 (claim broadcast — status flip)    |
| `1/1 ไม่ลด` (streaming)       | B3      | /streaming   | C2 (widget reconciliation)            |
| `ไม่ลดจาก 1/1` (daily)        | B4      | /daily       | C2 (widget reconciliation)            |
| `ขึ้นว่าได้ทองแต่ไม่เข้า`     | B5      | /minigames   | C3 (minigame toast honesty)           |
| `AI picks unavailable`        | B6      | global panel | TASK-006 spike (verify before fixing) |

## Decisions made on user's behalf

When user said `แก้ให้หมดที่เป็น bug` and `ขอรอบนี้รอบเดียวจบเลย`, the following sub-decisions were finalized without further Q&A:

- **B5 fix approach:** option (a) — honest label fix (the lying toast IS a bug). Option (b) — wiring server-side coin mint for minigames — is a NEW FEATURE, not a bug fix, deferred to Phase 10 backlog.
- **B6 fix approach:** verification spike (TASK-006). User reported the message as a bug; research verdict is "TASK-002 fallback working as designed." Spike resolves the ambiguity in ~10 minutes via curl + 1-line observability log. Outcome decides whether to close as non-bug or escalate.

## In-scope / out-of-scope

**In-scope for Phase 9 / v0.1.5:**

- All 11 confirmed defects (B1, B3, B4, B5 + D1, D2, D3, D4, D5, D6) — see plan.md cluster table
- TASK-011 carry-over (CI E2E gate unblock)
- TASK-006 B6 investigation spike
- Version bump + CHANGELOG + walkthrough verification

**Out-of-scope:**

- Server-side minigame coin mint (B5 option b)
- New features beyond bug fixes
- Refactors not driven by a defect
- Storybook adoption (no MCP server present)
