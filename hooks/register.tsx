// Token Horse — Claude Code mod.
// 프롬프트 위 band 에 픽셀 말을 그리고, 세션의 토큰 소비 속도만큼 달리게 한다.
// 소비 = 모델 요청마다 usage 4종을 단가 비율로 가중한 "입력 환산 토큰"(CLI 와 같은 기준, horse-core).
// 응답이 스트리밍되는 동안은 출력 조각으로 추정해 즉시 반응하고, 요청이 끝나면 실제 usage 로 보정한다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  BLINK_PERIOD_SEC,
  DEFAULT_SKIN,
  SHADED_FRAMES,
  isKnownSkin,
  makeHorseCells,
  smoothTokenRate,
  tokenRateToLegFps,
  weighClaudeUsage,
} from '../horse-core.mjs'
import type { TokenHorseRate } from '../types'

const RASTER_KEY = 'horse'
const STORE_HIDDEN = 'hidden'
// 애니메이션 틱 (ms) — blit 는 프레임이 바뀔 때만 보낸다
const TICK_MS = 33
// 소비 속도 = 최근 이 창 안의 소비 합 ÷ 창 길이
const RATE_WINDOW_MS = 5000
// 속도 갱신 주기 (EMA 입력) 와 표시 숫자 갱신 주기
const RATE_UPDATE_MS = 250
const LABEL_UPDATE_MS = 1000
// 스트리밍 중 추정: 글자 4개 ≈ 토큰 1개, 출력 단가 5배
const CHARS_PER_TOKEN = 4
const OUTPUT_WEIGHT = 5
// 말 오른쪽 속도 표시에 필요한 여유 칸
const LABEL_COLUMNS = 12
const DEFAULT_COLOR = 0x01000000

const hidden = atom({ plugin: 'token-horse', key: 'hidden' } as const, false)
const shownRate = atom({ plugin: 'token-horse', key: 'rate' } as const, 0 as TokenHorseRate)

type Sample = { at: number; units: number }

// 애니메이션·측정 상태 — 모듈 변수라 재로드되면 처음부터 (말이 잠깐 서는 것 외에 잃는 것 없음)
const horse = {
  skin: DEFAULT_SKIN,
  size: 's',
  columns: 16,
  rows: 4,
  samples: [] as Sample[],
  rate: 0,
  legPhase: 0,
  lastTick: 0,
  lastRateUpdate: 0,
  lastLabelUpdate: 0,
  bandRequestId: null as string | null,
  lastFrameKey: '',
  frameIndex: 0,
  blink: false,
}

function record(at: number, units: number): Sample | null {
  if (!(units > 0)) return null
  const sample = { at, units }
  horse.samples.push(sample)
  return sample
}

function hexToInt(hex: string | null): number {
  return hex === null ? DEFAULT_COLOR : Number.parseInt(hex.slice(1), 16)
}

// 셀 격자 → Raster cells (u32 LE 삼중쌍 [codePoint, fg, bg] 의 base64)
function encodeCells(frameIndex: number, skin: string, size: string, blink: boolean): string {
  const { cells } = makeHorseCells(frameIndex, { skin, size, blink })
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((cell, i) => {
    words[i * 3] = cell.ch.codePointAt(0) ?? 0x20
    words[i * 3 + 1] = hexToInt(cell.fg)
    words[i * 3 + 2] = hexToInt(cell.bg)
  })
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

function formatRate(rate: number): string {
  if (rate < 50) return 'idle'
  if (rate < 1000) return `${Math.round(rate)} tok/s`
  return `${(rate / 1000).toFixed(1)}k tok/s`
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const dt = horse.lastTick === 0 ? 0 : Math.min(1, (now - horse.lastTick) / 1000)
  horse.lastTick = now

  if (now - horse.lastRateUpdate >= RATE_UPDATE_MS) {
    horse.lastRateUpdate = now
    horse.samples = horse.samples.filter(s => now - s.at < RATE_WINDOW_MS)
    const windowRate = horse.samples.reduce((sum, s) => sum + s.units, 0) / (RATE_WINDOW_MS / 1000)
    horse.rate = windowRate === 0 && horse.rate < 1 ? 0 : smoothTokenRate(horse.rate, windowRate)
  }
  if (now - horse.lastLabelUpdate >= LABEL_UPDATE_MS) {
    horse.lastLabelUpdate = now
    const rounded = Math.round(horse.rate)
    if ((await read($, shownRate)) !== rounded) await update($, shownRate, () => rounded)
  }

  const legFps = tokenRateToLegFps(horse.rate)
  // 유휴 — 직립 자세(frame 0)로 선다
  horse.legPhase = legFps === 0 ? 0 : (horse.legPhase + legFps * dt) % SHADED_FRAMES.length
  horse.frameIndex = Math.floor(horse.legPhase)
  horse.blink = Math.floor(now / 1000) % BLINK_PERIOD_SEC === 0

  const frameKey = `${horse.frameIndex}:${horse.blink}`
  if (horse.bandRequestId === null || frameKey === horse.lastFrameKey) return
  horse.lastFrameKey = frameKey
  await $.ui.blit({
    requestId: horse.bandRequestId,
    key: RASTER_KEY,
    cells: encodeCells(horse.frameIndex, horse.skin, horse.size, horse.blink),
  })
}

export const register: Register = (on, options) => {
  horse.skin = typeof options.skin === 'string' && isKnownSkin(options.skin) ? options.skin : DEFAULT_SKIN
  horse.size = options.size === 'l' ? 'l' : 's'
  horse.columns = horse.size === 'l' ? 32 : 16
  horse.rows = horse.size === 'l' ? 8 : 4

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'token-horse',
      description: 'Show or hide the token horse above the prompt (show | hide)',
      argumentHint: '[show|hide]',
    })
    const stored = await $.store.get(STORE_HIDDEN)
    if (typeof stored === 'boolean') await update($, hidden, () => stored)
    $.clock.every(TICK_MS, () => {
      void tick($).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'token-horse' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const wasHidden = await read($, hidden)
    const nextHidden = arg === 'show' ? false : arg === 'hide' ? true : !wasHidden
    await update($, hidden, () => nextHidden)
    await $.store.set(STORE_HIDDEN, nextHidden)
    return { text: nextHidden ? 'Token horse hidden. /token-horse show brings it back.' : 'Token horse is back above the prompt.' }
  })

  // 모델 요청 하나의 응답 스트림 — 서브에이전트 요청도 모두 지나간다.
  // 관찰만 하고 조각은 그대로 넘긴다. 집계가 실패해도 스트림은 절대 막지 않는다.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let estimated = 0
    // 이 요청의 스트리밍 추정 샘플 — 실제 usage 가 오면 여기에 맞춰 정산한다
    const guesses: Sample[] = []
    while (true) {
      const step = await stream.next()
      if (step.done) return step.value
      const chunk = step.value
      try {
        const now = await $.clock.now()
        if (chunk.kind === 'text' || chunk.kind === 'thinking' || chunk.kind === 'input') {
          const piece = chunk.kind === 'input' ? chunk.json : chunk.text
          const units = (piece.length / CHARS_PER_TOKEN) * OUTPUT_WEIGHT
          estimated += units
          const sample = record(now, units)
          if (sample) guesses.push(sample)
        } else if (chunk.kind === 'stop' && chunk.usage) {
          // 실제 소비(입력·캐시 포함)로 정산: 추정이 모자라면 차이를 더하고,
          // 넘쳤으면 이 요청의 추정 샘플을 실제/추정 비율로 깎는다
          const actual = weighClaudeUsage(chunk.usage)
          if (actual >= estimated) record(now, actual - estimated)
          else for (const sample of guesses) sample.units *= actual / estimated
        }
      } catch {
        // 집계 실패 — 무시하고 스트림만 넘긴다
      }
      yield chunk
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || (await read($, hidden))) {
      horse.bandRequestId = null
      return next(e)
    }
    if (e.props.bodyColumns < horse.columns || e.props.maxRows < horse.rows) {
      horse.bandRequestId = null
      return next(e)
    }

    const shown = await read($, shownRate)
    const { Box, Raster, Text } = $.ui.resolve(e)
    horse.bandRequestId = e.requestId
    horse.lastFrameKey = `${horse.frameIndex}:${horse.blink}`

    return (
      <Box flexDirection="row" alignItems="flex-end">
        <Raster key={RASTER_KEY} columns={horse.columns} rows={horse.rows} cells={encodeCells(horse.frameIndex, horse.skin, horse.size, horse.blink)} />
        {e.props.bodyColumns >= horse.columns + LABEL_COLUMNS && <Text dimColor> {formatRate(shown)}</Text>}
      </Box>
    )
  })
}
