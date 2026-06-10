# Changelog

## 0.1.0 — 2026-06-10

Claude Code statusline과 Codex CLI에서 토큰 속도에 반응해 달리는 말 pet의 첫 공개 릴리즈.

### 추가

- 16자 x 4줄 braille 말 애니메이션 (15프레임 갤럽 사이클, 녹색 3단 명도).
- 연속형 속도 매핑: 20 tokens/sec(느림) ~ 900+ tokens/sec(전력 질주), 입력이 끊기면 지수 감쇠로 정지.
- `--statusline` 모드: Claude Code statusline JSON(stdin) 1회 읽기 → 한 프레임 출력. `session_id`별 state 격리로 멀티세션 동시 사용 지원 (48시간 지난 state 자동 정리).
- `--watch-codex` 모드: Codex CLI는 커스텀 statusline 명령을 지원하지 않으므로 세션 로그(`rollout-*.jsonl`)의 `token_count` 이벤트를 tail하여 연속 애니메이션으로 표시.
- 입력 형식: `tokensPerSecond` 직접 / 누적 토큰(`usage.total_tokens` 등) / Claude Code `context_window.*` / Codex `total_token_usage.total_tokens`.
- 색상 run-length 인코딩으로 statusline 출력량 최소화 (`--plain`으로 무색 출력).
