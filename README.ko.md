<h1 align="center">Blueprint for Herdr</h1>

<p align="center"><b>코딩 에이전트가 만들고 있는 코드를 바로 옆에서 다이어그램으로 봅니다.</b></p>

<p align="center">
  <img src="docs/media/point-and-ask.gif" alt="Claude Code가 그린 POST /token 흐름에서 rotate(refresh_token) 박스를 고르고 E로 요청 창을 열어 'reject refresh tokens issued to another client'를 보내면, Claude Code가 코드를 고치고 Blueprint에 'family.clientId == client_id?' 확인 단계가 새로 그려집니다.">
  <br>
  <sub>박스를 가리켜 요청하면 Claude Code가 그 뒤의 코드를 고치고, Blueprint가 새 확인 단계를 그립니다. (<a href="docs/media/point-and-ask.mp4">MP4</a>)</sub>
</p>

Blueprint는 [Herdr](https://herdr.dev) 데스크톱 앱용 mod입니다. 에이전트가 지금 만드는 코드를 Mermaid flowchart로 그리면, Blueprint가 작업하는 동안 채팅 옆에 그 그림을 띄워 둡니다.

- **코드를 한눈에.** 박스 하나가 코드 한 조각이고 파일과 줄에 연결돼 있습니다. 끝난 부분에는 체크가, 만들고 있는 부분에는 노란색이 붙어서 채팅을 읽지 않아도 에이전트가 어디까지 왔는지 보입니다.
- **보고 있는 곳에 요청.** 박스를 고르고 `E`를 눌러 바꿀 내용을 쓰면, 에이전트는 그 박스와 코드 위치, 메모를 함께 받습니다.
- **저장소 밖에 보관.** 다이어그램은 Herdr 앱 폴더에 프로젝트와 worktree별로 쌓이고, 7일 동안 아무도 보지 않으면 지워집니다. 남기고 싶은 건 고정하면 됩니다.

## 설치

Herdr 안에서 에이전트를 띄우고 이렇게 부탁하세요.

```
https://github.com/chappse6/herdr-blueprint-app 에 있는 Herdr mod를 추가해 줘
```

에이전트는 Herdr의 `AGENTS.md`에 적힌 대로 `mods/blueprint`를 앱 폴더에 복사하고 확인합니다. 직접 하려면 `mods/blueprint`를 앱 폴더의 `mods` 아래(macOS는 `~/.config/herdr-app/mods/`)에 복사하고 `herdr-app check ~/.config/herdr-app/mods/blueprint`를 실행하세요.

그다음 Herdr 안의 아무 터미널에서 에이전트 옆에 엽니다.

```
herdr-app do pane.split --direction right --mod blueprint
```

## 둘러보기

### 1. 에이전트 연결

처음 열면 그 탭의 에이전트 목록이 나옵니다. 하나를 고르면 Blueprint가 지금 작업 중인 코드를 Blueprint 폴더에 그려 달라고 요청하고, 파일이 저장되는 순간 화면에 나타납니다.

<p align="center"><img src="docs/media/connect.gif" width="560" alt="빈 Blueprint에 Claude Code가 목록으로 나오고, 누르면 'Asked Claude Code to draw'가 뜬 뒤 Postgres 테이블과 Redis 키 다이어그램이 나타납니다."></p>

### 2. 흐름 따라가기

박스를 누르면 그 박스의 앞뒤로 이어진 흐름만 밝게 남고 나머지는 흐려집니다. 드래그로 이동하고, ⌘ 또는 Ctrl을 누른 채 스크롤하면 확대, `F`를 누르면 화면에 맞춥니다.

<p align="center"><img src="docs/media/flow.png" width="560" alt="POST /token 다이어그램에서 refresh_token 분기만 밝고 authorization_code 분기는 흐린 화면."></p>

### 3. 박스를 가리켜 요청

박스를 고른 상태에서 `E`를 누르고 바꿀 내용을 씁니다. Blueprint는 박스, 소스에서의 줄, 연결된 코드 경로, 다이어그램 전체를 에이전트 터미널에 입력하고, 끝나면 그림도 고쳐 달라고 함께 요청합니다.

<p align="center"><img src="docs/media/ask.png" width="720" alt="rotate(refresh_token), src/tokens.ts:27 박스 아래 Claude Code에게 가는 요청 창에 'reject refresh tokens issued to another client'가 적혀 있습니다."></p>

### 4. 작업이 움직이는 걸 보기

에이전트는 만들고 있는 부분을 `active`로, 지금 손대는 곳을 `current`로 표시합니다. 그 박스는 노란색이 되고, pane에 포커스가 있을 때는 노란 선을 따라 점이 움직입니다. 에이전트가 기능 하나를 위해 새 다이어그램을 만들면 Blueprint가 그 탭으로 넘어갑니다.

<p align="center">
  <img src="docs/media/progress.gif" width="420" alt="Blueprint가 새 POST /logout 다이어그램으로 넘어가고, 노란 박스가 Claude Code의 작업에 따라 하나씩 체크로 바뀝니다.">
  <img src="docs/media/dot.gif" width="420" alt="확대 화면: 계획한 변경의 노란 박스, 고리가 둘린 현재 박스, 노란 점선을 따라 움직이는 점.">
</p>

### 5. 다른 다이어그램 요청

탭 옆의 `+`로 데이터 구조, 엔드포인트 하나의 상세, 프로젝트 전체 같은 다이어그램을 더 요청할 수 있습니다. 도착하면 새 탭으로 열립니다.

<p align="center"><img src="docs/media/new-diagram.gif" width="560" alt="+ 요청 창에 추천 칩이 있고, 'The POST /token flow in detail'을 입력해 보내면 'Drawing…' 표시가 뜬 뒤 'POST /token in detail' 탭이 새로 열립니다."></p>

### 6. 코드에 있는 것만

에이전트에게는 실제로 있는 것만 그리라고 요청합니다. 여기서 Claude Code는 실제 Postgres 테이블 두 개만 원통으로, Redis 키는 일반 상자로 그리고 관계를 선에 적었습니다. DB가 없는 프로젝트라면 없다고 말하고, 그 역할을 하는 것을 실제 이름으로 그립니다.

<p align="center"><img src="docs/media/data-model.png" width="720" alt="users와 clients 테이블은 원통, Redis session, family, code, refresh 키는 일반 상자이고 1:N 선으로 이어져 있습니다."></p>

### 7. 탭바에서 열기

Blueprint pane을 연 상태에서 `herdr-app do blueprint.add-button`을 한 번 실행하면 Files, Changes 옆에 Blueprint 버튼이 생깁니다. 지금 보고 있는 탭을 따라가는 사이드 패널로 열립니다. 다이어그램을 7일 넘게 두려면 고정하세요. `herdr-app do blueprint.remove-button`을 실행하면 버튼을 없애고 원래 쓰던 레이아웃으로 돌아갑니다.

<p align="center"><img src="docs/media/panel.png" width="720" alt="왼쪽에 Claude Code, 오른쪽에 Files, Changes 옆 Blueprint 버튼으로 연 사이드 패널. POST /logout 탭이 고정돼 있습니다."></p>

## 알아 둘 것

- **에이전트.** Claude Code, Codex, Grok, Gemini, OpenCode 등 Herdr가 아는 에이전트. 요청은 `hc send`로 에이전트 터미널에 입력합니다.
- **언어.** Claude Code의 `language` 설정을 따라 영어, 한국어, 일본어 중 하나로 표시합니다.
- **저장 위치.** Herdr 앱 폴더의 `data/blueprint/projects/<이름>-<해시>/`. 다이어그램 하나가 `.mmd` 파일 하나이고, 고정과 연결한 에이전트는 `project.json`에 적힙니다. 프로젝트는 터미널 폴더의 git 최상위 폴더 기준이라 worktree마다 따로입니다.
- **실행하는 것.** 프로젝트를 찾는 `git rev-parse`, 에이전트에게 입력하는 `hc send`, macOS에서 PNG를 만드는 `sips`와 `osascript`. 언어 설정 때문에 `~/.claude/settings.json`을 읽고, 네트워크는 쓰지 않습니다.
- **지원 환경.** 셸, Python, Node 없이 macOS, Linux, Windows에서 돌도록 만들었습니다. 실제로 돌려 본 곳은 macOS(Herdr 0.1.10)뿐이고 Windows와 Linux는 아직 확인하지 못했습니다. PNG 내보내기는 macOS에서만 됩니다.

## 개발

`scripts/sync.sh`는 `mods/blueprint`를 Herdr 앱 폴더로 복사합니다(심볼릭 링크로 연결한 mod는 Herdr가 다시 읽지 않습니다). `--watch`를 붙이면 바뀔 때마다 복사합니다. `scripts/demo/`는 이 페이지의 그림을 실제 세션으로 다시 만듭니다. 따로 띄운 Herdr 창에서 `start.sh`로 시작하고, 조작하는 동안 `record.py`로 녹화한 뒤 `make.py clips.json`을 실행합니다. `RECIPE.md`에는 에이전트가 처음부터 다시 만들 때 쓸 설명이 있습니다.

## 라이선스

MIT
