# Changelog

## 0.1.1 — 2026-06-10

빠른 모델(고속 토큰 생성)에서 속도가 눈에 보이도록 운동 모델을 다듬은 릴리즈.

### 변경

- 토큰 펄스 즉응: transcript/Codex 누적 증분이 오면 측정 속도로 즉시 점프하고(EMA 제거), 느리게 감쇠한다(0.95/초) — 작업 중에는 질주가 유지되고 진짜 유휴일 때만 멈춘다.
- 유휴 정지: 속도가 5 tokens/sec 미만이면 다리를 멈추고 직립 자세로 선다.
- statusline 포즈 점프 캡(폴당 4프레임): 1초 1회 갱신 환경에서 고속이 랜덤 포즈로 보이던 문제 해소. 4는 15와 서로소라 전 프레임을 순회하며 원본의 갈기 미세 모션이 자연 재생된다.
- 눈 깜빡임: 평소엔 또렷한 눈, 6초마다 1초간 반쯤 감긴 눈 — 항상 보인다.
- 원본(OpenGameArt, CC0) 15프레임과 픽셀 단위 무손실 일치 검증 (정렬 시프트 제외 diff 0).


## 0.1.0 — 2026-06-10

Claude Code statusline과 Codex CLI에서 토큰 속도에 반응해 달리는 말 pet의 첫 공개 릴리즈.

### 추가

- 16자 x 4줄 braille 말 애니메이션 (15프레임 갤럽 사이클, 녹색 3단 명도).
- 연속형 속도 매핑: 20 tokens/sec(느림) ~ 900+ tokens/sec(전력 질주), 입력이 끊기면 지수 감쇠로 정지.
- `--statusline` 모드: Claude Code statusline JSON(stdin) 1회 읽기 → 한 프레임 출력. `session_id`별 state 격리로 멀티세션 동시 사용 지원 (48시간 지난 state 자동 정리).
- `--watch-codex` 모드: Codex CLI는 커스텀 statusline 명령을 지원하지 않으므로 세션 로그(`rollout-*.jsonl`)의 `token_count` 이벤트를 tail하여 연속 애니메이션으로 표시.
- 입력 형식: `tokensPerSecond` 직접 / 누적 토큰(`usage.total_tokens` 등) / Claude Code `transcript_path`(세션 JSONL 의 턴별 실소비 토큰 증분 = input+output+cache_creation, 캐시 재사용분 제외) / Codex `total_token_usage.total_tokens`. `context_window` 점유량은 캐시 재사용분이 지배적이고 compaction 시 감소하여 속도 신호로 부적합하므로 사용하지 않는다.
- 색상 run-length 인코딩으로 statusline 출력량 최소화 (`--plain`으로 무색 출력).
