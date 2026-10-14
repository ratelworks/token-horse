import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  composeStatuslineWithInfo,
  createDemoStates,
  getHorsePixels,
  getSkinNames,
  getSkinShades,
  makeHorseFrame,
  maneFlameShade,
  parseTokenPayload,
  readTranscriptBillableTokens,
  tokenRateToLegFps,
  weighClaudeUsage,
} from '../horse-token-runner.mjs';

function ansiFg(hex) {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const RUNNER_PATH = fileURLToPath(new URL('../horse-token-runner.mjs', import.meta.url));

function splitRows(output) {
  return output.trimEnd().split('\n');
}

test('기본 L 사이즈는 32x8 블록 출력이다 (GIF 풀해상도)', () => {
  const rows = splitRows(makeHorseFrame(0, { color: false }));

  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => Array.from(row).length <= 32));
  assert.ok(rows.some((row) => row.includes('█')));
});

test('size s 는 16x4 컴팩트 블록 출력이다', () => {
  const rows = splitRows(makeHorseFrame(0, { color: false, size: 's' }));

  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => Array.from(row).length <= 16));
  assert.ok(rows.some((row) => row.includes('█')));
});

test('픽셀 프레임은 L 사이즈 기준 32x16이다', () => {
  const pixels = getHorsePixels(0);

  assert.equal(pixels.length, 16);
  assert.ok(pixels.every((row) => row.length === 32));
});

test('데모 상태는 토큰 속도와 말 프레임을 생성한다', () => {
  const states = createDemoStates(1, 8);

  assert.equal(states.length, 8);
  assert.ok(states.every((state) => Number.isFinite(state.tokenRate)));
  assert.ok(states.every((state) => state.frameIndex >= 0));
});

test('statusline 모드는 한 번 실행하고 기본 8줄 프레임을 출력한다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-test-'));
  const stateFile = join(workingDir, 'state.json');

  try {
    const output = execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`],
      { encoding: 'utf8', input: '{"tokensPerSecond":450}' },
    );

    assert.equal(splitRows(output).length, 8);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('statusline 모드는 transcript 의 실소비 토큰 증분을 속도로 반영한다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-test-'));
  const stateFile = join(workingDir, 'state.json');
  const transcript = join(workingDir, 'transcript.jsonl');
  const statuslineInput = JSON.stringify({ session_id: 'x', transcript_path: transcript });

  try {
    // 1) baseline: transcript 비어있음 → offset 만 잡고 속도 0
    writeFileSync(transcript, '');
    execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`],
      { encoding: 'utf8', input: statuslineInput },
    );

    // baseline 의 updatedAt 을 과거로 → 다음 호출에서 deltaSec>0 (속도 = 토큰/시간)
    const baseState = JSON.parse(readFileSync(stateFile, 'utf8'));
    baseState.updatedAt = Date.now() - 1000;
    writeFileSync(stateFile, JSON.stringify(baseState));

    // 2) 응답 1건 추가 — 단가 가중한 소비가 속도로 반영돼야 한다
    writeFileSync(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 100, output_tokens: 4000, cache_creation_input_tokens: 0, cache_read_input_tokens: 999999 } },
      })}\n`,
    );
    const output = execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`],
      { encoding: 'utf8', input: statuslineInput },
    );

    assert.equal(splitRows(output).length, 8);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.ok(state.tokenRate > 0, `transcript 증분이 속도로 반영돼야 한다 (got ${state.tokenRate})`);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('색상 프레임은 plain 프레임과 같은 자리에 픽셀을 그린다', () => {
  // color 모드는 상하 명도가 다르면 ▀+bg 로, plain 은 █ 로 그리므로 글리프는 다를 수 있다.
  // 불변식: ANSI 제거 후 각 위치의 점유(공백/비공백) 패턴이 동일해야 한다.
  const occupancy = (text) => splitRows(text).map(
    (row) => Array.from(row).map((ch) => (ch === ' ' ? '.' : 'x')).join('').replace(/\.+$/u, ''),
  );

  for (const frameIndex of [0, 5, 11]) {
    const stripped = makeHorseFrame(frameIndex, { color: true }).replace(/\x1b\[[0-9;]*m/gu, '');
    assert.deepEqual(occupancy(stripped), occupancy(makeHorseFrame(frameIndex, { color: false })));
  }
});

test('parseTokenPayload 는 transcript_path 를 추출하고 context_window 는 토큰으로 쓰지 않는다', () => {
  const payload = parseTokenPayload(JSON.stringify({
    session_id: 'abc',
    transcript_path: '/tmp/x.jsonl',
    context_window: { total_input_tokens: 500000, total_output_tokens: 1000 },
  }));

  assert.equal(payload?.transcriptPath, '/tmp/x.jsonl');
  assert.equal(payload?.sessionId, 'abc');
  // context_window 는 캐시 재사용분(cache_read) 지배 → 누적 소비가 아니므로 totalTokens 로 쓰지 않는다
  assert.equal(payload?.totalTokens, undefined);
  assert.equal(payload?.tokensPerSecond, undefined);
});

test('readTranscriptBillableTokens 는 단가 가중한 증분만 누적한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-horse-tx-'));
  const file = join(dir, 't.jsonl');
  const messageLine = JSON.stringify({
    type: 'assistant',
    message: { usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 100000 } },
  });

  try {
    writeFileSync(file, `${messageLine}\n`);
    // baseline: fromOffset=null → 끝 offset 만 잡고 증분 0 (큰 파일 전체 재파싱 회피)
    const base = readTranscriptBillableTokens(file, null);
    assert.equal(base.tokens, 0);
    assert.ok(base.offset > 0);

    // baseline 이후 새 줄 추가 → 추가분만 증분 계산
    writeFileSync(file, `${messageLine}\n${JSON.stringify({
      type: 'assistant',
      message: { usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 50000 } },
    })}\n`);
    const inc = readTranscriptBillableTokens(file, base.offset);
    // 둘째 줄만: input 1 + output 2×5 + cache_write 3×1.25 + cache_read 50000×0.1
    assert.equal(inc.tokens, 1 + 10 + 3.75 + 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('심링크 bin 으로 실행해도 동작한다 (npm 글로벌 설치 시나리오)', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-symlink-'));
  const symlinkBin = join(workingDir, 'token-horse');
  const stateFile = join(workingDir, 'state.json');

  try {
    symlinkSync(RUNNER_PATH, symlinkBin);
    const output = execFileSync(
      process.execPath,
      [symlinkBin, '--statusline', '--plain', `--state-file=${stateFile}`],
      { encoding: 'utf8', input: '{"tokensPerSecond":450}' },
    );

    assert.equal(splitRows(output).length, 8);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('info 합성: 정보줄은 왼쪽, 말은 오른쪽 정렬로 배치된다', () => {
  const horse = makeHorseFrame(0, { color: false, size: 's' });
  const horseBox = Math.max(...horse.split('\n').map((row) => Array.from(row).length));
  const columns = 60;
  const composed = composeStatuslineWithInfo('Fable | ~/proj | 12%', horse, columns).split('\n');

  assert.equal(composed.length, 4);
  assert.ok(composed[0].replace(/\x1b\[[0-9;]*m/gu, '').startsWith('Fable | ~/proj | 12%'));
  // 모든 말 행이 같은 좌측 박스 시작점(columns - horseBox)에서 시작 — 형태 보존
  const stripped = composed.map((row) => row.replace(/\x1b\[[0-9;]*m/gu, '').replace(/^⠀/u, ' '));
  for (let i = 1; i < stripped.length; i += 1) {
    assert.ok(/^\s+$/u.test(stripped[i].slice(0, columns - horseBox)));
  }
  // 어느 행도 터미널 폭을 넘지 않는다
  assert.ok(stripped.every((row) => Array.from(row).length <= columns));
});

test('info 합성: 정보줄이 없으면 말만 오른쪽 정렬된다', () => {
  const horse = makeHorseFrame(0, { color: false, size: 's' });
  const composed = composeStatuslineWithInfo('', horse, 40).split('\n');

  assert.equal(composed.length, 4);
  assert.ok(composed.every((row) => /^[⠀\s]/u.test(row)));
});

test('statusline E2E: --info-cmd 출력과 말이 한 프레임에 합성된다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-info-'));
  const stateFile = join(workingDir, 'state.json');

  try {
    const output = execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', '--plain', '--size=s', `--state-file=${stateFile}`, '--info-cmd=printf INFO-LINE'],
      {
        encoding: 'utf8',
        env: { ...process.env, COLUMNS: '60' },
        input: '{"tokensPerSecond":450}',
      },
    );

    const rows = splitRows(output);
    assert.equal(rows.length, 4);
    assert.ok(rows[0].includes('INFO-LINE'));
    assert.ok(rows.some((row) => row.includes('█')));
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('statusline 모드는 session_id 별로 state 파일을 격리한다', () => {
  const stateHome = mkdtempSync(join(tmpdir(), 'token-horse-state-'));

  try {
    for (const sessionId of ['session-aaa', 'session-bbb']) {
      execFileSync(process.execPath, [RUNNER_PATH, '--statusline', '--plain'], {
        encoding: 'utf8',
        env: { ...process.env, XDG_STATE_HOME: stateHome },
        input: JSON.stringify({
          session_id: sessionId,
          context_window: { total_input_tokens: 1000, total_output_tokens: 100 },
        }),
      });
    }

    const stateDir = join(stateHome, 'token-horse');
    const stateFiles = readdirSync(stateDir).sort();
    assert.deepEqual(stateFiles, ['state-session-aaa.json', 'state-session-bbb.json']);
    assert.equal(existsSync(join(stateDir, 'state.json')), false);
  } finally {
    rmSync(stateHome, { recursive: true, force: true });
  }
});

test('유휴(토큰 소진 없음)면 직립 자세(frame 0)로 정지한다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-idle-'));
  const stateFile = join(workingDir, 'state.json');

  try {
    const run = () => execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`],
      { encoding: 'utf8', input: '{}' },
    );
    const first = run();
    const second = run();

    // 토큰 입력이 전혀 없으면 직립(frame 0) 정지 — 눈 깜빡임만 허용
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.legPhase, 0);
    const rows = splitRows(first);
    assert.equal(rows.length, 8);
    const stripEye = (t) => t.replaceAll('▀', '#').replaceAll('▄', '#').replaceAll('█', '#');
    assert.equal(stripEye(first), stripEye(second)); // 실루엣 동일 (글리프 단위)
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('transcript 펄스는 즉시 최고속으로 점프한다 (EMA 로 깎이지 않음)', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-pulse-'));
  const stateFile = join(workingDir, 'state.json');
  const transcript = join(workingDir, 't.jsonl');
  const statuslineInput = JSON.stringify({ session_id: 'p', transcript_path: transcript });

  try {
    writeFileSync(transcript, '');
    execFileSync(process.execPath, [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`], {
      encoding: 'utf8', input: statuslineInput,
    });
    const base = JSON.parse(readFileSync(stateFile, 'utf8'));
    base.updatedAt = Date.now() - 1000;
    writeFileSync(stateFile, JSON.stringify(base));

    writeFileSync(transcript, `${JSON.stringify({
      type: 'assistant',
      message: { usage: { input_tokens: 0, output_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    })}\n`);
    execFileSync(process.execPath, [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`], {
      encoding: 'utf8', input: statuslineInput,
    });

    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    // 1초간 3000토큰 펄스 → 측정치(≈3000 tok/s)가 그대로 반영돼야 한다 (EMA 였다면 ~840)
    assert.ok(state.tokenRate > 1500, `펄스 즉응이어야 한다 (got ${state.tokenRate})`);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('getSkinNames 는 기본 제공 스킨(green/rapidash/bay/redhare/inferno)을 포함한다', () => {
  const names = getSkinNames();
  for (const name of ['green', 'rapidash', 'bay', 'redhare', 'inferno']) {
    assert.ok(names.includes(name), `${name} 스킨이 있어야 한다`);
  }
});

test('알 수 없는 스킨은 기본(green)으로 폴백한다', () => {
  assert.equal(makeHorseFrame(4, { skin: 'no-such-skin' }), makeHorseFrame(4, { skin: 'green' }));
});

test('스킨마다 색은 다르되 실루엣(점유)은 동일하다', () => {
  const green = makeHorseFrame(4, { skin: 'green' });
  const bay = makeHorseFrame(4, { skin: 'bay' });
  assert.notEqual(green, bay); // 색 코드가 다르다
  // ANSI 제거 후 점유(공백/비공백)는 같아야 한다. 단 부위 경계에서 상하 색이 다르면
  // █(FULL) 대신 ▀+bg 로 정확히 렌더되므로 글리프 자체는 갈릴 수 있다 → 점유로 비교한다
  const occupancy = (t) => t.replace(/\x1b\[[0-9;]*m/gu, '').split('\n')
    .map((row) => Array.from(row).map((ch) => (ch === ' ' ? '.' : 'x')).join('').replace(/\.+$/u, ''));
  assert.deepEqual(occupancy(green), occupancy(bay)); // 실루엣은 같다
});

test('캐릭터 스킨은 부위(갈기/몸통)에 서로 다른 색을 렌더한다', () => {
  const mane = getSkinShades('rapidash', 'mane');
  const body = getSkinShades('rapidash', 'body');
  assert.notDeepEqual(mane, body);
  const frame = makeHorseFrame(4, { skin: 'rapidash' });
  assert.ok(frame.includes(ansiFg(mane[1])), '갈기(불꽃) 색이 렌더돼야 한다');
  assert.ok(frame.includes(ansiFg(body[3])), '몸통(크림) 색이 렌더돼야 한다');
});

test('불꽃 갈기(rapidash)는 한 프레임에 빨강과 노랑이 함께 일렁인다', () => {
  const frame = makeHorseFrame(4, { skin: 'rapidash' });
  const mane = getSkinShades('rapidash', 'mane'); // [_, 빨강, 주황, 노랑]
  assert.ok(frame.includes(ansiFg(mane[1])), '빨강(불꽃 뿌리)이 있어야 한다');
  assert.ok(frame.includes(ansiFg(mane[3])), '노랑(불꽃 끝)이 있어야 한다');
});

test('불꽃 레벨은 프레임에 따라 일렁인다 (같은 픽셀도 색이 변한다)', () => {
  const levels = [0, 1, 2, 3, 4, 5].map((f) => maneFlameShade('rapidash', 7, 8, f));
  assert.ok(levels.every((l) => l >= 1 && l <= 3), '레벨은 1~3 범위여야 한다');
  assert.ok(new Set(levels).size > 1, '프레임마다 색이 변해야 한다');
});

test('불꽃 스킨이 아니면 갈기는 정적 색이다 (maneFlameShade = null)', () => {
  for (const skin of ['bay', 'redhare', 'green', 'inferno']) {
    assert.equal(maneFlameShade(skin, 7, 8, 0), null, `${skin} 은 불꽃 스킨이 아니다`);
  }
});

test('단색 스킨(green)은 부위를 무시하고 한 색역만 쓴다', () => {
  assert.deepEqual(getSkinShades('green', 'mane'), getSkinShades('green', 'body'));
  assert.deepEqual(getSkinShades('green', 'hoof'), getSkinShades('green', 'body'));
});

test('plain 모드는 스킨과 무관하게 같은 글리프를 출력한다', () => {
  assert.equal(
    makeHorseFrame(4, { color: false, skin: 'redhare' }),
    makeHorseFrame(4, { color: false, skin: 'green' }),
  );
});

test('--list-skins 는 모든 스킨을 이름과 함께 안내한다', () => {
  const out = execFileSync(process.execPath, [RUNNER_PATH, '--list-skins'], { encoding: 'utf8' });
  for (const name of getSkinNames()) assert.ok(out.includes(name), `${name} 안내가 있어야 한다`);
  assert.ok(out.includes('--skin'), '선택 방법(--skin) 힌트가 있어야 한다');
});

test('--help 는 사용법과 옵션을 보여준다', () => {
  const out = execFileSync(process.execPath, [RUNNER_PATH, '--help'], { encoding: 'utf8' });
  assert.ok(out.includes('Usage'), '사용법 헤더');
  assert.ok(out.includes('--skin'), '--skin 옵션');
  assert.ok(out.includes('--statusline'), '--statusline 모드');
});

test('데모는 알 수 없는 스킨에 stderr 로 안내하고 기본으로 폴백한다', () => {
  const result = spawnSync(process.execPath, [RUNNER_PATH, '--rate=10', '--duration=0.05', '--skin=no-such'], { encoding: 'utf8' });
  assert.ok(result.stderr.includes("unknown skin 'no-such'"), '알 수 없는 스킨 안내');
  assert.ok(result.stderr.includes('--list-skins'), '목록 보기 힌트');
});

test('statusline 은 알 수 없는 스킨이면 조용히 기본(green)으로 폴백한다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-unknown-'));
  const known = join(workingDir, 'a.json');
  const fallback = join(workingDir, 'b.json');

  try {
    const run = (skin, stateFile) => execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', `--state-file=${stateFile}`, `--skin=${skin}`],
      { encoding: 'utf8', input: '{"tokensPerSecond":450}' },
    );
    // 알 수 없는 스킨은 green 과 동일하게 렌더돼야 한다 (stderr 오염 없이)
    assert.equal(run('no-such', fallback), run('green', known));
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('statusline 모드는 --skin 으로 캐릭터 스킨을 렌더한다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-skin-'));
  const stateFile = join(workingDir, 'state.json');

  try {
    const output = execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', `--state-file=${stateFile}`, '--skin=bay'],
      { encoding: 'utf8', input: '{"tokensPerSecond":450}' },
    );

    assert.equal(splitRows(output).length, 8);
    // bay 몸통 중간 음영색이 출력에 있어야 한다 (green 기본과 다른 스킨이 적용된 증거)
    assert.ok(output.includes(ansiFg(getSkinShades('bay', 'body')[2])), 'bay 색이 statusline 에 렌더돼야 한다');
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('statusline 포즈 점프는 폴당 캡 이내다 (고속 랜덤 포즈화 방지)', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-step-'));
  const stateFile = join(workingDir, 'state.json');

  try {
    execFileSync(process.execPath, [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`], {
      encoding: 'utf8', input: '{"tokensPerSecond":900}',
    });
    const base = JSON.parse(readFileSync(stateFile, 'utf8'));
    const phaseBefore = base.legPhase;
    base.updatedAt = Date.now() - 4000; // 4초 경과 — 캡 없으면 24*4=96프레임 점프
    writeFileSync(stateFile, JSON.stringify(base));

    execFileSync(process.execPath, [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`], {
      encoding: 'utf8', input: '{"tokensPerSecond":900}',
    });
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const advanced = (state.legPhase - phaseBefore + 15) % 15;
    assert.ok(advanced <= 4.001, `포즈 점프가 캡(4) 이내여야 한다 (got ${advanced})`);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});


test('usage 가중: Claude 는 cache_read 0.1·cache_write 1.25·output 5 배로 입력 환산한다', () => {
  assert.equal(weighClaudeUsage({ input_tokens: 10, cache_creation_input_tokens: 8, cache_read_input_tokens: 1000, output_tokens: 4 }), 10 + 10 + 100 + 20);
  assert.equal(weighClaudeUsage(null), 0);
  assert.equal(weighClaudeUsage({ output_tokens: 'x', input_tokens: -5 }), 0);
});

test('readTranscriptBillableTokens 는 블록마다 반복 기록된 같은 응답을 한 번만 센다 (폴 경계 포함)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-horse-dedupe-'));
  const file = join(dir, 't.jsonl');
  const block = (id) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: 0, output_tokens: 100 } } });

  try {
    writeFileSync(file, '');
    const base = readTranscriptBillableTokens(file, null);
    writeFileSync(file, `${block('m1')}\n${block('m1')}\n${block('m2')}\n`);
    const first = readTranscriptBillableTokens(file, base.offset, base.lastMessageId);
    assert.equal(first.tokens, 1000); // m1, m2 각 500
    assert.equal(first.lastMessageId, 'm2');

    // 다음 폴: m2 의 남은 블록 + 새 응답 m3
    writeFileSync(file, `${block('m1')}\n${block('m1')}\n${block('m2')}\n${block('m2')}\n${block('m3')}\n`);
    const second = readTranscriptBillableTokens(file, first.offset, first.lastMessageId);
    assert.equal(second.tokens, 500); // m3 만
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('다리 속도는 유휴에서 0, 소비가 늘수록 단조 증가하고 상한에서 멈춘다', () => {
  assert.equal(tokenRateToLegFps(0), 0);
  assert.equal(tokenRateToLegFps(Number.NaN), 0);
  const samples = [100, 500, 2500, 4200, 7000, 15000, 50000].map(tokenRateToLegFps);
  for (let i = 1; i < samples.length; i += 1) assert.ok(samples[i] >= samples[i - 1]);
  assert.equal(samples.at(-1), samples.at(-2)); // 15k 이상은 최고속
  // 실측 분포 p10~p90 이 중간 구간에 고르게 놓인다
  assert.ok(samples[2] > 8 && samples[4] < 20, `p10=${samples[2]} p90=${samples[4]}`);
});

test('제거된 --watch-codex 는 안내와 함께 종료한다 (데모로 넘어가지 않음)', () => {
  const run = spawnSync(process.execPath, [RUNNER_PATH, '--watch-codex'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--watch-codex was removed/);
  assert.equal(run.stdout, '');
});
