# AGENTS.md

## Project Context

Token Horse is a zero-dependency terminal pet: a half-block pixel horse (32x8 chars by default, 16x4 with `--size=s`) that gallops faster as the host CLI session consumes more tokens per second. It targets two hosts:

- **Claude Code (mod)** — the repository root is also a Claude Code plugin: `hooks/register.tsx` draws the horse as a `Raster` in the band above the prompt, repaints it with `$.ui.blit`, and reads speed from the `turn.step` stream. Installed with `/plugin install token-horse --marketplace ratelworks/token-horse`.
- **Claude Code (statusline)** — via the official `statusLine` command hook (stdin JSON, one frame per invocation).
- **Codex CLI** — via `--watch-codex`, which tails `~/.codex/sessions/**/rollout-*.jsonl` because Codex does not support custom statusline commands.

Sprites, skins and the speed curve live in `horse-core.mjs` (no Node APIs), shared by the CLI (`horse-token-runner.mjs`) and the mod. No external dependencies, Node >= 22.

## Build & Test

- Check everything: `npm run check` (syntax check + node:test + OSS hygiene gate)
- Tests only: `npm test`
- Mod: `npm run check:mod` (`claude plugin validate .` + `claude plugin test .`, runs `hooks/register.test.tsx` on Claude Code itself)
- Demo animation: `npm run demo`
- Regenerate preview GIF: `npm run preview` (requires ImageMagick `magick` on PATH)

## Stack & Conventions

- Runtime: Node.js >= 22, ESM (`.mjs`), zero runtime dependencies — keep it that way.
- Constants are declared at the top of the file.
- Comments in Korean (project convention); identifiers in English.
- Tests use `node:test` + `node:assert/strict` in `tests/`.

## Critical Rules

- **No runtime dependencies.** The whole point is `npx token-horse` with nothing else.
- **Never break the frame contract** — tests pin L: rows=8/columns<=32, S: rows=4/columns<=16, source pixels 32x16.
- **State writes go only under** `$XDG_STATE_HOME/token-horse/` (default `~/.local/state/token-horse/`).
- `session_id` is sanitized (`[^a-zA-Z0-9_-]` stripped, max 64 chars) before being used in a state filename — keep that path-traversal guard.
- Statusline mode must stay one-shot: read stdin once, print one frame, exit. No timers, no network.
- `--watch-codex` reads only the tail (last 64KB) of session logs — do not load whole files.
- Keep color output run-length encoded; plain output must equal color output with ANSI stripped (test-pinned).
- **One speed scale.** Speed is input-equivalent tokens/sec: usage weighed by price relative to plain input (`CLAUDE_USAGE_WEIGHTS`, `CODEX_USAGE_WEIGHTS` in `horse-core.mjs`). CLI and mod must both go through `weighClaudeUsage` / `tokenRateToLegFps` — never a second formula.
- **`horse-core.mjs` stays Node-free.** The mod runs in Claude Code's own environment (no Node, no DOM); importing `node:*` there breaks the mod.
- **The mod only observes the stream.** Its `turn.step` hook re-yields every chunk unchanged and swallows its own counting errors.
- **Skins are palette-only.** `SKIN_HEX` holds per-part colours (body / mane / hoof) and `partPaletteAt` maps the shared 32x16 sprite to parts. Adding a skin = one `SKIN_HEX` entry — never fork or duplicate the pixel frames. `green` must stay the default for backward compatibility.

## File Structure

```
horse-core.mjs            — sprites, skins, usage weights, speed curve (shared, Node-free)
horse-core.d.mts          — its types, for the mod
horse-token-runner.mjs    — runtime + CLI (statusline / watch-codex / demo modes)
.claude-plugin/           — plugin.json (userConfig: skin, size) + marketplace.json
hooks/register.tsx        — the Claude Code mod; hooks/register.test.tsx its tests
types/index.d.ts          — the mod's $.state contract
render-horse-preview.mjs  — dev tool: renders horse-preview.gif via ImageMagick
tests/token-horse.test.mjs
scripts/check-oss-hygiene.mjs — publish/CI gate (internal-info leak + version sync)
```

## When to Ask

- Before adding any runtime dependency.
- Before changing the state file location or format (breaks running installations).
- Before changing the published bin name or package name.
