#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLINK_PERIOD_SEC,
  DEFAULT_SKIN,
  SHADED_FRAMES,
  SKIN_LABELS,
  clamp,
  getSkinNames,
  getSkinShades,
  isKnownSkin,
  makeHorseCells,
  plainGlyph,
  smoothTokenRate,
  tokenRateToLegFps,
  weighClaudeUsage,
} from './horse-core.mjs';

export {
  getSkinNames,
  getSkinShades,
} from './horse-core.mjs';

export {
  getHorseFrameCells,
  getHorsePixels,
  maneFlameShade,
  partAt,
  tokenRateToLegFps,
  weighClaudeUsage,
} from './horse-core.mjs';

const DEFAULT_DURATION_SEC = 12;
const RENDER_FPS = 30;
// 감쇠를 느리게(0.95/초) — 응답 펄스 사이에도 질주가 유지되고, 진짜 유휴일 때만 선다
const STATUSLINE_DECAY = 0.95;
const STATUSLINE_MAX_DELTA_SEC = 4;
// statusline 은 1초에 한 번만 그려지므로 포즈 점프를 캡해 연속성을 유지한다.
// 4는 15(프레임 수)와 서로소 — 고속에서도 전 프레임을 순회해 원본의 갈기 미세 모션이 자연 재생된다
const STATUSLINE_MAX_FRAME_STEP = 4;
const STATUSLINE_STATE_DIR = join(
  process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
  'token-horse',
);
const DEFAULT_STATUSLINE_STATE_FILE = join(STATUSLINE_STATE_DIR, 'state.json');
const STATUSLINE_STATE_TTL_MS = 48 * 60 * 60 * 1000;
const RESET = '\x1b[0m';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const FRAME_INTERVAL_MS = Math.round(1000 / RENDER_FPS);

// hex(#rrggbb) → truecolor ANSI fg/bg 시퀀스
function ansiColor(hex, layer) {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `\x1b[${layer === 'bg' ? 48 : 38};2;${r};${g};${b}m`;
}

const BG_RESET = '\x1b[49m';
// statusline 호스트가 각 줄의 leading 공백을 strip 하므로 (실측: Claude Code),
// 공백으로 시작하는 줄은 맨 앞 1칸을 비공백 빈 글리프(braille blank)로 바꿔 들여쓰기를 보존한다.
const BLANK_ANCHOR = '⠀';
const DEFAULT_TERMINAL_COLUMNS = 80;
const INFO_CMD_TIMEOUT_MS = 2000;
const ANSI_PATTERN = /\x1b\[[0-9;]*m/gu;
// statusline 호스트의 빌트인 좌우 여백 — COLUMNS 전체를 쓰면 줄이 말줄임(…) 처리됨 (실측)
const STATUSLINE_MARGIN = 6;

function getOptionValue(args, name, fallback) {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const value = Number.parseFloat(match.slice(prefix.length));
  return Number.isFinite(value) ? value : fallback;
}

function getStringOption(args, name, fallback) {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function getPathValue(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function firstFiniteNumber(source, paths) {
  for (const path of paths) {
    const value = Number(getPathValue(source, path));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function parseTokenPayload(line) {
  const text = line.trim();
  if (!text) return null;

  const numericValue = Number.parseFloat(text);
  if (Number.isFinite(numericValue)) return { totalTokens: numericValue };

  try {
    const data = JSON.parse(text);
    const sessionId = typeof data.session_id === 'string' && data.session_id.length > 0
      ? data.session_id
      : null;
    const transcriptPath = typeof data.transcript_path === 'string' && data.transcript_path.length > 0
      ? data.transcript_path
      : null;
    const directRate = firstFiniteNumber(data, [
      'tokensPerSecond',
      'tokenRate',
      'rate',
      'usage.tokensPerSecond',
      'usage.tokenRate',
    ]);
    if (directRate !== null) return { tokensPerSecond: directRate, sessionId, transcriptPath };

    const totalTokens = firstFiniteNumber(data, [
      'totalTokens',
      'total_tokens',
      'tokens',
      'token_count',
      'usage.total_tokens',
      'usage.totalTokens',
      'usage.input_tokens',
      'usage.inputTokens',
      'transcript.total_tokens',
      'transcript.totalTokens',
    ]);
    if (totalTokens !== null) return { totalTokens, sessionId, transcriptPath };

    // Claude Code statusline: 토큰 카운트는 JSON 본문이 아니라 transcript 파일에 누적된다.
    // context_window 는 캐시 재사용분(cache_read)이 지배적이라 "세션 누적 소비"가 아니므로
    // 속도 신호로 쓰지 않는다 → transcript_path 만 넘겨 증분 파싱에 위임한다.
    if (transcriptPath || sessionId) return { sessionId, transcriptPath };
  } catch {
    return null;
  }

  return null;
}

function makeDemoTokenRate(elapsedSec) {
  // 로그 공간에서 천천히 오르내리는 파도 + 짧은 맥동 — 걷기(≈700)부터 질주(≈15k)까지 훑는다
  const wave = (Math.sin(elapsedSec * 1.25) + 1) / 2;
  const pulse = (Math.sin(elapsedSec * 4.1) + 1) / 2;
  return 700 * (15000 / 700) ** (wave * 0.8 + pulse * 0.2);
}

// 하위 호환: 기본(green) 스킨의 몸통 음영 hex
export function getGreenShades() {
  return getSkinShades(DEFAULT_SKIN, 'body');
}

// 셀 격자(horse-core) → ANSI 문자열. 같은 색이 이어지면 시퀀스를 다시 쓰지 않는다.
export function makeHorseFrame(frameIndex, options = {}) {
  const color = options.color ?? true;
  const { columns, cells } = makeHorseCells(frameIndex, options);
  const lines = [];

  for (let start = 0; start < cells.length; start += columns) {
    let line = '';
    let activeFg = null;
    let activeBg = null;

    for (const cell of cells.slice(start, start + columns)) {
      if (!color) {
        line += plainGlyph(cell);
        continue;
      }
      if (cell.fg === null) {
        if (activeBg !== null) {
          line += BG_RESET;
          activeBg = null;
        }
        line += ' ';
        continue;
      }

      const fgCode = ansiColor(cell.fg, 'fg');
      if (fgCode !== activeFg) {
        line += fgCode;
        activeFg = fgCode;
      }
      if (cell.bg === null) {
        if (activeBg !== null) {
          line += BG_RESET;
          activeBg = null;
        }
      } else {
        const bgCode = ansiColor(cell.bg, 'bg');
        if (bgCode !== activeBg) {
          line += bgCode;
          activeBg = bgCode;
        }
      }
      line += cell.ch;
    }

    line = line.replace(/\s+$/u, '');
    if (line.startsWith(' ')) line = BLANK_ANCHOR + line.slice(1);
    if (color && line.includes('\x1b[')) line += RESET;
    lines.push(line);
  }

  return lines.join('\n');
}

export function createDemoStates(durationSec, fps) {
  const states = [];
  let legPhase = 0;
  let previousSec = 0;
  const frameCount = Math.max(1, Math.round(durationSec * fps));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const elapsedSec = frame / fps;
    const deltaSec = frame === 0 ? 0 : elapsedSec - previousSec;
    const tokenRate = makeDemoTokenRate(elapsedSec);
    const legFps = tokenRateToLegFps(tokenRate);
    legPhase += legFps * deltaSec;
    previousSec = elapsedSec;
    states.push({
      elapsedSec,
      tokenRate,
      legFps,
      frameIndex: Math.floor(legPhase) % SHADED_FRAMES.length,
    });
  }

  return states;
}

function displayWidth(text) {
  return Array.from(text.replace(ANSI_PATTERN, '')).length;
}

// 기존 statusline 정보(1줄)를 왼쪽에, 말 프레임을 오른쪽 빈 공간에 정렬해 합성한다.
// 터미널 폭은 Claude Code 가 주입하는 COLUMNS 환경변수 기준 (v2.1.153+).
// 정보줄 옆에 말이 들어갈 폭이 없으면(좁은 터미널) 정보줄 단독 + 말은 아래 줄에 배치.
export function composeStatuslineWithInfo(infoLine, horseFrame, columns) {
  const horseLines = horseFrame.split('\n');
  const horseBox = Math.max(...horseLines.map(displayWidth));
  const info = infoLine ? `${infoLine}${RESET}` : '';
  const infoWidth = displayWidth(info);
  const fitsBesideInfo = !info || infoWidth + 1 + horseBox <= columns;
  const boxLeft = Math.max(0, columns - horseBox);

  const anchored = (text) => {
    const trimmed = text.replace(/\s+$/u, '');
    return trimmed.startsWith(' ') ? BLANK_ANCHOR + trimmed.slice(1) : trimmed;
  };

  const lines = [];
  if (info && !fitsBesideInfo) lines.push(anchored(info));
  horseLines.forEach((line, index) => {
    const lead = info && fitsBesideInfo && index === 0
      ? info + ' '.repeat(Math.max(1, boxLeft - infoWidth))
      : ' '.repeat(boxLeft);
    lines.push(anchored(lead + line));
  });

  return lines.join('\n');
}

function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 64);
}

export function statuslineStateFileFor(sessionId, stateDir = STATUSLINE_STATE_DIR) {
  if (!sessionId) return join(stateDir, 'state.json');
  const safe = sanitizeSessionId(sessionId);
  if (!safe) return join(stateDir, 'state.json');
  return join(stateDir, `state-${safe}.json`);
}

function pruneStaleStatuslineStates(stateDir) {
  try {
    const cutoff = Date.now() - STATUSLINE_STATE_TTL_MS;
    for (const name of readdirSync(stateDir)) {
      if (!name.startsWith('state-') || !name.endsWith('.json')) continue;
      const filePath = join(stateDir, name);
      if (statSync(filePath).mtimeMs < cutoff) rmSync(filePath, { force: true });
    }
  } catch {
    // 상태 정리는 best-effort — 실패해도 렌더링에 영향 없음
  }
}

// Claude Code transcript(JSONL)는 append-only — fromOffset 부터 새로 추가된 줄의
// assistant usage 만 증분 파싱해 세션 소비(입력 환산 토큰)를 구한다.
// 한 응답은 콘텐츠 블록마다 줄이 따로 기록되고 각 줄에 같은 usage 가 반복되므로
// message.id 로 한 번만 센다(실측: 메시지 583개가 1,061줄). 폴 경계에 걸친 메시지는
// 직전 폴의 마지막 id(lastMessageId)로 이어서 거른다.
// append-only 라 compaction 에 영향받지 않고, byte offset 만 기억하면 매 폴에서
// 증분(=직전 폴 이후 소비)을 O(추가분)으로 얻는다.
export function readTranscriptBillableTokens(filePath, fromOffset, lastMessageId = null) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return { tokens: 0, offset: fromOffset ?? 0, lastMessageId };
  }
  try {
    const { size } = fstatSync(fd);
    // 첫 호출(baseline) 또는 파일 회전/축소 → 끝으로 이동, 이번엔 증분 없음
    if (fromOffset === null || fromOffset === undefined || size < fromOffset) {
      return { tokens: 0, offset: size, lastMessageId: null };
    }
    if (size === fromOffset) return { tokens: 0, offset: size, lastMessageId };

    const length = size - fromOffset;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, fromOffset);
    // 마지막 개행까지만 처리 — 미완성(쓰는 중) 줄은 다음 호출로 미룬다
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) return { tokens: 0, offset: fromOffset, lastMessageId };
    const complete = buffer.subarray(0, lastNewline + 1);

    let tokens = 0;
    let lastId = lastMessageId;
    const counted = new Set(lastMessageId ? [lastMessageId] : []);
    for (const rawLine of complete.toString('utf8').split('\n')) {
      if (!rawLine.includes('"usage"')) continue;
      try {
        const message = JSON.parse(rawLine)?.message;
        if (!message?.usage) continue;
        const id = typeof message.id === 'string' ? message.id : null;
        if (id !== null) {
          if (counted.has(id)) continue;
          counted.add(id);
          lastId = id;
        }
        tokens += weighClaudeUsage(message.usage);
      } catch {
        // 미완성/비정형 줄 무시
      }
    }
    return { tokens, offset: fromOffset + complete.length, lastMessageId: lastId };
  } finally {
    closeSync(fd);
  }
}

function readStatuslineState(stateFile) {
  try {
    const data = JSON.parse(readFileSync(stateFile, 'utf8'));
    return {
      tokenRate: Number.isFinite(Number(data.tokenRate)) ? Number(data.tokenRate) : 0,
      totalTokens: Number.isFinite(Number(data.totalTokens)) ? Number(data.totalTokens) : null,
      transcriptOffset: Number.isFinite(Number(data.transcriptOffset)) ? Number(data.transcriptOffset) : null,
      transcriptLastMessageId: typeof data.transcriptLastMessageId === 'string' ? data.transcriptLastMessageId : null,
      legPhase: Number.isFinite(Number(data.legPhase)) ? Number(data.legPhase) : 0,
      updatedAt: Number.isFinite(Number(data.updatedAt)) ? Number(data.updatedAt) : Date.now(),
    };
  } catch {
    return {
      tokenRate: 0,
      totalTokens: null,
      transcriptOffset: null,
      transcriptLastMessageId: null,
      legPhase: 0,
      updatedAt: Date.now(),
    };
  }
}

function writeStatuslineState(stateFile, state) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
}

function readAllStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
  });
}

async function runStatusline(args) {
  const input = await readAllStdin();
  const payload = parseTokenPayload(input);
  // Claude Code statusline JSON 의 session_id 로 state 를 격리 — 멀티세션 토큰 차분 오염 방지
  const explicitStateFile = getStringOption(args, 'state-file', null);
  const stateFile = explicitStateFile ?? statuslineStateFileFor(payload?.sessionId);
  const color = !hasFlag(args, 'plain') && !hasFlag(args, 'no-color');
  const size = getStringOption(args, 'size', 'l');
  const skin = getStringOption(args, 'skin', DEFAULT_SKIN);
  const now = Date.now();
  const state = readStatuslineState(stateFile);
  const deltaSec = clamp((now - state.updatedAt) / 1000, 0, STATUSLINE_MAX_DELTA_SEC);

  if (payload?.tokensPerSecond !== undefined) {
    // 직접 속도 입력 (외부 도구/테스트)
    state.tokenRate = smoothTokenRate(state.tokenRate, payload.tokensPerSecond);
  } else if (payload?.transcriptPath) {
    // Claude Code: transcript 는 응답이 끝날 때 한 번에 기록되는 펄스 신호다.
    // 펄스가 오면 측정 속도로 즉시 점프(max)해 빠른 모델일수록 미친 듯이 달리고,
    // 응답 사이에는 느리게 감쇠해 작업 중에는 질주가 유지된다.
    const { tokens, offset, lastMessageId } = readTranscriptBillableTokens(
      payload.transcriptPath,
      state.transcriptOffset,
      state.transcriptLastMessageId,
    );
    state.transcriptOffset = offset;
    state.transcriptLastMessageId = lastMessageId;
    if (deltaSec > 0) {
      const decayed = state.tokenRate * STATUSLINE_DECAY ** deltaSec;
      state.tokenRate = tokens > 0 ? Math.max(decayed, tokens / deltaSec) : decayed;
    }
  } else if (payload?.totalTokens !== undefined) {
    // 누적 토큰 직접 입력 (외부 도구) — 차분 펄스를 즉시 반영하고 느리게 감쇠
    if (state.totalTokens !== null && deltaSec > 0) {
      const deltaTokens = payload.totalTokens - state.totalTokens;
      const decayed = state.tokenRate * STATUSLINE_DECAY ** deltaSec;
      state.tokenRate = deltaTokens > 0 ? Math.max(decayed, deltaTokens / deltaSec) : decayed;
    }
    state.totalTokens = payload.totalTokens;
  } else if (deltaSec > 0) {
    state.tokenRate *= STATUSLINE_DECAY ** deltaSec;
  }

  const legFps = tokenRateToLegFps(state.tokenRate);
  if (legFps === 0) {
    state.legPhase = 0; // 유휴 — 직립 자세(frame 0)로 서 있는다
  } else {
    const frameStep = Math.min(legFps * deltaSec, STATUSLINE_MAX_FRAME_STEP);
    state.legPhase = (state.legPhase + frameStep) % SHADED_FRAMES.length;
  }
  state.updatedAt = now;
  writeStatuslineState(stateFile, state);
  if (!explicitStateFile) pruneStaleStatuslineStates(dirname(stateFile));

  const blink = Math.floor(now / 1000) % BLINK_PERIOD_SEC === 0;
  let frame = makeHorseFrame(Math.floor(state.legPhase), { color, size, blink, skin });
  const infoCmd = getStringOption(args, 'info-cmd', null);
  if (infoCmd) {
    let infoLine = '';
    try {
      // 기존 statusline 명령에 입력 JSON 을 그대로 전달해 정보줄(첫 줄)을 얻는다
      infoLine = execSync(infoCmd, { input, encoding: 'utf8', timeout: INFO_CMD_TIMEOUT_MS })
        .split('\n')[0] ?? '';
    } catch {
      // 정보 명령 실패 — 말만 표시
    }
    const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
    const columns = Math.max(
      16,
      (Number.isFinite(envColumns) && envColumns > 0 ? envColumns : DEFAULT_TERMINAL_COLUMNS) - STATUSLINE_MARGIN,
    );
    frame = composeStatuslineWithInfo(infoLine, frame, columns);
  }
  process.stdout.write(`${frame}\n`);
}

// --list-skins 출력: 각 스킨의 이름·설명 + 컬러 미니 말(16x4) 미리보기
function listSkinsText() {
  const lines = ['Available skins (pick one with --skin=NAME):', ''];
  for (const name of getSkinNames()) {
    lines.push(`  ${name}  —  ${SKIN_LABELS[name] ?? ''}`);
    for (const row of makeHorseFrame(4, { size: 's', skin: name }).split('\n')) {
      lines.push(`    ${row}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function helpText() {
  return [
    'token-horse — a token-consumption-reactive terminal horse for Claude Code',
    '',
    'Usage:',
    '  token-horse [options]                Demo animation',
    '  token-horse --statusline [options]   One-shot statusline frame (reads JSON on stdin)',
    '',
    'Options:',
    '  --skin=NAME      Horse skin (default: green). See --list-skins.',
    '  --size=s|l       Frame size: l = 32x8 (default), s = 16x4 compact',
    '  --rate=N         Fixed rate for the demo (input-equivalent tokens/sec, ~500 walk to 15000 gallop)',
    '  --duration=SEC   Stop after SEC seconds',
    '  --plain          Monochrome (no color)',
    '  --no-clear       Keep previous frames (e.g. tmux panes)',
    '  --info-cmd=CMD   Show CMD output (first line) left of the horse (statusline)',
    '  --list-skins     List skins with a color preview, then exit',
    '  --help, -h       Show this help, then exit',
    '',
    'Examples:',
    '  npx token-horse --rate=6000 --skin=rapidash',
    '  token-horse --statusline --skin=redhare',
  ].join('\n');
}

async function runCli() {
  const args = process.argv.slice(2);
  if (hasFlag(args, 'help') || args.includes('-h')) {
    process.stdout.write(`${helpText()}\n\n${listSkinsText()}\n`);
    return;
  }
  if (hasFlag(args, 'list-skins')) {
    process.stdout.write(`${listSkinsText()}\n`);
    return;
  }
  if (hasFlag(args, 'statusline')) {
    await runStatusline(args);
    return;
  }
  // 0.3.0 에서 제거된 Codex 모드 — 데모로 조용히 넘어가지 않게 알리고 끝낸다
  if (hasFlag(args, 'watch-codex')) {
    process.stderr.write('token-horse: --watch-codex was removed in 0.3.0; Token Horse now supports Claude Code only.\n');
    process.exitCode = 2;
    return;
  }

  const durationSec = getOptionValue(args, 'duration', DEFAULT_DURATION_SEC);
  const fixedRate = getOptionValue(args, 'rate', Number.NaN);
  const useStdin = hasFlag(args, 'stdin');
  const noClear = hasFlag(args, 'no-clear');
  const size = getStringOption(args, 'size', 'l');
  const skin = getStringOption(args, 'skin', DEFAULT_SKIN);
  if (!isKnownSkin(skin)) {
    process.stderr.write(`token-horse: unknown skin '${skin}'. Run 'token-horse --list-skins' for options. Using '${DEFAULT_SKIN}'.\n`);
  }
  let tokenRate = Number.isFinite(fixedRate) ? fixedRate : 0;
  let totalTokens = null;
  let lastTokenSampleTime = null;
  let legPhase = 0;
  let previousTime = Date.now();
  let elapsedSec = 0;
  let timer = null;

  function updateTokenRate(nextRate) {
    if (!Number.isFinite(nextRate)) return;
    tokenRate = smoothTokenRate(tokenRate, nextRate);
  }

  function ingestPayload(payload) {
    if (!payload) return;
    if (Number.isFinite(payload.tokensPerSecond)) {
      updateTokenRate(payload.tokensPerSecond);
      return;
    }
    if (!Number.isFinite(payload.totalTokens)) return;

    const now = Date.now();
    if (totalTokens !== null && lastTokenSampleTime !== null) {
      const deltaTokens = payload.totalTokens - totalTokens;
      const deltaSec = (now - lastTokenSampleTime) / 1000;
      if (deltaTokens >= 0 && deltaSec > 0) updateTokenRate(deltaTokens / deltaSec);
    }
    totalTokens = payload.totalTokens;
    lastTokenSampleTime = now;
  }

  function shutdown(exitCode = 0) {
    if (timer) clearTimeout(timer);
    process.stdout.write(`${SHOW_CURSOR}${RESET}\n`);
    process.exit(exitCode);
  }

  if (useStdin) {
    const reader = createInterface({ input: process.stdin });
    reader.on('line', (line) => ingestPayload(parseTokenPayload(line)));
  }

  process.on('SIGINT', () => shutdown(0));
  process.stdout.write(HIDE_CURSOR);

  function tick() {
    const now = Date.now();
    const deltaSec = Math.max(0, (now - previousTime) / 1000);
    previousTime = now;
    elapsedSec += deltaSec;

    if (!useStdin && !Number.isFinite(fixedRate)) tokenRate = makeDemoTokenRate(elapsedSec);
    const legFps = tokenRateToLegFps(tokenRate);
    if (legFps === 0) legPhase = 0; // 유휴 — 직립 자세로 선다
    else legPhase += legFps * deltaSec;

    if (!noClear) process.stdout.write(CLEAR_SCREEN);
    const blink = Math.floor(now / 1000) % BLINK_PERIOD_SEC === 0;
    process.stdout.write(makeHorseFrame(Math.floor(legPhase), { size, blink, skin }));
    process.stdout.write('\n');

    if (durationSec > 0 && elapsedSec >= durationSec) return shutdown(0);
    timer = setTimeout(tick, FRAME_INTERVAL_MS);
    return null;
  }

  tick();
}

// npm 글로벌 설치 bin 은 심링크 — realpath 로 풀어 비교해야 엔트리포인트 감지가 된다
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  const currentPath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === currentPath;
  } catch {
    return process.argv[1] === currentPath;
  }
}

if (isDirectInvocation()) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
