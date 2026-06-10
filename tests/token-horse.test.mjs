import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDemoStates,
  extractCodexTotalTokens,
  findLatestCodexSessionFile,
  getHorsePixels,
  makeHorseFrame,
  parseTokenPayload,
} from '../horse-token-runner.mjs';

const RUNNER_PATH = fileURLToPath(new URL('../horse-token-runner.mjs', import.meta.url));

function splitRows(output) {
  return output.trimEnd().split('\n');
}

test('L 단일 사이즈는 16x4 braille 출력이다', () => {
  const rows = splitRows(makeHorseFrame(0, { color: false }));

  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => Array.from(row).length <= 16));
  assert.ok(rows.some((row) => row.includes('⣿')));
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

test('statusline 모드는 한 번 실행하고 4줄 프레임을 출력한다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-test-'));
  const stateFile = join(workingDir, 'state.json');

  try {
    const output = execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`],
      { encoding: 'utf8', input: '{"tokensPerSecond":450}' },
    );

    assert.equal(splitRows(output).length, 4);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('statusline 모드는 Claude Code context_window 토큰을 읽는다', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'token-horse-test-'));
  const stateFile = join(workingDir, 'state.json');

  try {
    const output = execFileSync(
      process.execPath,
      [RUNNER_PATH, '--statusline', '--plain', `--state-file=${stateFile}`],
      {
        encoding: 'utf8',
        input: JSON.stringify({
          context_window: {
            total_input_tokens: 15500,
            total_output_tokens: 1200,
          },
        }),
      },
    );

    assert.equal(splitRows(output).length, 4);
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('색상 프레임은 plain 프레임과 같은 글리프를 그린다 (run-length 색상)', () => {
  for (const frameIndex of [0, 5, 11]) {
    const colored = makeHorseFrame(frameIndex, { color: true });
    const stripped = colored.replace(/\x1b\[[0-9;]*m/gu, '');
    assert.equal(stripped, makeHorseFrame(frameIndex, { color: false }));
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
