# 🤖 DiscordBot 개발 및 AI 연동 컨벤션 가이드 (CONVENTIONS.md)

본 문서는 **DiscordBot(방 관리 및 모더레이션 봇)** 프로젝트의 아키텍처, 코드 스타일, 보안 원칙, Git 커밋 규칙 및 AI 어시스턴트(Copilot, ChatGPT, Claude, Antigravity 등)와의 협업을 위한 표준 가이드라인입니다.

---

## 1. 프로젝트 개요 및 핵심 원칙

* **프로젝트명**: DiscordBot
* **주요 목적**: 디스코드 서버의 임시 음성 채널 자동 생성/삭제(Join-to-Create), 채널 모더레이션(메시지 정리, 잠금, 슬로우 모드), 멤버 입장/퇴장 환영 및 자동 역할 부여.
* **핵심 철학**:
  1. **모듈화 (Modularity)**: 새 명령어와 이벤트는 기존 코드를 수정하지 않고 파일 추가만으로 동작하도록 핸들러 기반 동적 로딩을 유지합니다.
  2. **안전성 (Fault Tolerance)**: 개별 명령어 또는 이벤트 실패가 전체 봇 프로세스 다운으로 이어지지 않도록 철저한 예외 처리를 수행합니다.
  3. **보안 우선 (Security First)**: 봇 토큰 및 민감한 인증 정보는 어떤 경우에도 소스 코드에 하드코딩하거나 Git에 커밋하지 않습니다.

---

## 2. 기술 스택 및 런타임 제약

* **Runtime**: Node.js v18 이상 권장 (ES Modules `"type": "module"` 필수)
* **Core Library**: `discord.js` v14.x
* **Config Loader**: `dotenv`
* **Package Manager**: `npm`

---

## 3. 디렉토리 구조 및 역할 정의

```
DiscordBot/
├── .env                      # [보안] 로컬 환경 변수 (Git 추적 제외)
├── .env.example              # 환경 변수 템플릿
├── .gitignore                # Git 무시 파일 목록
├── package.json              # 패키지 명세 (ESM 설정 및 스크립트)
├── README.md                 # 사용자 안내 및 설정 문서
├── CONVENTIONS.md            # 본 컨벤션 문서
├── data/                     # [런타임] 서버별 설정 및 멤버 이력 JSON (Git 추적 제외, .gitkeep만 커밋)
└── src/
    ├── index.js              # 애플리케이션 진입점 및 클라이언트 생성
    ├── config.js             # 환경 변수 유효성 검증 및 중앙 제공
    ├── core/                 # 봇 뼈대: commands/events 자동 로더, 명령어 등급(permissions)
    ├── commands/             # 슬래시 명령어 (카테고리별 디렉토리 분리)
    │   ├── general/          # 모든 멤버용 유틸리티 (/도움말, /핑, /유저정보)
    │   ├── server/           # 서버 설정 (/채널연결, /알림문구, /테스트, /백업)
    │   ├── moderation/       # 채널 모더레이션 (/채널관리)
    │   ├── roles/            # 역할 자동화 (/자동역할, /이모지역할)
    │   └── voice/            # 임시 음성방 (/음성방, /음성방설정)
    ├── events/               # Discord Gateway 이벤트 핸들러 (분류별 폴더: client, guildMember, interaction, message, voice)
    ├── stores/               # data/ JSON 영속화 (상태 저장소, Discord API 호출 없음)
    ├── services/             # 명령어와 이벤트가 공유하는 기능별 비즈니스 로직
    └── utils/                # 상태 없는 순수 헬퍼 (템플릿 치환, 시간 표기)
```

**레이어 의존 방향**: `commands` / `events` → `services` → `stores` → `utils`
* 명령어 파일끼리, 또는 명령어가 이벤트 파일을 import 하지 않습니다. 둘이 공유하는 로직은 `services/` 로 옮깁니다.
* `stores/` 는 데이터 저장만 담당하고 Discord API 를 호출하지 않습니다. 저장은 반드시 `JsonStore` 를 사용해 원자적으로 처리합니다.
* 채널/역할 ID 설정은 `null` = 미설정(.env 폴백), `DISABLED`(`false`) = 명시적 비활성화로 구분하며, 값을 읽을 때는 `settingsManager.resolveId()` 를 사용합니다.

---

## 4. 코드 스타일 및 작성 표준

### 4.1. 모듈 시스템 (ES Modules)
* 항상 `import` / `export` 구문을 사용합니다. `require()` 및 `module.exports`는 사용하지 않습니다.
* 로컬 파일 import 시 반드시 `.js` 확장자를 명시합니다.
  ```javascript
  // Good
  import { config } from '../config.js';
  import { tempVoiceManager } from '../../stores/tempVoiceManager.js';

  // Bad
  const { config } = require('../config');
  ```

### 4.2. 명명 규칙 (Naming Conventions)
* **변수 및 함수**: `camelCase` (예: `loadCommands`, `newVoiceChannel`)
* **상수**: 불변 전역 상수는 `UPPER_SNAKE_CASE` (예: `MAX_CLEAR_COUNT`)
* **클래스**: `PascalCase` (예: `TempVoiceManager`)
* **슬래시 명령어 및 옵션 이름**: 한글로 작성 (예: `/채널연결 입장알림 <채널>`, 옵션 `문구`). 공백 없이 최대 32자. 파일 이름은 영문 `camelCase` 유지 (예: `channelLink.js`)
* **파일 이름**: 
  * 명령어 및 유틸리티: `camelCase.js` (예: `tempVoiceManager.js`, `slowmode.js`)
  * 이벤트 핸들러: 디스코드 이벤트명과 동일하게 작성 (예: `guildMember/guildMemberAdd.js`). 한 이벤트를 여러 기능이 처리하면 `<이벤트>.<기능>.js` (예: `client/clientReady.commands.js`)

### 4.3. Discord.js v14 표준 및 열거형(Enum) 사용
* 문자열 리터럴 대신 `discord.js`에서 제공하는 Enum 객체를 우선 사용합니다.
  ```javascript
  // Good
  import { Events, ChannelType, PermissionFlagsBits } from 'discord.js';
  name: Events.ClientReady
  type: ChannelType.GuildVoice
  setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

  // Bad (하드코딩 문자열/정수)
  name: 'ready'
  type: 2
  ```

### 4.4. 슬래시 명령어 작성 규칙
모든 명령어 파일은 `src/commands/<category>/` 경로에 위치하며 아래 구조를 준수해야 합니다.
모든 명령어는 `tier` 로 등급을 명시합니다 (`CommandTier.ADMIN`: 관리자 전용, `CommandTier.EVERYONE`: 모든 멤버).
관리자 전용 명령어는 `setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)` 으로 기본 권한을 통일하고, 실행 전 `interactionCreate` 에서 한 번 더 검사됩니다.

```javascript
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';

export default {
  tier: CommandTier.ADMIN, // 관리자 전용. 모든 멤버용이면 CommandTier.EVERYONE
  data: new SlashCommandBuilder()
    .setName('명령어이름') // 한글 명령어 이름 (공백 없이 최대 32자, 예: '채널연결')
    .setDescription('명령어에 대한 명확한 한글 설명')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION), // 관리자 전용 명령어만 지정

  async execute(interaction) {
    // 1. 사전 조건 검증 (채널 종류, 권한 등)
    if (!interaction.channel || !interaction.channel.isTextBased()) {
      return interaction.reply({
        content: '❌ 텍스트 채널에서만 사용할 수 있습니다.',
        ephemeral: true,
      });
    }

    // 2. 3초 이상 소요될 가능성이 있는 작업은 deferReply 활용
    // await interaction.deferReply({ ephemeral: true });

    try {
      // 3. 비즈니스 로직 수행
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setDescription('작업 완료 안내');

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error(`[Command:${interaction.commandName}] 에러:`, error);
      const errorMsg = { content: '❌ 처리 중 오류가 발생했습니다.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMsg).catch(() => {});
      } else {
        await interaction.reply(errorMsg).catch(() => {});
      }
    }
  },
};
```

### 4.5. 이벤트 핸들러 작성 규칙
모든 이벤트 파일은 `src/events/<분류>/` 경로에 위치하며 아래 구조를 준수합니다.
분류 폴더는 이벤트 이름의 앞부분을 따릅니다 (`client`, `guildMember`, `interaction`, `message`, `voice`, 새 분류가 필요하면 같은 방식으로 추가).
한 이벤트를 여러 기능이 처리하면 `<이벤트>.<기능>.js` 로 나눕니다 (예: `voice/voiceStateUpdate.tempVoice.js`). 로더가 하위 폴더까지 읽고, 각 핸들러의 예외를 격리합니다:

```javascript
import { Events } from 'discord.js';

export default {
  name: Events.GuildMemberAdd,
  once: false, // 1회성(ready 등)일 경우 true
  async execute(...args) {
    // 비즈니스 로직
  },
};
```

---

## 5. 보안 및 환경 변수 관리

1. **`.env` 파일 격리**:
   - `DISCORD_TOKEN`, `CLIENT_ID`, 서버/채널 ID 등은 오직 `.env`를 통해 주입받습니다.
   - 새 환경 변수 추가 시 반드시 `.env.example`에도 설명을 포함해 동일한 키를 등록해야 합니다.
2. **권한 최소화 (Least Privilege)**:
   - 일반 유저에게 노출되어서는 안 되는 모더레이션 명령어는 반드시 `setDefaultMemberPermissions`를 명시합니다.
   - 개인 음성 채널 권한 설정 시 `@everyone`과 방장의 권한(`PermissionFlagsBits`)을 명확히 분리합니다.

---

## 6. Git 커밋 및 브랜치 컨벤션

### 6.1. 커밋 메시지 형식 (Conventional Commits)
```
<type>: <설명>

[선택적 본문]
```

### 6.2. Type 접두사 목록
* `feat`: 새로운 기능 추가 (예: `feat: 티켓 상담 채널 생성 기능 추가`)
* `fix`: 버그 수정 (예: `fix: 빈 음성 채널 자동 삭제 누락 오류 해결`)
* `docs`: 문서 수정 (README.md, CONVENTIONS.md 등)
* `style`: 코드 포맷팅, 세미콜론 누락 등 (코드 동작 변경 없음)
* `refactor`: 코드 리팩토링 (기능 추가나 버그 수정이 없는 구조 개선)
* `chore`: 빌드 설정, 패키지 매니저 설정 변경, 의존성 업데이트 등

---

## 7. AI 어시스턴트(AI Agents) 지침

AI 어시스턴트가 본 레포지토리의 코드를 생성, 수정, 리팩토링할 때는 다음 수칙을 엄격히 준수해야 합니다:

1. **기존 주석 및 도큐멘테이션 보존**:
   - 수정한 파일 내에 작성되어 있는 한글 주석, JSDoc, 설명 문구를 임의로 삭제하거나 번역하지 않고 온전히 보존합니다.
2. **동적 로더 호환성 유지**:
   - 새 명령어나 이벤트를 만들 때 `src/index.js`에 수동으로 import하지 마십시오. 규정된 디렉토리(`src/commands/<카테고리>/` 또는 `src/events/<분류>/`)에 단일 파일을 생성하면 로더가 자동 인식합니다.
3. **사용자 친화적 임베드 UI 유지**:
   - 봇의 응답은 텍스트 한 줄보다는 상태에 맞는 색상(성공: 초록 `0x57F287`, 경고: 노랑 `0xFEE75C`, 오류: 빨강 `0xED4245`, 안내: 디스코드 블루 `0x5865F2`)의 `EmbedBuilder`를 활용합니다.
4. **Discord API 레이트 리밋(Rate Limit) 고려**:
   - 대량 메시지 삭제는 `bulkDelete` (최대 100개, 14일 이내)를 사용하고, API 호출 반복문 사용 시 적절한 딜레이 또는 일괄 처리를 고려합니다.
