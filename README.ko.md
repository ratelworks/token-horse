# Token Horse

터미널 한구석에서 작은 말 한 마리가 달립니다. AI가 토큰을 빠르게 쓸수록 말은 더 신나게 달리고, 일이 끝나면 멈춰 서서 가끔 눈을 깜빡이며 다음 일을 기다립니다.

옛날 택시 미터기 위에는 작은 말이 있었습니다. 요금이 올라갈수록 더 빨리 달리던 그 말을, AI 코딩 시대의 토큰 미터기로 데려왔습니다. [Claude Code](https://code.claude.com)와 [Codex CLI](https://developers.openai.com/codex/cli)에서 쓸 수 있습니다.

[English README](./README.md)

![Token Horse — 토큰이 흐르면 달리고, 멈추면 섭니다](https://raw.githubusercontent.com/ratelworks/token-horse/main/statusline-demo.gif)

## 설치

```bash
npm install -g token-horse
```

설치 없이 데모만 구경하기:

```bash
npx token-horse --rate=600 --duration=8
```

## Claude Code statusline 연결

`settings.json`의 `statusLine`에 연결하면 됩니다. statusline은 멀티라인 출력을 공식 지원해서 말이 그대로 표시됩니다.

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

- `refreshInterval: 1`을 권장합니다. statusline은 기본적으로 이벤트(새 응답, compact 등)가 있을 때만 다시 실행되는데, 1초 타이머가 있어야 응답 사이 조용한 구간에서 말이 자연스럽게 속도를 줄입니다.
- 이미 쓰고 있는 statusline 스크립트가 있다면 `--info-cmd`로 함께 표시할 수 있습니다. 기존 정보줄은 왼쪽에, 말은 오른쪽 빈 공간에 자리 잡습니다:

```json
{
  "statusLine": {
    "type": "command",
    "command": "token-horse --statusline --info-cmd=\"bash $HOME/.claude/statusline.sh\"",
    "padding": 0,
    "refreshInterval": 1
  }
}
```

- 터미널이 truecolor ANSI를 제대로 표시하지 못하면 `--plain`을 붙여 주세요.

## Codex CLI 연결

Codex CLI의 `tui.status_line`은 내장 위젯만 허용하고 외부 명령은 실행하지 못합니다. 그래서 Token Horse가 Codex 세션 로그(`~/.codex/sessions/**/rollout-*.jsonl`)의 `token_count` 이벤트를 직접 따라 읽습니다. 별도 터미널이나 tmux pane에서 실행하세요:

```bash
token-horse --watch-codex
```

- 가장 최근 세션 파일을 자동으로 찾고, 새 세션이 시작되면 따라갑니다.
- 세션 누적 토큰(`total_token_usage.total_tokens`)의 변화량으로 속도를 계산합니다.
- 기본은 무한 실행이고 Ctrl+C로 종료합니다. `--duration=초`로 시간을 제한할 수도 있습니다.
- 세션 디렉토리가 다르다면 `--codex-sessions=/path/to/sessions`로 알려 주세요.

tmux 하단 pane에 붙이는 예시:

```bash
tmux split-window -v -l 9 'token-horse --watch-codex --no-clear'
```

## 스킨

여러 색상 팔레트를 제공합니다. `--skin=<이름>`으로 고르며, 기본값은 `green`입니다. `token-horse --list-skins`로 모든 스킨을 터미널에서 컬러로 미리볼 수 있고, `token-horse --help`로 전체 옵션을 확인할 수 있습니다.

| 스킨 | 모습 |
|------|------|
| `green` | 클래식 — 3단계 녹색 음영 (기본값). |
| `rapidash` | 크림색 몸통에 빨강·노랑이 일렁이는 불꽃 갈기와 꼬리, 회색 발굽. 불꽃 포켓몬 날쌩마에서 따왔습니다. 프레임마다 불꽃 색이 바뀌어 달릴 때 갈기가 너울거립니다. |
| `bay` | 실제 밤색말 — 갈색 털에 검은 갈기·꼬리·발굽. |
| `redhare` | 적토마(赤兔馬) — 삼국지의 전설적인 붉은 명마. |
| `inferno` | 온몸이 불타는 말 — 빨강 → 주황 → 노랑. |

```bash
token-horse --statusline --skin=rapidash
```

설치 없이 미리보기:

```bash
npx token-horse --rate=600 --duration=8 --skin=redhare
```

각 팔레트는 부위별(몸통 / 갈기 + 꼬리 / 발굽)로 나뉘어 있어, 같은 질주 애니메이션을 그대로 쓰면서 부위마다 독립적으로 색을 입힙니다. 단색 스킨(`green`, `inferno`)은 실루엣 전체를 한 색역으로 칠합니다.

## 동작 방식

- 기본 L 사이즈는 32자 × 8줄 반각 블록 프레임으로, 프리뷰 GIF와 픽셀 단위로 같습니다. 작게 쓰고 싶으면 `--size=s`(16자 × 4줄)도 있습니다.
- 말 실루엣은 3단 명도(truecolor ANSI)의 솔리드 블록으로 그려집니다 — 기본은 녹색이고 위 스킨 중 하나를 고를 수 있습니다 — 어떤 모노스페이스 폰트에서도 선명하게 보입니다.
- Claude Code에서는 **이 세션이 실제로 소비한 토큰**에 반응합니다. 세션의 `transcript_path` JSONL을 읽어 실소비 토큰(input + output + cache_creation, 캐시 재사용 읽기는 제외)의 증분을 속도로 환산합니다. transcript는 덧붙기만 하는 파일이라 컨텍스트 압축이나 캐시 재사용에 속도가 왜곡되지 않습니다.
- 속도는 단계가 아니라 연속입니다. 20 tokens/sec 근처면 느릿느릿, 900 tokens/sec를 넘으면 전력 질주합니다.
- 토큰 펄스는 즉시 반영됩니다 — 빠른 모델일수록 정말 미친 듯이 달립니다. 대신 천천히 식기 때문에 작업하는 동안에는 계속 달리고, 토큰이 정말 멈췄을 때만 바로 서서 기다립니다.
- 달리는 동안에는 원본 스프라이트의 갈기 모션이 은은하게 재생되고, 서 있을 때는 몇 초마다 눈을 깜빡입니다.
- statusline 모드는 stdin JSON을 한 번 읽고 한 프레임만 출력한 뒤 종료합니다.
- 프레임 진행 상태는 `~/.local/state/token-horse/`(또는 `$XDG_STATE_HOME`)에 저장됩니다. Claude Code `session_id`별로 state 파일을 나누기 때문에 여러 세션을 동시에 띄워도 속도가 섞이지 않고, 48시간 지난 state는 알아서 정리됩니다.

## 입력 형식

직접 속도를 줄 수도 있고:

```json
{ "tokensPerSecond": 450 }
```

누적 토큰을 줄 수도 있습니다:

```json
{ "usage": { "total_tokens": 123456 } }
```

Claude Code statusline 입력 — `transcript_path` JSONL을 읽어 턴별 실소비 토큰을 누적하고, 호출 사이의 증분으로 tokens/sec를 계산합니다:

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/your-project/abc123.jsonl"
}
```

Codex 세션 이벤트 라인 (`--watch-codex`가 내부에서 읽는 형식):

```json
{ "type": "event_msg", "payload": { "type": "token_count", "info": { "total_token_usage": { "total_tokens": 20987209 } } } }
```

누적 토큰이 들어오면 이전 호출과의 차이로 tokens/sec를 계산합니다.

## 개발

```bash
npm run check   # 구문 검사 + 테스트 + OSS 위생 게이트
npm run demo    # 파형 데모 애니메이션
```

## 라이선스

MIT © Ratelworks Inc.
