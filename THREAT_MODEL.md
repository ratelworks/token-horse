# Threat Model — token-horse

## 1. 무엇을 만드는가 (system)

로컬 전용 터미널 pet CLI. 네트워크 호출 없음, 셸 실행 없음(런타임), eval 없음.

데이터 흐름:

```
[stdin JSON (Claude Code statusline)] ─┐
[CLI 인자]                             ├→ JSON.parse / Number.parseFloat → 프레임 렌더 (stdout)
[~/.codex/sessions/**/rollout-*.jsonl] ┘            ↓
                              [$XDG_STATE_HOME/token-horse/state-*.json 읽기/쓰기]
```

- 신뢰 입력: Claude Code가 생성하는 statusline JSON, Codex CLI가 생성하는 세션 로그 (둘 다 로컬 도구 산출물).
- 비신뢰 가능 입력(공격면): `session_id` 필드 (state 파일명에 사용), `--state-file`/`--codex-sessions` CLI 인자 (사용자 본인이 지정).

## 2. 무엇이 잘못될 수 있나 (threats)

| 위협 | 경로 | 평가 |
|------|------|------|
| Path traversal via `session_id` | 악성 JSON이 `"session_id": "../../x"` 주입 → state 파일이 의도 밖 경로에 쓰임 | **완화됨** — sanitize: `[^a-zA-Z0-9_-]` 전부 제거 + 64자 제한 (CWE-22) |
| 거대 세션 로그로 메모리 고갈 | 수십 GB jsonl 전체 로드 | **완화됨** — tail 64KB만 읽음 |
| 악성 JSON 파싱 폭주 | 깊은 중첩/거대 stdin | 낮음 — statusline stdin은 Claude Code 산출물. JSON.parse 실패는 catch 후 무시 |
| state 파일 오염 | 다른 프로세스가 state.json 변조 → NaN 전파 | **완화됨** — 모든 필드 `Number.isFinite` 검증 후 기본값 폴백 |
| 명령 실행 | — | 런타임 경로에 child_process 없음. `render-horse-preview.mjs`(개발 도구)만 `execFileSync('magick', [...])` — 고정 바이너리명 + 배열 인자 (셸 미경유) |

## 3. 무엇을 할 것인가 (mitigations)

- session_id sanitize 유지 (AGENTS.md Critical Rules에 고정).
- 입력 숫자 전수 `Number.isFinite` 게이트 유지.
- 의존성 0 유지 — supply chain 면적 최소화.
- `check:oss-hygiene` 게이트가 publish/CI에서 내부 정보 누출 차단.

## 4. 잘 했는가 (validation)

- `npm run check` — 테스트 10종 (프레임 계약, statusline 1회성, session 격리, Codex 파싱).
- 재스캔 주기: 외부 입력 경로(파싱 대상 필드)가 늘어날 때마다 본 문서 갱신.
