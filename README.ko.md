# Token Horse

Token Horse는 [Claude Code](https://code.claude.com)와 [Codex CLI](https://developers.openai.com/codex/cli)에서 토큰 사용 속도에 비례해 달리는 말 pet이다.

옛날 택시 미터기 위에서 요금이 올라갈수록 더 빨리 달리던 작은 말에서 영감을 받았다 — 모델이 토큰을 태울수록 이 말도 더 빨리 달린다.

[English README](./README.md)

![Token Horse preview](./horse-preview.gif)

## 설치

```bash
npm install -g token-horse
```

설치 없이 데모만 보기:

```bash
npx token-horse --rate=600 --duration=8
```

## Claude Code statusline 연결

`settings.json`의 `statusLine` command에 연결한다. statusline은 멀티라인 출력을 공식 지원하므로 4줄 말이 그대로 표시된다.

```json
{
  "statusLine": {
    "type": "command",
    "command": "token-horse --statusline",
    "padding": 0,
    "refreshInterval": 1
  }
}
```

- `refreshInterval: 1`을 권장한다. statusline은 기본적으로 이벤트(새 응답, compact 등)에서만 재실행되므로, 타이머 재실행이 있어야 응답 사이 유휴 구간에서 말이 자연스럽게 감속한다.
- 터미널이 truecolor ANSI를 제대로 표시하지 않으면 `--plain`을 붙인다.

## Codex CLI 연결

Codex CLI의 `tui.status_line`은 내장 위젯 식별자만 허용하고 외부 명령을 실행하지 못한다. 대신 Token Horse가 Codex 세션 로그(`~/.codex/sessions/**/rollout-*.jsonl`)의 `token_count` 이벤트를 직접 tail한다. 별도 터미널이나 tmux pane에서 실행한다:

```bash
token-horse --watch-codex
```

- 가장 최근 세션 파일을 자동으로 찾고, 새 세션이 시작되면 따라간다.
- 세션 누적 토큰(`total_token_usage.total_tokens`)의 차이로 속도를 계산한다.
- 기본 무한 실행이며 Ctrl+C로 종료한다. `--duration=초`로 제한할 수 있다.
- 세션 디렉토리가 다르면 `--codex-sessions=/path/to/sessions`로 지정한다.

tmux 하단 pane 예시:

```bash
tmux split-window -v -l 5 'token-horse --watch-codex --no-clear'
```

## 동작 방식

- 기본 L 사이즈는 32자 x 8줄 반각 블록 프레임 — 프리뷰 GIF와 픽셀 단위로 동일하다. 컴팩트가 필요하면 `--size=s` (16자 x 4줄).
- 말 실루엣은 녹색 3단 명도(truecolor ANSI)의 솔리드 블록 글리프로 그려져 어떤 모노스페이스 폰트에서도 선명하다.
- Claude Code에서는 **이 세션의 실제 토큰 소비량**에 연동된다: token-horse가 세션의 `transcript_path` JSONL을 읽어 폴링 사이의 실소비 토큰 증분(input + output + cache_creation, 캐시 재사용 읽기는 제외)을 속도로 환산한다. transcript는 append-only라 컨텍스트 compaction이나 캐시 재사용에 속도가 왜곡되지 않는다.
- 속도는 단계형이 아니라 연속형이다: 20 tokens/sec 근처는 느리게, 900 tokens/sec 이상은 전력 질주.
- 토큰 펄스는 즉시 반영된다(빠른 모델이면 미친 듯이 달린다). 감쇠는 느려서 작업 중에는 계속 달리고, 토큰 소진이 정말 없을 때만 직립 자세로 선다.
- 달릴 때는 원본 스프라이트의 갈기 모션이 은은하게 재생되고, 몇 초마다 눈을 깜빡인다.
- statusline 모드는 stdin JSON을 1회 읽고 한 프레임만 출력한 뒤 종료한다.
- 프레임 진행 상태는 `~/.local/state/token-horse/`(또는 `$XDG_STATE_HOME`)에 저장한다. Claude Code `session_id`별로 state 파일을 격리하므로 멀티세션에서도 속도 계산이 섞이지 않는다 (48시간 지난 세션 state는 자동 정리).

## 입력 형식

직접 속도:

```json
{ "tokensPerSecond": 450 }
```

누적 토큰:

```json
{ "usage": { "total_tokens": 123456 } }
```

Claude Code statusline 입력 — token-horse가 `transcript_path` JSONL을 읽어 턴별 실소비 토큰(`input + output + cache_creation`, 캐시 재사용 읽기 제외)을 누적하고, 폴링 사이의 증분으로 tokens/sec를 계산한다:

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/your-project/abc123.jsonl"
}
```

Codex 세션 이벤트 라인 (`--watch-codex`가 내부적으로 파싱하는 형식):

```json
{ "type": "event_msg", "payload": { "type": "token_count", "info": { "total_token_usage": { "total_tokens": 20987209 } } } }
```

누적 토큰을 받으면 이전 호출과의 차이로 tokens/sec를 계산한다.

## 개발

```bash
npm run check   # 구문 검사 + 테스트 + OSS 위생 게이트
npm run demo    # 파형 데모 애니메이션
```

## 라이선스

MIT © Ratelworks Inc.
