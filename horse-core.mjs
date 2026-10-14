// Token Horse 공용 코어 — 스프라이트·스킨·소비 속도 곡선.
// Node API 를 쓰지 않는다: CLI(horse-token-runner.mjs)와 Claude Code mod(hooks/register.tsx)가
// 같은 파일을 import 해서 두 표면의 말이 픽셀·색·속도 모두 같게 움직인다.

// ── 소비 속도 → 다리 속도 ────────────────────────────────────────────
// 속도 단위 = "입력 환산 토큰/초": 요청별 usage 4종을 입력 단가 대비 비율로 가중한 값.
// 한도(쿼터)가 실제로 닳는 속도와 같은 축이다 — 실측상 소비의 대부분은 출력이 아니라
// 긴 컨텍스트의 캐시 읽기·쓰기라서, 출력만 세면 말이 거의 서 있게 된다.
export const CLAUDE_USAGE_WEIGHTS = {
  input: 1,
  cacheWrite: 1.25, // 5분 캐시 쓰기 = 입력 단가의 1.25배
  cacheRead: 0.1,   // 캐시 읽기 = 0.1배
  output: 5,        // 출력 = 5배
};
export const CODEX_USAGE_WEIGHTS = {
  input: 1,
  cachedInput: 0.1,
  output: 8,
};

// 로그 스케일 보정 구간 (입력 환산 토큰/초). 활동 중 10초 창 실측 분포
// p10≈2.5k · p50≈4.2k · p90≈7k · p99≈44k 를 다리 속도 전 구간에 고르게 펼친다.
export const TOKEN_RATE_SLOW = 500;
export const TOKEN_RATE_FAST = 15000;
// 이 아래는 소비 없음으로 보고 말이 선다
export const IDLE_RATE_THRESHOLD = 50;
export const MIN_LEG_FPS = 1.5;
export const MAX_LEG_FPS = 24;
export const TOKEN_RATE_EMA_ALPHA = 0.28;

// 스프라이트 상수
export const EYE_PIXEL = [3, 27];
export const BLINK_PERIOD_SEC = 6;
export const DEFAULT_SKIN = 'green';
// 이 행부터는 발굽
const HOOF_MIN_ROW = 14;
// 꼬리: 몸통 왼끝보다 왼쪽으로 흩날린다
const TAIL_MAX_COL = 12;
const TAIL_MIN_ROW = 5;
const TAIL_MAX_ROW = 10;
// 갈기 목덜미: 머리 뒤 수직부 (얼굴/주둥이 c25+ 는 제외)
const MANE_NECK_MIN_COL = 21;
const MANE_NECK_MAX_COL = 24;
const MANE_NECK_MIN_ROW = 2;
const MANE_NECK_MAX_ROW = 6;
// 갈기 정수리: 머리 위
const MANE_CREST_MIN_COL = 23;
const MANE_CREST_MAX_COL = 26;
const MANE_CREST_MAX_ROW = 1;
// 꼬리는 음영 1~2(윤곽·가는 부분)만, 음영 3(밝은 몸통 면)은 엉덩이라 제외
const TAIL_MAX_SHADE = 2;

export const BLOCK_TOP = '▀';
export const BLOCK_BOTTOM = '▄';
export const BLOCK_FULL = '█';

// 스킨 정의 — 단색(mono)은 body 만, 캐릭터는 부위별(body/mane/hoof).
// mane = 갈기·꼬리, hoof = 발굽. 도트의 음영값은 각 부위색의 명암으로 재사용된다
// (= 부위가 색상, 음영이 명도). 단색 스킨은 부위를 무시하고 body 만 쓴다.
// flame: true 면 갈기·꼬리를 음영값이 아니라 불꽃 레벨(빨강1/주황2/노랑3)로 칠해
// 프레임마다 색이 일렁인다. 이때 mane 3색은 명암이 아니라 불꽃 색온도다.
export const SKIN_HEX = {
  green: { body: ['#0f5f24', '#24b84a', '#59ff75'] },
  rapidash: {
    body: ['#b8a878', '#ddcca0', '#f2ead2'],
    mane: ['#e81810', '#f87012', '#f8d420'],
    hoof: ['#5a6678', '#8492a4', '#aab6c6'],
    flame: true,
  },
  bay: {
    body: ['#3d2410', '#6b4423', '#9a6536'],
    mane: ['#15110d', '#2a2018', '#3d2e22'],
    hoof: ['#161616', '#303030', '#4a4a4a'],
  },
  redhare: {
    body: ['#7a1408', '#bc3618', '#ee6a2c'],
    mane: ['#560a04', '#9c1c0c', '#d84818'],
    hoof: ['#241410', '#46281a', '#6a4028'],
  },
  inferno: { body: ['#c81c08', '#f06010', '#f8c828'] },
};

// 스킨 한 줄 설명 (영어) — --help / --list-skins / mod 설정 안내용
export const SKIN_LABELS = {
  green: 'The classic green (default)',
  rapidash: 'Cream coat with a flickering red-and-yellow fire mane and tail',
  bay: 'A realistic bay horse — brown coat, black mane and hooves',
  redhare: 'Red Hare — the crimson Three Kingdoms warhorse',
  inferno: 'The whole horse ablaze, red to yellow',
};

// 도트 프레임 (16진 1글자 = 상하 2픽셀의 음영 top*4+bottom)
export const SHADED_FRAMES = [
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

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── 소비량 가중 ─────────────────────────────────────────────────────
function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Claude usage(transcript·API 의 snake_case 4종) → 입력 환산 토큰
export function weighClaudeUsage(usage) {
  if (!usage) return 0;
  const w = CLAUDE_USAGE_WEIGHTS;
  return count(usage.input_tokens) * w.input
    + count(usage.cache_creation_input_tokens) * w.cacheWrite
    + count(usage.cache_read_input_tokens) * w.cacheRead
    + count(usage.output_tokens) * w.output;
}

// Codex token_usage(input 에 cached 포함) → 입력 환산 토큰
export function weighCodexUsage(usage) {
  if (!usage) return 0;
  const w = CODEX_USAGE_WEIGHTS;
  const cached = count(usage.cached_input_tokens);
  const fresh = Math.max(0, count(usage.input_tokens) - cached);
  return fresh * w.input + cached * w.cachedInput + count(usage.output_tokens) * w.output;
}

export function normalizeTokenRate(tokensPerSecond) {
  if (!(tokensPerSecond > TOKEN_RATE_SLOW)) return 0;
  return clamp(Math.log(tokensPerSecond / TOKEN_RATE_SLOW) / Math.log(TOKEN_RATE_FAST / TOKEN_RATE_SLOW), 0, 1);
}

export function tokenRateToLegFps(tokensPerSecond) {
  // 소비 없음 = 서 있기
  if (!(tokensPerSecond >= IDLE_RATE_THRESHOLD)) return 0;
  return MIN_LEG_FPS + normalizeTokenRate(tokensPerSecond) * (MAX_LEG_FPS - MIN_LEG_FPS);
}

export function smoothTokenRate(currentRate, nextRate) {
  if (!Number.isFinite(nextRate)) return currentRate;
  if (!Number.isFinite(currentRate) || currentRate <= 0) return nextRate;
  return currentRate * (1 - TOKEN_RATE_EMA_ALPHA) + nextRate * TOKEN_RATE_EMA_ALPHA;
}

// ── 스킨 ───────────────────────────────────────────────────────────
// 음영 3단계 hex 배열 → [null, shade1, shade2, shade3] (인덱스 0 = 빈 픽셀)
function buildPalette(hexArr) {
  return [null, ...hexArr];
}

const SKINS = Object.fromEntries(
  Object.entries(SKIN_HEX).map(([name, parts]) => [name, {
    body: buildPalette(parts.body),
    mane: parts.mane ? buildPalette(parts.mane) : null,
    hoof: parts.hoof ? buildPalette(parts.hoof) : null,
    flame: parts.flame ?? false,
  }]),
);

export function getSkinNames() {
  return Object.keys(SKINS);
}

export function isKnownSkin(name) {
  return Object.hasOwn(SKINS, name);
}

function resolveSkin(name) {
  return SKINS[name] ?? SKINS[DEFAULT_SKIN];
}

// 스킨의 한 부위(body/mane/hoof) 음영 hex 3색 — [null, 어두운, 중간, 밝은]
export function getSkinShades(skinName = DEFAULT_SKIN, part = 'body') {
  const skin = resolveSkin(skinName);
  return [...(skin[part] ?? skin.body)];
}

// 부위 마스크 (32x16 풀해상도 픽셀 좌표 기준) — 오른쪽을 보고 달리는 말 실루엣.
// 발굽 = 하단 2행 / 갈기·꼬리 = 목덜미·정수리·엉덩이 뒤 / 나머지 = 몸통.
function partNameAt(skin, pixelRow, pixelCol, shade) {
  // 단색 스킨 — 부위 무시
  if (!skin.mane) return 'body';
  if (pixelRow >= HOOF_MIN_ROW) return 'hoof';
  if (pixelCol <= TAIL_MAX_COL && pixelRow >= TAIL_MIN_ROW && pixelRow <= TAIL_MAX_ROW
    && shade <= TAIL_MAX_SHADE) return 'mane';
  if (pixelCol >= MANE_NECK_MIN_COL && pixelCol <= MANE_NECK_MAX_COL
    && pixelRow >= MANE_NECK_MIN_ROW && pixelRow <= MANE_NECK_MAX_ROW) return 'mane';
  if (pixelCol >= MANE_CREST_MIN_COL && pixelCol <= MANE_CREST_MAX_COL
    && pixelRow <= MANE_CREST_MAX_ROW) return 'mane';
  return 'body';
}

export function partAt(skinName, pixelRow, pixelCol, shade) {
  return partNameAt(resolveSkin(skinName), pixelRow, pixelCol, shade);
}

// 불꽃 레벨(1=빨강 / 2=주황 / 3=노랑): 불꽃은 위로 갈수록 밝다. 픽셀 높이에
// 위치·프레임 너울(wobble)을 더해 빨강~노랑이 프레임마다 일렁인다.
// 계수 2는 3과 서로소 — frameIndex 가 바뀔 때마다 너울이 실제로 순환한다.
function flameShade(pixelRow, pixelCol, frameIndex) {
  const rise = (HOOF_MIN_ROW - pixelRow) / 4;
  const wobble = ((pixelCol + frameIndex * 2) % 3) - 1;
  return clamp(Math.round(rise) + wobble, 1, 3);
}

// 불꽃 스킨이면 갈기 픽셀의 불꽃 레벨, 아니면 null(원래 음영 사용)
export function maneFlameShade(skinName, pixelRow, pixelCol, frameIndex) {
  const skin = resolveSkin(skinName);
  return skin.flame ? flameShade(pixelRow, pixelCol, frameIndex) : null;
}

// ── 프레임 ─────────────────────────────────────────────────────────
function decodeCellsToPixels(cells) {
  const pixels = Array.from({ length: cells.length * 2 }, () => Array(cells[0].length).fill(0));
  cells.forEach((row, rowIndex) => {
    Array.from(row).forEach((hexChar, columnIndex) => {
      const value = Number.parseInt(hexChar, 16);
      pixels[rowIndex * 2][columnIndex] = Math.floor(value / 4);
      pixels[rowIndex * 2 + 1][columnIndex] = value % 4;
    });
  });
  return pixels;
}

export function getHorsePixels(frameIndex) {
  return decodeCellsToPixels(SHADED_FRAMES[frameIndex % SHADED_FRAMES.length]);
}

export function getHorseFrameCells(frameIndex) {
  return SHADED_FRAMES[frameIndex % SHADED_FRAMES.length];
}

// 2x2 max-pooling 다운샘플: 32x16 픽셀 → 16x8 (컴팩트 렌더용)
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

// 눈 깜빡임: 평소엔 또렷한 눈(어두운 점), 깜빡일 땐 반쯤 감긴 눈(중간톤) — 항상 보인다
function applyBlink(pixels, blink) {
  const [r, c] = EYE_PIXEL;
  if (pixels[r]?.[c] >= 2) pixels[r][c] = blink ? 2 : 1;
}

// 반각 블록 셀 격자: 한 셀이 상하 2픽셀 (▀ fg=상단, bg=하단).
// size 'l'(기본): 32x16 풀해상도 → 32x8 셀 / size 's': 16x8 다운샘플 → 16x4 셀.
// 반환 셀: { ch, fg, bg } — fg/bg 는 '#rrggbb' 또는 null(터미널 기본색). 빈 셀은 ch ' '.
export function makeHorseCells(frameIndex, options = {}) {
  const skin = resolveSkin(options.skin ?? DEFAULT_SKIN);
  const pixels = getHorsePixels(frameIndex);
  applyBlink(pixels, options.blink ?? false);
  const compact = options.size === 's';
  const grid = compact ? downsampleHalf(pixels) : pixels;
  // grid 좌표 → 풀해상도 픽셀 좌표: 부위 마스크는 항상 풀해상도 기준이다
  const pixelScale = compact ? 2 : 1;
  const columns = grid[0].length;
  const rows = grid.length / 2;
  const cells = [];

  for (let r = 0; r < grid.length; r += 2) {
    for (let c = 0; c < columns; c += 1) {
      const top = grid[r][c];
      const bottom = grid[r + 1][c];
      if (!top && !bottom) {
        cells.push({ ch: ' ', fg: null, bg: null });
        continue;
      }

      // 상·하 픽셀이 서로 다른 부위일 수 있어 각각 부위·색을 고른다.
      // 불꽃 갈기는 음영값 대신 일렁이는 불꽃 레벨로 색을 골라 매 프레임 너울거린다.
      const pixelCol = c * pixelScale;
      const topRow = r * pixelScale;
      const bottomRow = (r + 1) * pixelScale;
      const topName = partNameAt(skin, topRow, pixelCol, top);
      const bottomName = partNameAt(skin, bottomRow, pixelCol, bottom);
      const topPalette = skin[topName] ?? skin.body;
      const bottomPalette = skin[bottomName] ?? skin.body;
      const topShade = skin.flame && topName === 'mane' ? flameShade(topRow, pixelCol, frameIndex) : top;
      const bottomShade = skin.flame && bottomName === 'mane' ? flameShade(bottomRow, pixelCol, frameIndex) : bottom;

      if (top && bottom) {
        const topColor = topPalette[topShade];
        const bottomColor = bottomPalette[bottomShade];
        if (topColor === bottomColor && topPalette === bottomPalette) {
          cells.push({ ch: BLOCK_FULL, fg: topColor, bg: null });
        } else {
          cells.push({ ch: BLOCK_TOP, fg: topColor, bg: bottomColor });
        }
      } else if (top) {
        cells.push({ ch: BLOCK_TOP, fg: topPalette[topShade], bg: null });
      } else {
        cells.push({ ch: BLOCK_BOTTOM, fg: bottomPalette[bottomShade], bg: null });
      }
    }
  }

  return { columns, rows, cells };
}

// 단색 글리프 — 색 정보 없이 점유만으로 고른다
export function plainGlyph(cell) {
  return cell.ch === BLOCK_TOP && cell.bg !== null ? BLOCK_FULL : cell.ch;
}
