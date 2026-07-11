---
"@coinfra/pulse": patch
---

Treat a restored endpoint as a new send-stream epoch so peers reset stale receive cursors after process restarts instead of dropping rewound non-durable sequence numbers as duplicates.
