# Threat Model — token-horse

## 1. 무엇을 만드는가 (system)

로컬 전용 터미널 pet CLI. 네트워크 호출 없음, 셸 실행 없음(런타임), eval 없음.

데이터 흐름:

```
[stdin JSON (Claude Code statusline)] ─┐
[transcript_path JSONL (Claude Code)]  │
[CLI 인자]                             ├→ JSON.parse / Number.parseFloat → 프레임 렌더 (stdout)
                                       ┘            ↓
                              [$XDG_STATE_HOME/token-horse/state-*.json 읽기/쓰기]
```

- 신뢰 입력: Claude Code가 생성하는 statusline JSON + 그 안의 `transcript_path` 가 가리키는 세션 JSONL (모두 Claude Code 산출물).
- 비신뢰 가능 입력(공격면): `session_id` 필드 (state 파일명에 사용), `transcript_path` 필드 (읽을 파일 경로), `--state-file` CLI 인자 (사용자 본인이 지정).

### Claude Code mod (`hooks/register.tsx`)

Claude Code가 플러그인용으로 띄우는 별도 실행 환경에서 돈다 — Node·DOM·파일시스템·네트워크·프로세스 접근 없음, 바깥은 `$` 로만 닿는다. mod가 쓰는 것은 `$.clock`, `$.command.register`, `$.store`(키 `hidden` 하나), `$.state`(자기 값 `hidden`·`rate`), `$.ui.blit`/`$.ui.resolve` 뿐이다(`claude plugin validate .` 가 호출 목록을 출력).

- 입력: `turn.step` 스트림의 조각(text/thinking 길이, tool 인자 JSON 길이)과 stop 의 usage 숫자. 내용은 길이만 쓰고 저장·표시하지 않는다.
- 출력: 프롬프트 위 band 의 셀 격자와 속도 숫자.

## 2. 무엇이 잘못될 수 있나 (threats)

| 위협 | 경로 | 평가 |
|------|------|------|
| Path traversal via `session_id` | 악성 JSON이 `"session_id": "../../x"` 주입 → state 파일이 의도 밖 경로에 쓰임 | **완화됨** — sanitize: `[^a-zA-Z0-9_-]` 전부 제거 + 64자 제한 (CWE-22) |
| 거대 세션 로그로 메모리 고갈 | 수십 GB jsonl 전체 로드 | **완화됨** — transcript 는 직전 offset 이후 증분만 읽음 |
| `transcript_path` 임의 파일 읽기 | 악성 statusline JSON이 `transcript_path`로 임의 경로 지정 → 그 파일을 읽음 | **낮음** — statusline JSON은 Claude Code 산출물(신뢰). 읽기 전용·byte offset 증분만·`usage` 숫자만 추출 → stdout엔 말 프레임만 출력(파일 내용 비노출) |
| 악성 JSON 파싱 폭주 | 깊은 중첩/거대 stdin | 낮음 — statusline stdin은 Claude Code 산출물. JSON.parse 실패는 catch 후 무시 |
| state 파일 오염 | 다른 프로세스가 state.json 변조 → NaN 전파 | **완화됨** — 모든 필드 `Number.isFinite` 검증 후 기본값 폴백 |
| mod가 응답 스트림을 망가뜨림 | `turn.step` 훅 예외로 조각 유실·변형 | **완화됨** — 조각은 받은 그대로 다시 내보내고(재작성 없음), 집계는 try/catch 로 감싸 실패해도 스트림은 계속된다 |
| mod가 대화 내용을 수집 | 스트림 텍스트 접근 | **낮음** — 길이만 더하고 텍스트는 보관·전송하지 않음. 네트워크·파일 API 자체가 없는 환경 |
| 명령 실행 | — | 런타임 경로에 child_process 없음. `render-horse-preview.mjs`(개발 도구)만 `execFileSync('magick', [...])` — 고정 바이너리명 + 배열 인자 (셸 미경유) |

## 3. 무엇을 할 것인가 (mitigations)

- session_id sanitize 유지 (AGENTS.md Critical Rules에 고정).
- 입력 숫자 전수 `Number.isFinite` 게이트 유지.
- 의존성 0 유지 — supply chain 면적 최소화.
- `check:oss-hygiene` 게이트가 publish/CI에서 내부 정보 누출 차단.

## 4. 잘 했는가 (validation)

- `npm run check:mod` — `claude plugin validate .`(훅·호출·state 계약 검증) + `claude plugin test .`(엔진 위 테스트 6종: band 크기, 숨김/보이기, usage 가중 속도, 소비 중단 시 정지).
- `npm run check` — 테스트 17종 (프레임 계약, statusline 1회성, session 격리, transcript 증분 토큰).
- 재스캔 주기: 외부 입력 경로(파싱 대상 필드)가 늘어날 때마다 본 문서 갱신.
