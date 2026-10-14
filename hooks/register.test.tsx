// token-horse mod 테스트 — `claude plugin test .` 로 엔진 위에서 실행한다
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, On } from 'claude-code/testing'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

// 다음 모델 요청이 흘려보낼 응답 (테스트의 turn.step 바닥이 읽는다)
let nextResponse = { text: '', usage: {} as Record<string, number> }

async function start($: Engine, on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  // 플러그인 아래의 엔진 역할 — 등록·blit 은 받아들이고, 엔진 자체 그림은 비운다
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.blit', () => ({ value: {} }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: nextResponse.text, ref: 1 }
    yield { kind: 'stop', stopReason: 'end_turn', usage: nextResponse.usage, ref: 2 }
    return {
      turnId: 't1', index: 0, answer: nextResponse.text, toolUses: [], stopReason: 'end_turn', usage: nextResponse.usage,
    }
  } as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return clock
}

function mountBand($: Engine, bodyColumns = BAND_PROPS.bodyColumns) {
  return $.ui.mount({
    plugin: 'token-horse', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns },
  } as never)
}

// band 오른쪽 속도 표시(idle / 812 tok/s / 4.1k tok/s)를 숫자로 읽는다
async function shownRate(band: Awaited<ReturnType<typeof mountBand>>): Promise<number> {
  const label = await band.find({ text: /idle|tok\/s/ })
  const text = label?.text ?? ''
  if (text.includes('idle')) return 0
  const m = /([\d.]+)(k?) tok\/s/.exec(text)
  return m ? Number(m[1]) * (m[2] === 'k' ? 1000 : 1) : Number.NaN
}

// 모델 요청 하나를 흘려보낸다: 출력 텍스트 조각 + 실제 usage 를 실은 stop
async function streamStep($: Engine, text: string, usage: Record<string, number>) {
  nextResponse = { text, usage }
  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
    // 조각은 엔진(테스트)까지 그대로 넘어온다
  }
}

for (const surface of ['terminal'] as const) {
  test(`${surface}: 프롬프트 위 band 에 16x4 말 Raster 와 속도 표시를 그린다`, async ($, on) => {
    await start($, on)
    const band = await $.ui.mount({ plugin: 'token-horse', surface, component: 'AbovePrompt', props: BAND_PROPS } as never)
    const raster = await band.find({ key: 'horse' })
    expect(raster?.type).toBe('Raster')
    expect(raster?.props.columns).toBe(16)
    expect(raster?.props.rows).toBe(4)
    expect((await band.find({ text: 'idle' })) !== undefined).toBe(true)
  })
}

test('size=l 설정이면 32x8 로 그린다', { options: { size: 'l', skin: 'rapidash' } }, async ($, on) => {
  await start($, on)
  const band = await mountBand($)
  const raster = await band.find({ key: 'horse' })
  expect(raster?.props.columns).toBe(32)
  expect(raster?.props.rows).toBe(8)
})

test('band 이 말보다 좁으면 그리지 않는다', async ($, on) => {
  await start($, on)
  const band = await mountBand($, 10)
  expect(await band.find({ key: 'horse' })).toBe(undefined)
})

test('/token-horse hide 는 말을 숨기고 저장하며, show 로 되돌린다', async ($, on) => {
  await start($, on)
  const hid = await $.command.run({
    command: 'token-horse', args: 'hide', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
  } as never)
  expect(hid.text).toContain('hidden')
  const band = await mountBand($)
  expect(await band.find({ key: 'horse' })).toBe(undefined)

  await $.command.run({
    command: 'token-horse', args: 'show', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
  } as never)
  expect((await band.find({ key: 'horse' }))?.type).toBe('Raster')
})

test('요청의 실제 usage(캐시 포함)를 단가 가중해 속도로 반영하고, 소비가 멈추면 다시 선다', async ($, on) => {
  const clock = await start($, on)
  const band = await mountBand($)
  expect(await shownRate(band)).toBe(0)

  // 출력 40자(≈10토큰 ×5 = 50) + usage: input 100 + cache_read 200000×0.1 + output 10×5 = 20150
  await streamStep($, 'x'.repeat(40), {
    input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 200000, cache_creation_input_tokens: 0,
  })
  await clock.advance(2100)
  const busy = await shownRate(band)
  // 5초 창 → 20150/5 = 4030 tok/s 로 수렴하는 중
  expect(busy > 1000).toBe(true)
  expect(busy <= 4100).toBe(true)

  // 창이 지나고 소비가 없으면 다시 선다
  await clock.advance(20000)
  expect(await shownRate(band)).toBe(0)
})

test('캐시 읽기가 큰 요청은 출력만 같은 작은 요청보다 말을 훨씬 빨리 달리게 한다', async ($, on) => {
  const clock = await start($, on)
  const band = await mountBand($)
  await streamStep($, 'hello', { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await clock.advance(2100)
  const small = await shownRate(band)
  await clock.advance(20000)

  await streamStep($, 'hello', { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 300000, cache_creation_input_tokens: 0 })
  await clock.advance(2100)
  const large = await shownRate(band)
  expect(small > 0).toBe(true)
  expect(large > small * 10).toBe(true)
})
