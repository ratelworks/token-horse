# Changelog

## 0.2.0 — 2026-06-19

### Added

- Skins: pick a palette with `--skin=<name>`. Ships with `green` (the original default), `rapidash` (cream coat with a flickering red-and-yellow fire mane and tail that wavers every frame, after the Pokémon), `bay` (a realistic brown horse with a black mane and hooves), `redhare` (Red Hare 赤兔馬, the crimson Three Kingdoms warhorse), and `inferno` (the whole horse ablaze).
- Palettes are split by body part (coat / mane + tail / hooves), so character skins re-colour each part independently while reusing the exact same gallop animation. Single-colour skins paint the whole silhouette in one range. `green` stays the default, so existing setups are unchanged.
- Discoverability: `token-horse --list-skins` previews every skin in color, `--help` / `-h` lists all options, and an unknown `--skin` now prints a hint (pointing to `--list-skins`) instead of silently falling back.
- `render-horse-preview.mjs` now accepts `--skin=<name>` to render a per-skin preview GIF.

## 0.1.4 — 2026-06-15

### Changed

- English README is now the default (`README.md`); the Korean version moved to `README.ko.md`. Token Horse targets a global audience, so English leads and Korean follows.
- Brought the English docs fully up to date (`--info-cmd` usage, 8-row default frame) and switched the changelog to English.

## 0.1.3 — 2026-06-10

### Changed

- Polished the Korean README's tone and softened the intro copy.
- Documented `--info-cmd` for running the horse alongside an existing statusline script.

## 0.1.2 — 2026-06-10

### Changed

- Made the Korean README the default (`README.md` = Korean, `README.en.md` = English). *(Reverted in 0.1.4 — English is now the default.)*
- Added a demo GIF of the real statusline (info line + horse on the right; gallop ↔ idle ↔ blink).
- Credited the inspiration: the little horse on old Korean taxi meters that ran faster as the fare climbed.

## 0.1.1 — 2026-06-10

Tuned the motion model so speed is visible on fast (high token-rate) models.

### Changed

- Instant token pulses: when a transcript/Codex cumulative increment arrives, the horse jumps straight to the measured speed (no EMA) and decays slowly (0.95/sec) — it keeps sprinting mid-task and only stops when truly idle.
- Idle standstill: below 5 tokens/sec the legs stop and the horse stands upright.
- Statusline pose-jump cap (4 frames per poll): fixes the high-speed "random pose" look under once-per-second refresh. 4 is coprime with 15, so it cycles through every frame and the original mane micro-motion plays naturally.
- Eye blink: clear eyes normally, half-closed for 1 second every 6 seconds — always visible.
- Verified pixel-identical to the original 15 frames (OpenGameArt, CC0) with zero diff aside from an alignment shift.

## 0.1.0 — 2026-06-10

First public release of the token-rate-reactive horse pet for Claude Code statuslines and Codex CLI.

### Added

- 16-char × 4-row braille horse animation (15-frame gallop cycle, three shades of green).
- Continuous speed mapping: 20 tokens/sec (slow) to 900+ tokens/sec (full sprint), with exponential decay to a standstill when input stops.
- `--statusline` mode: reads Claude Code statusline JSON (stdin) once → prints one frame. Per-`session_id` state isolation supports concurrent multi-session use (state older than 48 hours is pruned automatically).
- `--watch-codex` mode: since Codex CLI does not support custom statusline commands, it tails the `token_count` events in the session log (`rollout-*.jsonl`) and renders a continuous animation.
- Input formats: direct `tokensPerSecond` / cumulative tokens (`usage.total_tokens`, etc.) / Claude Code `transcript_path` (per-turn billable token increment from the session JSONL = input + output + cache_creation, excluding cache reuse) / Codex `total_token_usage.total_tokens`. `context_window` occupancy is dominated by cache reuse and drops on compaction, making it unsuitable as a speed signal, so it is not used.
- Run-length color encoding minimizes statusline output (`--plain` for colorless output).
