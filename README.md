# 🤖 디스코드 방 관리 봇 (Discord Management Bot)

디스코드 서버의 **임시 음성 채널(Join-to-Create) 자동 생성 및 삭제**, **채널 정리 및 모더레이션**, **신규 멤버 환영/퇴장 알림 및 자동 역할 부여**를 담당하는 올인원 방 관리 봇입니다.

---

## 🌟 주요 기능

### 1. 🔊 임시 음성 채널 자동 생성 (Join-to-Create)
- **간편 설정 (관리자)**:
  - `/autovoice setup` : 전용 카테고리와 "➕ 방 만들기" 채널을 봇이 **원클릭으로 자동 생성 및 연결**
  - `/autovoice channel <채널>` : 기존 음성 채널을 방 생성 트리거로 지정
  - `/autovoice name <서식>` : 자동 생성될 방 이름 템플릿 변경 (예: `🔊 {userName}의 통화방`)
  - `/autovoice view` / `/autovoice disable` : 설정 조회 및 기능 비활성화
- 유저가 생성용 채널에 접속하면 **새로운 개인 음성 채널을 즉시 생성**하고 해당 유저를 이동시킵니다.
- **방 관리 (방장)**:
  - `/voice name <이름>` : 채널 이름 변경
  - `/voice limit <인원수>` : 최대 접속 인원수 설정 (0: 무제한)
  - `/voice lock` : 방 잠금 (다른 멤버의 무단 입장 방지)
  - `/voice unlock` : 방 잠금 해제
- **채널의 마지막 멤버가 퇴장하면 채널이 자동으로 삭제**되어 서버 목록이 깔끔하게 유지됩니다.

### 2. 🛡️ 채널 정리 및 모더레이션
- `/clear <개수> [유저]` : 현재 채널의 최근 메시지를 최대 100개까지 일괄 정리 (특정 유저 메시지만 골라 삭제 가능)
- `/lock [사유]` : 현재 채널을 잠가 일반 유저가 메시지를 보낼 수 없도록 차단
- `/unlock` : 잠긴 채널을 해제하여 다시 대화 활성화
- `/slowmode <초>` : 채팅 도배 방지를 위한 슬로우 모드 설정 (0초는 해제)

### 3. 👋 멤버 입장 / 퇴장 채널 등록 및 메시지 커스텀
- `/welcome channel <채널>` : 입장(환영) 알림을 전송할 텍스트 채널을 지정
- `/welcome message <문구>` : 환영 메시지 템플릿 커스텀 (변수 지원: `{user}`, `{userName}`, `{userTag}`, `{userId}`, `{server}`, `{count}`, `{joinedAt}`, `{joinedAtRelative}`, `{createdAt}`, `{accountAge}`, `{joinCount}`, `{isRejoin}`)
- `/welcome view` / `/welcome test` / `/welcome disable` : 입장 알림 설정 조회, 테스트 전송, 비활성화
- `/leave channel <채널>` : 퇴장 알림을 전송할 텍스트 채널을 지정
- `/leave message <문구>` : 퇴장 메시지 템플릿 커스텀 (입장 메시지와 동일한 변수 지원)
- `/leave view` / `/leave test` / `/leave disable` : 퇴장 알림 설정 조회, 테스트 전송, 비활성화
- **재입장(들낙) 멤버 자동 감지**: 서버별 멤버 입장/퇴장 이력을 기록하여 재입장 시 알림의 제목과 색상을 구분해 표시 (`{joinCount}`, `{isRejoin}` 변수로 메시지에도 활용 가능)
- 신규 멤버 입장 시 기본 역할(예: `멤버`, `일반유저` 등) 자동 지급 (`AUTO_ROLE_ID` 설정 시)

### 4. 💾 설정 및 멤버 이력 백업 / 복원
- 봇은 설정과 멤버 입장 이력을 `data/` 폴더의 JSON 파일에 **자동 저장**합니다. 아래 명령어는 호스팅 장애나 인스턴스 삭제에 대비한 **수동 백업**용입니다.
- `/backup export` : 현재 서버의 설정(임시 음성 채널, 환영/퇴장 채널 ID 및 문구), 멤버 입장/퇴장 이력, 활동 기록(포인트·활동일 등)을 JSON 파일로 내려받기 (관리자 전용, 본인에게만 표시)
- `/backup import <파일> [모드] [force]` : 내려받은 백업 파일을 업로드해 복원
  - 모드 `병합`(기본): 기존 이력과 합치고 입장 횟수는 더 큰 값을 유지
  - 모드 `전체 교체`: 현재 이력을 지우고 백업 내용으로 덮어쓰기
  - 다른 서버에서 만든 백업은 `force` 옵션을 켜야 적용되며, 현재 서버에 없는 채널 ID는 복원 후 안내됩니다.
- ⚠️ 백업 파일에는 채널 ID와 멤버 ID, 입장 이력이 포함되므로 외부에 공유하지 마세요.

### 5. 📊 유저 정보 및 활동 포인트
- `/userinfo [유저]` : 유저의 기본 정보와 서버 활동을 한눈에 확인 (유저를 비워두면 본인)
  - 기본 정보: 이름(닉네임), 유저명, ID, 계정 생성일, 부스트 여부
  - 서버 기록: 서버 입장일, 함께한 기간, 입장 횟수(재입장 여부), 마지막 퇴장 시각
  - 활동: 포인트, 활동일 수, 메시지 수, 음성 채널 체류 시간, 마지막 활동 시각
  - 역할 목록
- 활동은 봇이 켜져 있는 동안 자동으로 집계되어 `data/activity.json`에 저장됩니다. (메시지 내용은 저장하지 않으며 `MESSAGE CONTENT INTENT`가 필요하지 않습니다.)
- 포인트 규칙 (`src/utils/activityManager.js` 상단 상수로 조정 가능):
  - 메시지 1개 = **1점** (60초 쿨다운, 도배 방지)
  - 음성 채널 1분 = **1점** (서버 AFK 채널 제외)
  - 활동일 = 메시지 또는 음성 활동이 있었던 날짜 수 (한국 시간 기준)

### 6. ⚙️ 유틸리티
- `/ping` : 봇 응답 속도(레이턴시) 및 웹소켓 핑 측정
- `/help` : 명령어 및 기능 안내서 확인

---

## 🛠️ 사전 준비 (디스코드 개발자 포털 설정)

봇을 구동하기 위해 디스코드 개발자 포털에서 봇을 등록해야 합니다.

### 1. 봇 생성 및 토큰 발급
1. [Discord Developer Portal](https://discord.com/developers/applications)에 접속하여 로그인합니다.
2. 우측 상단 **New Application** 클릭 후 이름을 지정하고 생성합니다.
3. 좌측 메뉴 **Bot** 클릭:
   - **Reset Token**을 눌러 봇 토큰을 복사합니다. (이 토큰이 `.env`의 `DISCORD_TOKEN`이 됩니다.)
   - ⚠️ **중요 (권한 허용)**: 스크롤을 내려 **Privileged Gateway Intents** 섹션에서 **SERVER MEMBERS INTENT** 스위치를 반드시 **ON**으로 켭니다. (환영 메시지 및 자동 역할을 위해 필수입니다.)

### 2. 애플리케이션 ID 확인
- 좌측 메뉴 **General Information**에서 **Application ID**를 복사합니다. (`.env`의 `CLIENT_ID`)

### 3. 디스코드에서 채널/서버/역할 ID 확인하는 법
1. 디스코드 앱 실행 -> **사용자 설정 (⚙️)** -> **고급** -> **개발자 모드**를 켭니다.
2. 이제 서버 이름, 텍스트 채널, 음성 채널, 역할을 **마우스 우클릭**하면 맨 아래에 **[ID 복사]** 버튼이 나타납니다.

### 4. 봇 서버에 초대하기
1. 좌측 메뉴 **OAuth2** -> **URL Generator** 클릭
2. **SCOPES**:
   - `bot`
   - `applications.commands` (슬래시 명령어 사용을 위해 필수)
3. **BOT PERMISSIONS**:
   - `Administrator` (가장 편리함) 또는 아래 권한 체크:
     - `Manage Channels` (채널 관리)
     - `Manage Roles` (역할 관리)
     - `Manage Messages` (메시지 관리)
     - `Move Members` (음성 채널 멤버 이동)
     - `Connect`, `Speak` (음성 접속/발언)
     - `Send Messages`, `Embed Links`, `Read Message History`
4. 하단에 생성된 URL을 복사하여 웹 브라우저 주소창에 넣고 자신의 서버에 초대합니다.

---

## ⚙️ 설정 파일 (.env) 작성

프로젝트 루트 폴더의 `.env` 파일을 열고 복사한 ID 값들을 입력합니다:

```env
# 필수 항목
DISCORD_TOKEN=여기에_봇_토큰_입력
CLIENT_ID=여기에_애플리케이션_ID_입력

# 개발/테스트용 서버 ID (입력 시 해당 서버에 슬래시 명령어가 즉시 동기화됩니다)
GUILD_ID=123456789012345678

# [기능 1] 개인 음성방 자동 생성용 트리거 채널 ID
# (음성 채널을 만들고 '🔊 개인방 생성' 등으로 이름 붙인 후 우클릭하여 ID 복사)
JOIN_TO_CREATE_CHANNEL_ID=

# [기능 2] 입장 및 퇴장 알림 채널 ID
WELCOME_CHANNEL_ID=
LEAVE_CHANNEL_ID=

# [기능 3] 신규 멤버 자동 지급 역할 ID (선택 사항)
# ⚠️ 봇의 역할 순위가 지급할 역할보다 위에 있어야 정상 작동합니다.
AUTO_ROLE_ID=
```

---

## 🚀 봇 실행 방법

### 일반 실행
```bash
npm start
```

### 개발 모드 (코드 수정 시 자동 재시작)
```bash
npm run dev
```

---

## 📂 프로젝트 구조

```
DiscordBot/
├── .env.example              # 환경 변수 예시 템플릿
├── .env                      # 실제 봇 토큰 및 설정 파일 (Git 커밋 제외)
├── .gitignore
├── index.js                  # 호스팅 호환용 진입점 (src/index.js 로드)
├── package.json              # 프로젝트 의존성 및 실행 스크립트
├── README.md                 # 프로젝트 설명서
├── CONVENTIONS.md            # 개발 표준 및 AI 연동 컨벤션 가이드
├── data/                     # 런타임 JSON 데이터 (Git 커밋 제외)
│   ├── guildSettings.json    # 서버별 설정 (자동 생성 채널, 환영/퇴장 채널 및 문구)
│   ├── memberHistory.json    # 서버별 멤버 입장/퇴장 이력 (들낙 카운트)
│   └── activity.json         # 서버별 유저 활동 (포인트, 활동일, 메시지 수, 음성 시간)
└── src/
    ├── index.js              # 봇 진입점 (Intents 및 클라이언트 시작)
    ├── config.js             # 환경 변수 로더
    ├── commands/             # 슬래시 명령어 폴더
    │   ├── general/
    │   │   ├── help.js       # 도움말
    │   │   ├── ping.js       # 핑 측정
    │   │   └── userinfo.js   # 유저 정보 및 활동 조회
    │   ├── moderation/
    │   │   ├── autovoice.js  # 임시 음성 채널(Join-to-Create) 설정
    │   │   ├── backup.js     # 서버 설정 및 멤버 이력 백업/복원
    │   │   ├── clear.js      # 메시지 일괄 삭제
    │   │   ├── leave.js      # 퇴장 알림 채널 및 메시지 설정
    │   │   ├── lock.js       # 채널 잠금
    │   │   ├── slowmode.js   # 슬로우 모드
    │   │   ├── unlock.js     # 채널 잠금 해제
    │   │   └── welcome.js    # 입장(환영) 알림 채널 및 메시지 설정
    │   └── voice/
    │       └── voice.js      # 임시 음성 채널 제어 (이름, 인원수, 잠금)
    ├── events/               # 디스코드 이벤트 핸들러
    │   ├── ready.js          # 봇 로그인 및 슬래시 커맨드 자동 등록
    │   ├── activityBootstrap.js # 봇 시작 시 접속 중인 음성 세션 추적 시작
    │   ├── interactionCreate.js # 슬래시 커맨드 수신 및 라우팅
    │   ├── messageCreate.js     # 메시지 활동 기록 (포인트/활동일)
    │   ├── voiceStateUpdate.js  # 임시 음성 채널 생성 및 자동 삭제
    │   ├── voiceActivityTracker.js # 음성 채널 체류 시간 기록
    │   ├── guildMemberAdd.js    # 신규 멤버 환영 & 자동 역할 지급 & 입장 이력 기록
    │   └── guildMemberRemove.js # 멤버 퇴장 알림 & 퇴장 이력 기록
    ├── handlers/             # 동적 로더
    │   ├── commandHandler.js # 명령어 로더
    │   └── eventHandler.js   # 이벤트 로더
    └── utils/
        ├── activityManager.js     # 유저 활동(포인트, 활동일, 메시지, 음성 시간) 집계 및 저장
        ├── backupManager.js       # 백업 파일 생성/검증/적용 로직
        ├── settingsManager.js     # 서버별 설정 저장/조회 및 메시지 템플릿 변수 치환
        ├── memberHistoryManager.js # 멤버 입장/퇴장 이력(들낙 카운트) 관리
        └── tempVoiceManager.js    # 임시 음성 채널 추적 관리 모듈
```
