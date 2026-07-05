<h1 align="center">🪙 coinfra</h1>
<p align="center"><strong>Shared infrastructure wheels for every product.</strong><br/>One coin, many machines.</p>

---

`coinfra` is a monorepo of reusable infrastructure packages ("wheels") shared across all
products — overseas (出海) and domestic (国内) alike. Build a capability once, reuse it everywhere.

## First wheel: Pulse (可靠传输)

A reliable-delivery layer for a breakable WebSocket channel — the thing you reach for when a
plain socket keeps dropping under long-distance, long-lived, or flaky links.

| Package | What |
|---|---|
| [`@coinfra/pulse`](packages/pulse) | The delivery contract: message sequencing, acks, cursor-based resume, and a durable outbox. A sans-I/O core (bring your own transport + storage) with byte-identical **TypeScript + Swift** ports sharing the same wire fixtures. Moves opaque payload bytes between two peers with in-order, exactly-once delivery — or makes loss explicit. Knows nothing about your app. |

```bash
pnpm add @coinfra/pulse
```

```ts
import { Endpoint } from '@coinfra/pulse';
// feed it your transport + storage; drive it with send / onBytes / onTick;
// it emits transmit / deliver / store effects. See packages/pulse/README.md.
```

## Toolchain (SOTA)
pnpm 10 workspaces + catalog · Turborepo 2 · TypeScript 6 (ESM-only) · tsdown (Rolldown) ·
Biome 2 · Vitest 4 · Changesets · Node 24. Publishing via npm **Trusted Publishing (OIDC)** —
no long-lived tokens.

## Develop
```bash
pnpm install
pnpm build       # turbo build all wheels
pnpm test        # vitest across workspace
pnpm typecheck
pnpm lint        # biome
```

## Release
Each change ships with a [changeset](https://github.com/changesets/changesets)
(`pnpm changeset`). Merging to `main` lets CI open a "Version Packages" PR; merging that
publishes to npm automatically over OIDC.

## License
MIT © corelli
