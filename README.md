# Token Horse

A terminal pet for [Claude Code](https://code.claude.com) — a tiny pixel horse that gallops faster as your session burns more tokens per second.

Inspired by the little galloping horse that used to ride on old Korean taxi meters: the faster the fare ticked up, the faster it ran. Same idea here — the harder your model works, the harder this horse gallops.

[한국어 README](./README.ko.md)

![Token Horse — gallops while tokens flow, stands when idle](https://raw.githubusercontent.com/ratelworks/token-horse/main/statusline-demo.gif)

## Install

```bash
npm install -g token-horse
```

Or just watch the demo without installing:

```bash
npx token-horse --rate=6000 --duration=8
```

## Claude Code mod (recommended)

Claude Code 2.1.275+ can load **mods** — plugins that draw straight into its interface. As a mod, Token Horse lives in a band just above the prompt and animates smoothly (up to 30 frames a second), instead of being redrawn once per statusline poll. At the prompt of a terminal session:

```text
/plugin install token-horse --marketplace ratelworks/token-horse
```

Answer `y` to add the marketplace, then pick a scope. From a shell, the same is `claude plugin install token-horse --marketplace ratelworks/token-horse`.

- **Pick a skin and size** in the config menu (`/config`): `skin` is one of the skins below, `size` is `s` (16×4, default) or `l` (32×8).
- **Show or hide** it with `/token-horse hide` and `/token-horse show` (bare `/token-horse` toggles). The choice is remembered across sessions.
- The speed is read from every model request of the session, subagents included: the response stream makes the horse react the moment output starts, and each request's real usage — cached context included — sets the pace once it completes. The number on the right is that rate.
- The band draws only in the terminal, and steps aside when the terminal is too narrow, when a survey takes the band, or while the horse is hidden.

The statusline setup below keeps working; use it on older Claude Code versions or if you prefer the statusline.

## Claude Code statusline

Wire it into the `statusLine` field of your `settings.json`. The status line officially supports multi-line output, so the horse renders as-is.

```json
{
  "statusLine": {
    "type": "command",
    "command": "token-horse --statusline",
    "padding": 0,
    "refreshInterval": 1
  }
}
```

- `refreshInterval: 1` is recommended. By default the status line only re-runs on events (new responses, compaction, and so on), so the 1-second timer is what lets the horse slow down naturally during the quiet gaps between responses.
- Already running a statusline script? Show it next to the horse with `--info-cmd`. Your existing info line stays on the left, and the horse takes the empty space on the right:

```json
{
  "statusLine": {
    "type": "command",
    "command": "token-horse --statusline --info-cmd=\"bash $HOME/.claude/statusline.sh\"",
    "padding": 0,
    "refreshInterval": 1
  }
}
```

- If your terminal doesn't render truecolor ANSI properly, add `--plain`.

## Skins

Token Horse ships with several palettes. Pick one with `--skin=<name>` — the default is `green`. Run `token-horse --list-skins` to preview them all (in color, right in your terminal), or `token-horse --help` for every option.

| Skin | Preview | Look |
|------|---------|------|
| `green` | ![green skin](https://raw.githubusercontent.com/ratelworks/token-horse/main/horse-preview.gif) | The classic — three shades of green (default). |
| `rapidash` | ![rapidash skin](https://raw.githubusercontent.com/ratelworks/token-horse/main/horse-preview-rapidash.gif) | Cream coat with a flickering red-and-yellow fire mane and tail, grey hooves — a nod to the fire-horse Pokémon. The flames shift every frame, so the mane really wavers as it gallops. |
| `bay` | ![bay skin](https://raw.githubusercontent.com/ratelworks/token-horse/main/horse-preview-bay.gif) | A realistic bay horse: brown coat with a black mane, tail, and hooves. |
| `redhare` | ![redhare skin](https://raw.githubusercontent.com/ratelworks/token-horse/main/horse-preview-redhare.gif) | Red Hare (赤兔馬), the legendary crimson warhorse of the Three Kingdoms. |
| `inferno` | ![inferno skin](https://raw.githubusercontent.com/ratelworks/token-horse/main/horse-preview-inferno.gif) | The whole horse ablaze — red → orange → yellow. |

```bash
token-horse --statusline --skin=rapidash
```

Or preview any skin without installing:

```bash
npx token-horse --rate=6000 --duration=8 --skin=redhare
```

Each palette is split by body part (coat / mane + tail / hooves), so a skin re-colours those parts independently while reusing the exact same gallop animation. Single-colour skins (`green`, `inferno`) just paint the whole silhouette in one range.

## How it behaves

- The default L size is a 32-column × 8-row half-block frame, pixel-identical to the preview GIF. Want it smaller? `--size=s` gives you a compact 16×4 frame.
- The horse silhouette is drawn with solid block glyphs in three shades (truecolor ANSI) — green by default, or any of the skins above — so it stays crisp in any monospace font.
- Speed tracks **how fast the session is actually spending tokens** — the same thing that drains your plan's usage limits. Each request's usage is weighed by its price relative to plain input: uncached input ×1, cache writes ×1.25, cache reads ×0.1, output ×5. Measured that way, most of a long session's spend is re-reading its cached context rather than writing output, so a horse that only counted output would barely move.
- In the statusline, token-horse reads the session's `transcript_path` JSONL and measures the per-poll delta. A response is written as several lines that repeat the same usage, so each response is counted once, by its message id. Transcripts are append-only, so context compaction never distorts the speed.
- Speed is continuous and logarithmic: around 500 tokens/sec it trots, and past 15,000 tokens/sec it's at a full gallop. Typical busy sessions sit in the middle (about 2,500–7,000).
- Token pulses register instantly — fast models really do make it run like mad — then decay slowly, so the horse keeps running while you work and only comes to a standstill (in an upright pose) once the tokens have truly stopped.
- While galloping, the mane sways naturally (the original sprite's frames); while standing, it blinks every few seconds.
- Statusline mode reads the stdin JSON once, prints one frame, and exits.
- Frame state lives in `~/.local/state/token-horse/` (or `$XDG_STATE_HOME`). State files are isolated per Claude Code `session_id`, so concurrent sessions never pollute each other's speed estimate, and state older than 48 hours is pruned automatically.

## Input formats

A direct rate:

```json
{ "tokensPerSecond": 4500 }
```

A cumulative token count:

```json
{ "usage": { "total_tokens": 123456 } }
```

Rates and counts are input-equivalent tokens (see *How it behaves*). Claude Code statusline input — token-horse reads the `transcript_path` JSONL, weighs each response's usage once, and turns the per-poll delta into the live rate:

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/your-project/abc123.jsonl"
}
```

When given a cumulative token count, tokens/sec is computed from the delta between calls.

## Development

```bash
npm run check   # syntax check + tests + OSS hygiene gate
npm run demo    # wave-pattern demo animation
claude plugin validate .   # the mod's manifest and hooks module
claude plugin test .       # the mod's tests, run against Claude Code itself
```

## License

MIT © Ratelworks Inc.
