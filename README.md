<h1 align="center">🪙 coinfra</h1>
<p align="center"><strong>Shared infrastructure wheels for every product.</strong><br/>One coin, many machines.</p>

---

`coinfra` is a monorepo of reusable infrastructure packages ("wheels"). Build a capability
once, reuse it everywhere.

## Wheels

| Package | What |
|---|---|
| [`@coinfra/crypto`](packages/crypto) | Hybrid RSA-OAEP + AES-256-GCM encryption, multi-recipient blobs, and challenge-response signing. |
| [`@coinfra/pulse`](packages/pulse) | Reliable message delivery over a breakable WebSocket. |

## Toolchain

pnpm 11 workspaces + catalog · Turborepo 2 · TypeScript 7 native (`tsgo`) · Biome 2 ·
Vitest 4 · Changesets · Node 26. Publishing via npm Trusted Publishing (OIDC).

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
(`pnpm changeset`). Merging to `main` opens a "Version Packages" PR; merging that publishes
to npm over OIDC.

## License

MIT © corelli
