import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  composeStatuslineWithInfo,
  createDemoStates,
  extractCodexTotalTokens,
  findLatestCodexSessionFile,
  getHorsePixels,
  makeHorseFrame,
  parseTokenPayload,
  readTranscriptBillableTokens,
} from '../horse-token-runner.mjs';

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

    // 2) 응답 1건 추가 — cache_read 가 거대해도 billable(input+output)만 반영돼야 한다
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

test('Codex token_count 이벤트 라인에서 세션 누적 토큰을 파싱한다', () => {
  const eventLine = JSON.stringify({
    timestamp: '2026-06-10T07:58:40.576Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        last_token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
  });

  assert.equal(parseTokenPayload(eventLine)?.totalTokens, 150);
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

test('readTranscriptBillableTokens 는 cache_read 를 제외한 증분만 누적한다', () => {
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
    // 둘째 줄만: 1+2+3 = 6 (cache_read 50000 제외)
    assert.equal(inc.tokens, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extractCodexTotalTokens 는 마지막 token_count 이벤트를 사용한다', () => {
  const lines = [
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 100 } } } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 250 } } } }),
    '{"type":"event_msg","payload":{"type":"agent_message"}}',
  ].join('\n');

  assert.equal(extractCodexTotalTokens(lines), 250);
  assert.equal(extractCodexTotalTokens('no token lines here'), null);
});

test('findLatestCodexSessionFile 은 날짜 디렉토리 전체에서 최신 rollout 을 고른다', () => {
  const root = mkdtempSync(join(tmpdir(), 'token-horse-codex-'));

  try {
    const oldDir = join(root, '2026', '06', '09');
    const newDir = join(root, '2026', '06', '10');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, 'rollout-2026-06-09T10-00-00-aaa.jsonl'), '{}\n');
    writeFileSync(join(newDir, 'rollout-2026-06-10T14-01-06-bbb.jsonl'), '{}\n');
    writeFileSync(join(newDir, 'not-a-rollout.txt'), 'ignore\n');

    assert.equal(
      findLatestCodexSessionFile(root),
      join(newDir, 'rollout-2026-06-10T14-01-06-bbb.jsonl'),
    );
    assert.equal(findLatestCodexSessionFile(join(root, 'missing')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
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

