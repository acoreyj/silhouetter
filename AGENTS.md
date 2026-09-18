# Agent notes

## Toolchain

Node and pnpm come from [vite-plus](https://viteplus.dev); there is no
system-wide `node` on `PATH`. Non-interactive shells do not source the
vite-plus environment, so run this once per shell before any `pnpm`/`node`
command:

```sh
. /home/corey/.config/vite-plus/env
```

(That prepends `~/.local/share/vite-plus/bin` to `PATH`, where `node`, `pnpm`
and `vp` are shims onto the bundled runtime.)

Do not use the Windows `node.exe` from `/mnt/c/...`: it cannot follow the WSL
symlinks in `node_modules`, so module resolution fails.

## Common commands

```sh
pnpm install      # install dependencies
pnpm test         # vitest run (single pass); pnpm test:watch to watch
pnpm check        # svelte-kit sync + svelte-check / TypeScript
pnpm build        # static production build in build/
pnpm dev          # dev server
pnpm preview      # preview the build
```

Run `pnpm check` and `pnpm test` before considering a change done. The test
suite is plain Vitest (`src/**/*.test.ts`); there is no separate lint step.

For driving the editor in a real browser (import → segment → export), see
[`docs/chrome.md`](docs/chrome.md).
