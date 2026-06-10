# AGENTS.md

## Project Context

Token Horse is a zero-dependency terminal pet: a 16x4 braille horse that gallops faster as the host CLI session consumes more tokens per second. It targets two hosts:

- **Claude Code** — via the official `statusLine` command hook (stdin JSON, one frame per invocation).
- **Codex CLI** — via `--watch-codex`, which tails `~/.codex/sessions/**/rollout-*.jsonl` because Codex does not support custom statusline commands.

Single runtime file (`horse-token-runner.mjs`), no external dependencies, Node >= 22.

## Build & Test

- Check everything: `npm run check` (syntax check + node:test + OSS hygiene gate)
- Tests only: `npm test`
- Demo animation: `npm run demo`
- Regenerate preview GIF: `npm run preview` (requires ImageMagick `magick` on PATH)

## Stack & Conventions

- Runtime: Node.js >= 22, ESM (`.mjs`), zero runtime dependencies — keep it that way.
- Constants are declared at the top of the file.
- Comments in Korean (project convention); identifiers in English.
- Tests use `node:test` + `node:assert/strict` in `tests/`.

## Critical Rules

- **No runtime dependencies.** The whole point is `npx token-horse` with nothing else.
- **Never break the 16x4 frame contract** — tests pin rows=4, columns<=16, pixels 32x16.
- **State writes go only under** `$XDG_STATE_HOME/token-horse/` (default `~/.local/state/token-horse/`).
- `session_id` is sanitized (`[^a-zA-Z0-9_-]` stripped, max 64 chars) before being used in a state filename — keep that path-traversal guard.
- Statusline mode must stay one-shot: read stdin once, print one frame, exit. No timers, no network.
- `--watch-codex` reads only the tail (last 64KB) of session logs — do not load whole files.
- Keep color output run-length encoded; plain output must equal color output with ANSI stripped (test-pinned).

## File Structure

```
horse-token-runner.mjs    — runtime + CLI (statusline / watch-codex / demo modes)
render-horse-preview.mjs  — dev tool: renders horse-preview.gif via ImageMagick
tests/token-horse.test.mjs
scripts/check-oss-hygiene.mjs — publish/CI gate (internal-info leak + version sync)
```

## When to Ask

- Before adding any runtime dependency.
- Before changing the state file location or format (breaks running installations).
- Before changing the published bin name or package name.
