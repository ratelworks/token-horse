// token-horse mod 의 $.state 계약
export type TokenHorseRate = number;

declare module 'claude-code' {
  interface PluginState {
    'token-horse': { hidden: boolean; rate: TokenHorseRate };
  }
}
