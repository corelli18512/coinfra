---
"@coinfra/pulse": patch
---

Bound duplicate cursor repair so a burst of stale ACKs emits one RESET and retained suffix instead of amplifying into a resend storm. Retry a lost repair on the heartbeat timer, ignore regressive ACKs, and keep the TypeScript and Swift state machines aligned.
