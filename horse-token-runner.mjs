#!/usr/bin/env node

import { createInterface } from 'node:readline';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
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
const BRAILLE_BASE = 0x2800;
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];
const SHADED_FRAMES = [
  [
    '0000000000000000000001f190000000',
    '0000000000000000004555ffef330000',
    '0000001000000000004555fffccc0000',
    '00001555113ffffffff777fff0000000',
    '0009540440ffffffffffffffe0000000',
    '00000000003feecccccccffa00000000',
    '0000000000fca00000000f0a00000000',
    '0000000000d0900000000d0900000000',
  ],
  [
    '00000000000000000000001f19000000',
    '00000000000000000004555ffef33000',
    '00000010000000000004555fffccc000',
    '00001555113ffffffff777fffc000000',
    '0009540440ffffffffffffffc0000000',
    '00000000003ffccccccccffa00000000',
    '000000000fca800000013e2800000000',
    '000000001c008100001c000000000000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000000000000000000004555ffef330',
    '0000025100000000000004555fffccc0',
    '000095555113fffffffff777fffc0000',
    '00000000440ffffffffffffffc000000',
    '000000000003ffccccccccff82000000',
    '0000000000fca80000003c0028000000',
    '0000000000cd0810004c000400000000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000001000000000000004555ffef330',
    '0000295510000000000004555fffccc0',
    '000044445513fffffffff777fffc0000',
    '00000000000ffffffffffffffc000000',
    '000000000000ffccccccccff82000000',
    '00000000000fc82000433c1228000000',
    '000000000000c1081000000000000000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000010000000000000004555ffef330',
    '0002915100000000000004555fffccc0',
    '000444455113fffffffff777fffc0000',
    '00000000000ffffffffffffffc000000',
    '000000000000ffecccccccff8a000000',
    '00000000000fc8a00004c3c028000000',
    '000000000000c1881000000400000000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000000000000000000004555ffef330',
    '0000241000000000000004555fffccc0',
    '000955555113fffffffff777fffc0000',
    '00000000000ffffffffffffffc000000',
    '000000000000ffecccccccffa2000000',
    '00000000000cf8820004c33c0a000000',
    '0000000000000c108100000040000000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000000000000000000001555ffef330',
    '0000010000000000000004555fffccc0',
    '000291111113fffffffff777fffc0000',
    '00044444400ffffffffffffffc000000',
    '000000000000feecccccccffa2000000',
    '000000000000cf820000133c08200000',
    '0000000000000cd09000000000400000',
  ],
  [
    '000000000000000000000001f1900000',
    '000010000000000000004555ffef3300',
    '002800000000000000004555fffccc00',
    '004111551113ffffffff777fffc00000',
    '00000444400ffffffffffffffc000000',
    '000000000002fffcccccccffb3000000',
    '0000000000288cf0000000003c810000',
    '000000000081000c1000000400000000',
  ],
  [
    '000000000000000000000001f1900000',
    '000000000000000000001555ffef3300',
    '000024110000000000004555fffccc00',
    '000955555113ffffffff777fffc00000',
    '00000000000ffffffffffffffc000000',
    '000000000002ffccccccccffb3000000',
    '0000000000288f30000000000f810000',
    '00000000009000040000000004000000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000000000000000000004555ffef330',
    '0000010100000000000004555fffccc0',
    '000295545513fffffffff777fffc0000',
    '00044000000ffffffffffffffc000000',
    '000000000002ffcccccccccff3000000',
    '00000000002bc000000000008ecc1000',
    '00000000180c10000000000000400000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000010000000000000004555ffef330',
    '0002800000000000000004555fffccc0',
    '000411155113fffffffff777fffc0000',
    '00000444440ffffffffffffffc000000',
    '000000000002ffcccccccccff3000000',
    '00000000002bc000000000008ec30000',
    '00000000180d00000000000000814000',
  ],
  [
    '0000000000000000000000110f190000',
    '0000010000000000000001555ffef330',
    '0002800000000000000000555fffccc0',
    '000411155113fffffffff777fffc0000',
    '00000444440ffffffffffffffc000000',
    '000000000002ffcccccccccff3000000',
    '00000000488bc00000000000acc30000',
    '00000000004000000000000900004000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000000000000000000004555ffef330',
    '0000240000000000000004555fffccc0',
    '000900115113fffffffff777fffc0000',
    '00004445440ffffffffffffffc000000',
    '000000000000ffecccccccff30000000',
    '00000000003ce80000000028c3000000',
    '0000000004040000000008100c100000',
  ],
  [
    '0000000000000000000000001f190000',
    '0000000000000000000001555ffef330',
    '0000000000000000000004555fffccc0',
    '000002515113fffffffff777fffc0000',
    '00009554440ffffffffffffffc000000',
    '000000000000ffecccccccff00000000',
    '0000000013ccc2000000028f00000000',
    '00000000000008400000900c10000000',
  ],
  [
    '000000000000000000000001f1900000',
    '000000000000000000004555ffef3300',
    '000000000000000000004555fffccc00',
    '000000241113ffffffff777fffc00000',
    '00000955540ffffffffffffffc000000',
    '000000440000ffeeccccccff00000000',
    '00000000003cca00000122f800000000',
    '000000000040040000000d0000000000',
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

function sumFiniteNumbers(source, paths) {
  let sum = 0;
  let hasValue = false;

  for (const path of paths) {
    const value = Number(getPathValue(source, path));
    if (Number.isFinite(value)) {
      sum += value;
      hasValue = true;
    }
  }

  return hasValue ? sum : null;
}

function parseContextWindowTokens(data) {
  const combinedTotal = sumFiniteNumbers(data, [
    'context_window.total_input_tokens',
    'context_window.total_output_tokens',
    'contextWindow.totalInputTokens',
    'contextWindow.totalOutputTokens',
  ]);
  if (combinedTotal !== null) return combinedTotal;

  const currentUsageTotal = sumFiniteNumbers(data, [
    'context_window.current_usage.input_tokens',
    'context_window.current_usage.output_tokens',
    'context_window.current_usage.cache_creation_input_tokens',
    'context_window.current_usage.cache_read_input_tokens',
    'contextWindow.currentUsage.inputTokens',
    'contextWindow.currentUsage.outputTokens',
    'contextWindow.currentUsage.cacheCreationInputTokens',
    'contextWindow.currentUsage.cacheReadInputTokens',
  ]);
  if (currentUsageTotal !== null) return currentUsageTotal;

  const usedTokens = firstFiniteNumber(data, [
    'context_window.used_tokens',
    'context_window.tokens_used',
    'context_window.current_tokens',
    'contextWindow.usedTokens',
    'contextWindow.currentTokens',
  ]);
  if (usedTokens !== null) return usedTokens;

  const usedPercentage = firstFiniteNumber(data, [
    'context_window.used_percentage',
    'contextWindow.usedPercentage',
  ]);
  const tokenLimit = firstFiniteNumber(data, [
    'context_window.max_tokens',
    'context_window.token_limit',
    'context_window.total_tokens',
    'contextWindow.maxTokens',
    'contextWindow.tokenLimit',
  ]);

  if (usedPercentage !== null && tokenLimit !== null) return tokenLimit * usedPercentage / 100;
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
    const directRate = firstFiniteNumber(data, [
      'tokensPerSecond',
      'tokenRate',
      'rate',
      'usage.tokensPerSecond',
      'usage.tokenRate',
    ]);
    if (directRate !== null) return { tokensPerSecond: directRate, sessionId };

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
    ]) ?? parseContextWindowTokens(data);

    if (totalTokens !== null) return { totalTokens, sessionId };
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

function decodeFramePixels(frameIndex) {
  const frame = SHADED_FRAMES[frameIndex % SHADED_FRAMES.length];
  const pixels = Array.from({ length: frame.length * 2 }, () => Array(frame[0].length).fill(0));

  frame.forEach((row, rowIndex) => {
    Array.from(row).forEach((hexChar, columnIndex) => {
      const { top, bottom } = decodeCell(hexChar);
      pixels[rowIndex * 2][columnIndex] = top;
      pixels[rowIndex * 2 + 1][columnIndex] = bottom;
    });
  });

  return pixels;
}

function getBrailleRowsFromPixels(pixels) {
  const rows = [];

  for (let y = 0; y < pixels.length; y += 4) {
    const row = [];
    for (let x = 0; x < pixels[0].length; x += 2) {
      let pattern = 0;
      let shade = 0;
      for (let dy = 0; dy < 4; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const value = pixels[y + dy]?.[x + dx] ?? 0;
          if (value > 0) {
            pattern += BRAILLE_BITS[dy][dx];
            shade = Math.max(shade, value);
          }
        }
      }
      row.push({
        char: pattern === 0 ? ' ' : String.fromCodePoint(BRAILLE_BASE + pattern),
        shade,
      });
    }
    rows.push(row);
  }

  return rows;
}

function getBrailleRows(frameIndex) {
  return getBrailleRowsFromPixels(decodeFramePixels(frameIndex));
}

export function makeHorseFrame(frameIndex, options = {}) {
  const color = options.color ?? true;
  return getBrailleRows(frameIndex).map((row) => {
    if (!color) {
      return row.map(({ char }) => char).join('').replace(/\s+$/u, '');
    }

    // 같은 색 구간을 run 으로 묶어 escape 시퀀스를 최소화한다 (statusline 출력량 절감)
    let line = '';
    let activeShade = 0;
    for (const { char, shade } of row) {
      if (shade !== activeShade) {
        line += shade === 0 ? RESET : GREEN_SHADES[shade].fg;
        activeShade = shade;
      }
      line += char;
    }
    if (activeShade !== 0) line += RESET;
    return line.replace(/\s+$/u, '');
  }).join('\n');
}

export function getHorsePlainFrame(frameIndex) {
  return makeHorseFrame(frameIndex, { color: false });
}

export function getHorseCompactRows(frameIndex) {
  return getBrailleRows(frameIndex);
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

function readStatuslineState(stateFile) {
  try {
    const data = JSON.parse(readFileSync(stateFile, 'utf8'));
    return {
      tokenRate: Number.isFinite(Number(data.tokenRate)) ? Number(data.tokenRate) : 0,
      totalTokens: Number.isFinite(Number(data.totalTokens)) ? Number(data.totalTokens) : null,
      legPhase: Number.isFinite(Number(data.legPhase)) ? Number(data.legPhase) : 0,
      updatedAt: Number.isFinite(Number(data.updatedAt)) ? Number(data.updatedAt) : Date.now(),
    };
  } catch {
    return {
      tokenRate: 0,
      totalTokens: null,
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
  const now = Date.now();
  const state = readStatuslineState(stateFile);
  const deltaSec = clamp((now - state.updatedAt) / 1000, 0, STATUSLINE_MAX_DELTA_SEC);

  if (payload?.tokensPerSecond !== undefined) {
    state.tokenRate = smoothTokenRate(state.tokenRate, payload.tokensPerSecond);
  } else if (payload?.totalTokens !== undefined) {
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
  process.stdout.write(`${makeHorseFrame(Math.floor(state.legPhase), { color })}\n`);
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
    process.stdout.write(makeHorseFrame(Math.floor(legPhase)));
    process.stdout.write('\n');

    if (durationSec > 0 && elapsedSec >= durationSec) return shutdown(0);
    timer = setTimeout(tick, FRAME_INTERVAL_MS);
    return null;
  }

  tick();
}

const currentPath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentPath) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
