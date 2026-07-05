---
"@coinfra/pulse": patch
---

Ship a dual ESM + CJS build. The package now exposes a `require` entry
(`dist/index.cjs`) alongside the ESM `dist/index.mjs`, so CJS-first resolvers —
notably tsx's tsconfig-paths resolver, used by consuming apps that run TypeScript
sources directly — can resolve the package. Without the CJS entry, those apps
fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Runtime behavior is unchanged.
