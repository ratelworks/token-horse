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

const DEFAULT_DURATION_SEC = 12;
const RENDER_FPS = 30;
const MIN_LEG_FPS = 1.5;
const MAX_LEG_FPS = 24;
const TOKEN_RATE_SLOW = 20;
const TOKEN_RATE_FAST = 900;
const TOKEN_RATE_EMA_ALPHA = 0.28;
const STATUSLINE_DECAY = 0.82;
const STATUSLINE_MAX_DELTA_SEC = 4;
const STATUSLINE_STATE_DIR = join(
  process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
  'token-horse',
);
const DEFAULT_STATUSLINE_STATE_FILE = join(STATUSLINE_STATE_DIR, 'state.json');
const STATUSLINE_STATE_TTL_MS = 48 * 60 * 60 * 1000;
const CODEX_SESSIONS_ROOT = join(homedir(), '.codex', 'sessions');
const CODEX_POLL_INTERVAL_MS = 1000;
const CODEX_RESCAN_INTERVAL_MS = 5000;
const CODEX_TAIL_BYTES = 64 * 1024;
const CODEX_SESSION_FILE_PATTERN = /rollout-.*\.jsonl$/u;
const RESET = '\x1b[0m';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const FRAME_INTERVAL_MS = Math.round(1000 / RENDER_FPS);
const GREEN_SHADES = [
  null,
  { rgb: '#0f5f24', fg: '\x1b[38;2;15;95;36m', bg: '\x1b[48;2;15;95;36m' },
  { rgb: '#24b84a', fg: '\x1b[38;2;36;184;74m', bg: '\x1b[48;2;36;184;74m' },
  { rgb: '#59ff75', fg: '\x1b[38;2;89;255;117m', bg: '\x1b[48;2;89;255;117m' },
];
const BLOCK_TOP = '▀';
const BLOCK_BOTTOM = '▄';
const BLOCK_FULL = '█';
const BG_RESET = '\x1b[49m';
// statusline 호스트가 각 줄의 leading 공백을 strip 하므로 (실측: Claude Code),
// 공백으로 시작하는 줄은 맨 앞 1칸을 비공백 빈 글리프(braille blank)로 바꿔 들여쓰기를 보존한다.
const BLANK_ANCHOR = '⠀';
const DEFAULT_TERMINAL_COLUMNS = 80;
const INFO_CMD_TIMEOUT_MS = 2000;
const ANSI_PATTERN = /\x1b\[[0-9;]*m/gu;
// statusline 호스트의 빌트인 좌우 여백 — COLUMNS 전체를 쓰면 줄이 말줄임(…) 처리됨 (실측)
const STATUSLINE_MARGIN = 6;
const SHADED_FRAMES = [
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000000001000000000000055fffccc0',
    '00000001555113ffffffff777fff0000',
    '0000001540440ffffffffffffffe0000',
    '00000000000003feecccccccffa00000',
    '0000000000000fca00000000f0a00000',
    '0000000000000d0900000000d0900000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000000010000000000000055fffccc0',
    '0000001555113ffffffff777fffc0000',
    '000001540440ffffffffffffffc00000',
    '0000000000003ffccccccccffa000000',
    '00000000000fca800000013e28000000',
    '00000000001c008100001c0000000000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000001100000000000000055fffccc0',
    '000015555113fffffffff777fffc0000',
    '00000400440ffffffffffffffc000000',
    '000000000003ffccccccccff82000000',
    '0000000000fca80000003c0028000000',
    '0000000000cd0810004c000400000000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000015510000000000000055fffccc0',
    '000045445513fffffffff777fffc0000',
    '00000000000ffffffffffffffc000000',
    '000000000000ffccccccccff82000000',
    '00000000000fc82000433c1228000000',
    '000000000000c1081000000000000000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000115100000000000000055fffccc0',
    '000444455113fffffffff777fffc0000',
    '00000000400ffffffffffffffc000000',
    '000000000000ffecccccccff8a000000',
    '00000000000fc8a00004c3c028000000',
    '000000000000c1881000000400000000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000001000000000000000055fffccc0',
    '000155555113fffffffff777fffc0000',
    '00000000400ffffffffffffffc000000',
    '000000000000ffecccccccffa2000000',
    '00000000000cf8820004c33c0a000000',
    '0000000000000c108100000040000000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000015ffef330',
    '0000000000000000000000055fffccc0',
    '000011111113fffffffff777fffc0000',
    '00044454400ffffffffffffffc000000',
    '000000000000feecccccccffa2000000',
    '000000000000cf820000133c08200000',
    '0000000000000cd09000000000400000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000000000000000000000055fffccc0',
    '0004111551113ffffffff777fffc0000',
    '000004444400ffffffffffffffc00000',
    '0000000000002fffcccccccffb300000',
    '00000000000288cf0000000003c81000',
    '0000000000081000c100000040000000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000015ffef330',
    '0000000110000000000000055fffccc0',
    '0000155555113ffffffff777fffc0000',
    '000000000000ffffffffffffffc00000',
    '0000000000002ffccccccccffb300000',
    '00000000000288f30000000000f81000',
    '00000000000900004000000000400000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000000100000000000000055fffccc0',
    '000015545513fffffffff777fffc0000',
    '00044000000ffffffffffffffc000000',
    '000000000002ffcccccccccff3000000',
    '00000000002bc000000000008ecc1000',
    '00000000180c10000000000000400000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000000000000000000000055fffccc0',
    '000411155113fffffffff777fffc0000',
    '00000454440ffffffffffffffc000000',
    '000000000002ffcccccccccff3000000',
    '00000000002bc000000000008ec30000',
    '00000000180d00000000000000814000',
  ],
  [
    '0000000000000000000000010f190000',
    '0000000000000000000000015ffef330',
    '0000000000000000000000015fffccc0',
    '000411155113fffffffff777fffc0000',
    '00000454440ffffffffffffffc000000',
    '000000000002ffcccccccccff3000000',
    '00000000488bc00000000000acc30000',
    '00000000004000000000000900004000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000000000000000000000055fffccc0',
    '000100115113fffffffff777fffc0000',
    '00004455440ffffffffffffffc000000',
    '000000000000ffecccccccff30000000',
    '00000000003ce80000000028c3000000',
    '0000000004040000000008100c100000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000015ffef330',
    '0000000000000000000000055fffccc0',
    '000000115113fffffffff777fffc0000',
    '00001554440ffffffffffffffc000000',
    '000000000000ffecccccccff00000000',
    '0000000013ccc2000000028f00000000',
    '00000000000008400000900c10000000',
  ],
  [
    '0000000000000000000000000f190000',
    '0000000000000000000000045ffef330',
    '0000000000000000000000055fffccc0',
    '0000000001113ffffffff777fffc0000',
    '000000155540ffffffffffffffc00000',
    '0000000440000ffeeccccccff0000000',
    '000000000003cca00000122f80000000',
    '0000000000040040000000d000000000',
  ],
];


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function normalizeTokenRate(tokensPerSecond) {
  const normalized = (tokensPerSecond - TOKEN_RATE_SLOW) / (TOKEN_RATE_FAST - TOKEN_RATE_SLOW);
  return clamp(normalized, 0, 1);
}

function tokenRateToLegFps(tokensPerSecond) {
  const normalized = normalizeTokenRate(tokensPerSecond);
  const eased = Math.sqrt(normalized);
  return MIN_LEG_FPS + eased * (MAX_LEG_FPS - MIN_LEG_FPS);
}

function smoothTokenRate(currentRate, nextRate) {
  if (!Number.isFinite(nextRate)) return currentRate;
  if (!Number.isFinite(currentRate) || currentRate <= 0) return nextRate;
  return currentRate * (1 - TOKEN_RATE_EMA_ALPHA) + nextRate * TOKEN_RATE_EMA_ALPHA;
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
      'payload.info.total_token_usage.total_tokens',
      'info.total_token_usage.total_tokens',
      'total_token_usage.total_tokens',
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
  const wave = (Math.sin(elapsedSec * 1.25) + 1) / 2;
  const pulse = (Math.sin(elapsedSec * 4.1) + 1) / 2;
  return 40 + wave * 620 + pulse * 180;
}

function decodeCell(hexChar) {
  const value = Number.parseInt(hexChar, 16);
  return {
    top: Math.floor(value / 4),
    bottom: value % 4,
  };
}

function decodeCellsToPixels(cells) {
  const pixels = Array.from({ length: cells.length * 2 }, () => Array(cells[0].length).fill(0));

  cells.forEach((row, rowIndex) => {
    Array.from(row).forEach((hexChar, columnIndex) => {
      const { top, bottom } = decodeCell(hexChar);
      pixels[rowIndex * 2][columnIndex] = top;
      pixels[rowIndex * 2 + 1][columnIndex] = bottom;
    });
  });

  return pixels;
}

function decodeFramePixels(frameIndex) {
  return decodeCellsToPixels(SHADED_FRAMES[frameIndex % SHADED_FRAMES.length]);
}

// 2x2 max-pooling 다운샘플: 32x16 픽셀 → 16x8 (컴팩트 블록 렌더용)
function downsampleHalf(pixels) {
  const rows = pixels.length / 2;
  const cols = pixels[0].length / 2;
  const out = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out[r][c] = Math.max(
        pixels[r * 2][c * 2],
        pixels[r * 2][c * 2 + 1],
        pixels[r * 2 + 1][c * 2],
        pixels[r * 2 + 1][c * 2 + 1],
      );
    }
  }

  return out;
}

// 반각 블록 렌더: 한 문자가 상하 2픽셀 (▀ fg=상단, bg=하단) — braille 점묘와 달리
// 폰트 무관하게 솔리드한 실루엣을 보장하고, 픽셀이 정사각이라 GIF 와 비율이 같다.
// size 'l'(기본): 32x16 풀해상도 → 32자 x 8줄 (GIF 와 픽셀 단위 동일)
// size 's': 16x8 다운샘플 → 16자 x 4줄 (컴팩트)
export function makeHorseFrame(frameIndex, options = {}) {
  const color = options.color ?? true;
  const pixels = decodeFramePixels(frameIndex);
  const grid = options.size === 's' ? downsampleHalf(pixels) : pixels;
  const lines = [];

  for (let r = 0; r < grid.length; r += 2) {
    let line = '';
    let activeFg = null;
    let activeBg = null;

    for (let c = 0; c < grid[0].length; c += 1) {
      const top = grid[r][c];
      const bottom = grid[r + 1][c];

      if (!color) {
        line += top && bottom ? BLOCK_FULL : top ? BLOCK_TOP : bottom ? BLOCK_BOTTOM : ' ';
        continue;
      }

      if (!top && !bottom) {
        if (activeBg !== null) {
          line += BG_RESET;
          activeBg = null;
        }
        line += ' ';
        continue;
      }

      let char;
      let wantFg;
      let wantBg = null;
      if (top && bottom) {
        if (top === bottom) {
          char = BLOCK_FULL;
          wantFg = top;
        } else {
          char = BLOCK_TOP;
          wantFg = top;
          wantBg = bottom;
        }
      } else if (top) {
        char = BLOCK_TOP;
        wantFg = top;
      } else {
        char = BLOCK_BOTTOM;
        wantFg = bottom;
      }

      if (wantFg !== activeFg) {
        line += GREEN_SHADES[wantFg].fg;
        activeFg = wantFg;
      }
      if (wantBg !== activeBg) {
        line += wantBg === null ? BG_RESET : GREEN_SHADES[wantBg].bg;
        activeBg = wantBg;
      }
      line += char;
    }

    line = line.replace(/\s+$/u, '');
    if (line.startsWith(' ')) line = BLANK_ANCHOR + line.slice(1);
    if (color && line.includes('\x1b[')) line += RESET;
    lines.push(line);
  }

  return lines.join('\n');
}

export function getHorsePixels(frameIndex) {
  return decodeFramePixels(frameIndex);
}

export function getHorseFrameCells(frameIndex) {
  return SHADED_FRAMES[frameIndex % SHADED_FRAMES.length];
}

export function getGreenShades() {
  return GREEN_SHADES.map((shade) => shade?.rgb ?? null);
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

export function findLatestCodexSessionFile(rootDir = CODEX_SESSIONS_ROOT) {
  try {
    // rollout 파일명은 ISO 타임스탬프 포함 → 경로 사전순 = 시간순
    const files = readdirSync(rootDir, { recursive: true, encoding: 'utf8' })
      .filter((name) => CODEX_SESSION_FILE_PATTERN.test(name))
      .sort();
    return files.length > 0 ? join(rootDir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function readFileTail(filePath, maxBytes) {
  const fd = openSync(filePath, 'r');
  try {
    const { size } = fstatSync(fd);
    const length = Math.min(size, maxBytes);
    if (length === 0) return '';
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function extractCodexTotalTokens(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"token_count"')) continue;
    const payload = parseTokenPayload(lines[i]);
    if (payload?.totalTokens !== undefined) return payload.totalTokens;
  }
  return null;
}

// Claude Code transcript(JSONL)는 append-only — fromOffset 부터 새로 추가된 줄의
// assistant usage 만 증분 파싱해 세션 실소비 토큰을 구한다.
// billable = input + output + cache_creation (캐시 재사용분 cache_read 는 제외).
// append-only 라 compaction/캐시에 영향받지 않고, byte offset 만 기억하면 매 폴에서
// 증분(=직전 폴 이후 소비한 토큰)을 O(추가분)으로 얻는다.
export function readTranscriptBillableTokens(filePath, fromOffset) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return { tokens: 0, offset: fromOffset ?? 0 };
  }
  try {
    const { size } = fstatSync(fd);
    // 첫 호출(baseline) 또는 파일 회전/축소 → 끝으로 이동, 이번엔 증분 없음
    if (fromOffset === null || fromOffset === undefined || size < fromOffset) {
      return { tokens: 0, offset: size };
    }
    if (size === fromOffset) return { tokens: 0, offset: size };

    const length = size - fromOffset;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, fromOffset);
    // 마지막 개행까지만 처리 — 미완성(쓰는 중) 줄은 다음 호출로 미룬다
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) return { tokens: 0, offset: fromOffset };
    const complete = buffer.subarray(0, lastNewline + 1);

    let tokens = 0;
    for (const rawLine of complete.toString('utf8').split('\n')) {
      if (!rawLine.includes('"usage"')) continue;
      try {
        const usage = JSON.parse(rawLine)?.message?.usage;
        if (!usage) continue;
        tokens += (Number(usage.input_tokens) || 0)
          + (Number(usage.output_tokens) || 0)
          + (Number(usage.cache_creation_input_tokens) || 0);
      } catch {
        // 미완성/비정형 줄 무시
      }
    }
    return { tokens, offset: fromOffset + complete.length };
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
      legPhase: Number.isFinite(Number(data.legPhase)) ? Number(data.legPhase) : 0,
      updatedAt: Number.isFinite(Number(data.updatedAt)) ? Number(data.updatedAt) : Date.now(),
    };
  } catch {
    return {
      tokenRate: 0,
      totalTokens: null,
      transcriptOffset: null,
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
  const now = Date.now();
  const state = readStatuslineState(stateFile);
  const deltaSec = clamp((now - state.updatedAt) / 1000, 0, STATUSLINE_MAX_DELTA_SEC);

  if (payload?.tokensPerSecond !== undefined) {
    // 직접 속도 입력 (외부 도구/테스트)
    state.tokenRate = smoothTokenRate(state.tokenRate, payload.tokensPerSecond);
  } else if (payload?.transcriptPath) {
    // Claude Code: 이 세션 transcript 의 증분 실소비 토큰 / 경과시간 = 실시간 속도.
    // 응답이 기록될 때마다 그만큼 가속하고, 새 토큰이 없으면(유휴) 부드럽게 감쇠한다.
    const { tokens, offset } = readTranscriptBillableTokens(payload.transcriptPath, state.transcriptOffset);
    state.transcriptOffset = offset;
    if (tokens > 0 && deltaSec > 0) {
      state.tokenRate = smoothTokenRate(state.tokenRate, tokens / deltaSec);
    } else if (deltaSec > 0) {
      state.tokenRate *= STATUSLINE_DECAY ** deltaSec;
    }
  } else if (payload?.totalTokens !== undefined) {
    // 누적 토큰 직접 입력 (Codex 등) — 차분으로 속도 계산
    if (state.totalTokens !== null && deltaSec > 0) {
      const deltaTokens = payload.totalTokens - state.totalTokens;
      if (deltaTokens >= 0) state.tokenRate = smoothTokenRate(state.tokenRate, deltaTokens / deltaSec);
    }
    state.totalTokens = payload.totalTokens;
  } else if (deltaSec > 0) {
    state.tokenRate *= STATUSLINE_DECAY ** deltaSec;
  }

  const legFps = tokenRateToLegFps(state.tokenRate);
  state.legPhase = (state.legPhase + legFps * deltaSec) % SHADED_FRAMES.length;
  state.updatedAt = now;
  writeStatuslineState(stateFile, state);
  if (!explicitStateFile) pruneStaleStatuslineStates(dirname(stateFile));

  let frame = makeHorseFrame(Math.floor(state.legPhase), { color, size });
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

async function runCli() {
  const args = process.argv.slice(2);
  if (hasFlag(args, 'statusline')) {
    await runStatusline(args);
    return;
  }

  const watchCodex = hasFlag(args, 'watch-codex');
  const durationSec = getOptionValue(args, 'duration', watchCodex ? 0 : DEFAULT_DURATION_SEC);
  const fixedRate = getOptionValue(args, 'rate', Number.NaN);
  const useStdin = hasFlag(args, 'stdin');
  const noClear = hasFlag(args, 'no-clear');
  const size = getStringOption(args, 'size', 'l');
  let tokenRate = Number.isFinite(fixedRate) ? fixedRate : 0;
  let totalTokens = null;
  let lastTokenSampleTime = null;
  let legPhase = 0;
  let previousTime = Date.now();
  let elapsedSec = 0;
  let timer = null;
  let codexPollTimer = null;

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
    if (codexPollTimer) clearInterval(codexPollTimer);
    process.stdout.write(`${SHOW_CURSOR}${RESET}\n`);
    process.exit(exitCode);
  }

  if (useStdin) {
    const reader = createInterface({ input: process.stdin });
    reader.on('line', (line) => ingestPayload(parseTokenPayload(line)));
  }

  if (watchCodex) {
    // Codex CLI 는 커스텀 statusline 명령을 지원하지 않으므로 세션 로그를 직접 tail 한다.
    // token_count 이벤트의 total_token_usage.total_tokens (세션 누적) 차분으로 속도 계산.
    const sessionsRoot = getStringOption(args, 'codex-sessions', CODEX_SESSIONS_ROOT);
    let sessionFile = findLatestCodexSessionFile(sessionsRoot);
    let lastScanTime = Date.now();

    const pollCodex = () => {
      const now = Date.now();
      if (!sessionFile || now - lastScanTime >= CODEX_RESCAN_INTERVAL_MS) {
        const latest = findLatestCodexSessionFile(sessionsRoot);
        if (latest && latest !== sessionFile) {
          sessionFile = latest;
          totalTokens = null; // 새 세션 파일 — 누적 기준점 리셋
        }
        lastScanTime = now;
      }
      if (!sessionFile) return;

      try {
        const total = extractCodexTotalTokens(readFileTail(sessionFile, CODEX_TAIL_BYTES));
        if (total !== null) ingestPayload({ totalTokens: total });
      } catch {
        // 파일 회전/잠금 등 일시 오류 — 다음 폴에서 재시도
      }
    };

    pollCodex();
    codexPollTimer = setInterval(pollCodex, CODEX_POLL_INTERVAL_MS);
  }

  process.on('SIGINT', () => shutdown(0));
  process.stdout.write(HIDE_CURSOR);

  function tick() {
    const now = Date.now();
    const deltaSec = Math.max(0, (now - previousTime) / 1000);
    previousTime = now;
    elapsedSec += deltaSec;

    if (!useStdin && !watchCodex && !Number.isFinite(fixedRate)) tokenRate = makeDemoTokenRate(elapsedSec);
    const legFps = tokenRateToLegFps(tokenRate);
    legPhase += legFps * deltaSec;

    if (!noClear) process.stdout.write(CLEAR_SCREEN);
    process.stdout.write(makeHorseFrame(Math.floor(legPhase), { size }));
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
