// horse-core.mjs 타입 선언 — mod(TypeScript)가 코어를 import 할 때 쓴다
export type HorseCell = { ch: string; fg: string | null; bg: string | null };
export type HorseCells = { columns: number; rows: number; cells: HorseCell[] };
export type HorseFrameOptions = { skin?: string; size?: 's' | 'l' | string; blink?: boolean };
export type TokenUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export const DEFAULT_SKIN: string;
export const BLINK_PERIOD_SEC: number;
export const SHADED_FRAMES: string[][];
export const SKIN_LABELS: Record<string, string>;
export const IDLE_RATE_THRESHOLD: number;
export function makeHorseCells(frameIndex: number, options?: HorseFrameOptions): HorseCells;
export function getSkinNames(): string[];
export function isKnownSkin(name: string): boolean;
export function weighClaudeUsage(usage: TokenUsage | null | undefined): number;
export function tokenRateToLegFps(tokensPerSecond: number): number;
export function smoothTokenRate(currentRate: number, nextRate: number): number;
