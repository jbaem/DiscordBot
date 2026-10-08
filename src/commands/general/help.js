import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { CommandTier, TIER_LABEL, ADMIN_DEFAULT_PERMISSION, isAdmin } from '../../core/permissions.js';
import { settingsManager } from '../../stores/settingsManager.js';
import { resolveAutoRoleId, getReactionRoles, mappingDisplay } from '../../services/roleManager.js';

/** 임베드 칸 하나의 최대 길이 */
const FIELD_MAX = 1024;

/** 관리자 등급으로 판정되는 권한(관리자 / 서버 관리)이 있는 역할인지 */
function isAdminRole(role) {
  return role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(ADMIN_DEFAULT_PERMISSION);
}

/**
 * 역할 안내 (서버 설정에서 매번 새로 만듦)
 * - 자동 역할: 입장 시 자동 부여되는 기본 멤버 역할
 * - 이모지 역할: /역할 추가 로 등록한 역할과 설명, 패널 채널 안내
 * - 관리자 역할은 표시하지 않음 (관리자 권한이 있는 역할이 자동/이모지 역할로 지정되어 있어도 제외)
 * @param {import('discord.js').Guild} guild
 */
function renderRoleGuide(guild) {
  if (!guild) return '서버 안에서만 확인할 수 있습니다.';
  const lines = [];

  const autoRole = guild.roles.cache.get(resolveAutoRoleId(guild.id));
  if (autoRole && !isAdminRole(autoRole)) lines.push(`👤 ${autoRole} : 기본 멤버 역할 (입장 시 자동 부여)`);

  for (const mapping of getReactionRoles(guild.id)) {
    const role = guild.roles.cache.get(mapping.roleId);
    if (!role || isAdminRole(role)) continue;
    lines.push(`${mappingDisplay(mapping)} ${role} : ${mapping.description ? `${mapping.description} · ` : ''}역할 패널에서 직접 받기`);
  }

  if (!lines.length) return '안내할 역할이 없습니다.';

  const panelChannelId = settingsManager.resolveId(settingsManager.getGuildSettings(guild.id), 'rolePanelChannelId');
  const footer = panelChannelId ? `※ 이모지 역할은 <#${panelChannelId}> 패널에서 이모지를 눌러 받고, 다시 눌러 해제합니다.` : null;

  // 칸 길이 제한을 넘으면 뒤쪽 역할을 줄여서 표시
  const reserved = footer ? footer.length + 1 : 0;
  const shown = [];
  for (const [i, line] of lines.entries()) {
    const rest = lines.length - i - 1;
    const moreLine = rest ? `… 외 ${rest}개` : '';
    if ([...shown, line, moreLine].join('\n').length + reserved > FIELD_MAX) {
      shown.push(`… 외 ${lines.length - i}개`);
      break;
    }
    shown.push(line);
  }
  if (footer) shown.push(footer);
  return shown.join('\n');
}

/**
 * 도움말 섹션(분류) 정의
 * - key: `/도움말 분류:<key>` 로 이 섹션만 볼 때 쓰는 분류 이름
 * - tier 가 EVERYONE 인 섹션은 모든 멤버에게, ADMIN 인 섹션은 관리자 등급 멤버에게만 표시된다.
 *   (분류 자동완성 목록과 `/도움말 전체` 모두 사용자 등급에 맞는 섹션만 보여 준다)
 * - 등급이 바뀌는 지점에 구분 헤더가 들어가므로 같은 등급끼리 모아 나열한다.
 * - commands: 명령어별로 묶어 적는다. 명령어 이름은 제목으로 한 번만 쓰고 아래에 서브커맨드만 나열한다.
 *   - name: 명령어 (예: '/문구')
 *   - description: 옵션 없이 실행할 때의 설명 (있으면 제목 옆에 표시)
 *   - items: [서브커맨드·옵션, 설명] 목록
 *   - note: 이 명령어 전체에 해당하는 안내 (※ 로 표시)
 * - notes: 섹션 끝에 붙는 안내
 * - render(guild) (선택): commands 대신 서버 설정으로 매번 내용을 만드는 섹션 (예: 역할 안내)
 */
const SECTION_DEFS = [
  // ───────────── 👥 모든 멤버 ─────────────
  {
    key: '정보',
    tier: CommandTier.EVERYONE,
    name: '📊 유저 정보 / 도움말',
    commands: [
      {
        name: '/정보',
        description: '내 정보 확인, 본인에게만 표시',
        items: [['<유저>', '다른 유저의 정보 조회 (관리자 전용, 관리자 본인에게만 표시)']],
      },
      {
        name: '/도움말',
        description: '볼 수 있는 전체 도움말 확인',
        items: [['분류:<이름>', '해당 분류만 표시 (볼 수 있는 분류는 권한에 따라 다름)']],
      },
    ],
  },

  {
    key: '게임',
    tier: CommandTier.EVERYONE,
    name: '🎮 게임랜드',
    commands: [
      {
        name: '/게임',
        items: [
          ['등록', '게임랜드 등록, 시작 포인트 1번 받기'],
          ['가위바위보 <베팅> [상대]', '상대를 비우면 봇과, 지정하면 멤버와 대결'],
          ['포인트 [유저]', '포인트·전적 확인 (본인에게만 표시)'],
          ['순위', '포인트 순위'],
        ],
        note: '등록·게임은 게임랜드 채널에서만, 메시지·음성 활동으로 포인트 자동 적립 (하루 한도 있음)',
      },
    ],
  },

  {
    key: '역할안내',
    tier: CommandTier.EVERYONE,
    name: '📜 역할 안내',
    // 서버마다 등록된 역할이 다르므로 /도움말 실행 시점에 만듦
    render: renderRoleGuide,
  },

  // ───────────── 👑 관리자 전용 ─────────────
  {
    key: '채널연결',
    tier: CommandTier.ADMIN,
    name: '🔗 채널 연결',
    commands: [
      {
        name: '/연결 채널',
        items: [
          ['입장알림 <채널>', '입장 알림 채널 연결'],
          ['퇴장알림 <채널>', '퇴장 알림 채널 연결'],
          ['닉네임로그 <채널>', '닉네임 변경 로그 채널 연결'],
          ['음성생성 <채널>', '임시 음성방 생성 채널 연결'],
          ['역할패널 <채널>', '이모지 역할 패널 채널 연결'],
          ['게임랜드 <채널>', '게임랜드 채널 연결 (게임은 이 채널에서만)'],
          ['백업 <채널>', '자동 백업 채널 연결 (비공개 채널 권장)'],
          ['확인', '연결 상태 확인'],
          ['해제 <기능>', '연결 해제(비활성화)'],
        ],
      },
    ],
  },
  {
    key: '관리',
    tier: CommandTier.ADMIN,
    name: '🛡️ 서버 관리',
    commands: [
      {
        name: '/관리 채널',
        items: [
          ['잠금', '현재 채널 잠금'],
          ['잠금해제', '현재 채널 잠금 해제'],
        ],
      },
      {
        name: '/관리 역할',
        items: [
          ['부여 <역할> <유저> [유저2~5]', '지정한 유저에게 역할 부여 (최대 5명)'],
          ['회수 <역할> <유저> [유저2~5]', '지정한 유저에게서 역할 회수 (최대 5명)'],
        ],
        note: '역할 관리 권한이 있고, 내 최상위 역할보다 낮은 역할만 다룰 수 있음',
      },
      {
        name: '/관리 포인트',
        items: [
          ['지급 <유저> <금액> [사유]', '게임 포인트 지급'],
          ['회수 <유저> <금액> [사유]', '게임 포인트 회수 (잔액보다 많으면 0P)'],
        ],
      },
    ],
  },
  {
    key: '알림',
    tier: CommandTier.ADMIN,
    name: '👋 입장 / 퇴장 알림',
    commands: [
      {
        name: '/문구',
        items: [
          ['입장 [문구]', '입장 알림 문구 설정'],
          ['퇴장 [문구]', '퇴장 알림 문구 설정'],
        ],
        note: '비우면 현재 문구와 미리보기 확인',
      },
      {
        name: '/테스트',
        items: [
          ['입장알림', '연결된 채널로 입장 알림 테스트 전송'],
          ['퇴장알림', '연결된 채널로 퇴장 알림 테스트 전송'],
        ],
      },
    ],
    notes: [
      '문구 변수: {user}, {userName}, {userTag}, {userId}, {server}, {count}, {joinedAt}, {joinedAtRelative}, {createdAt}, {accountAge}, {joinCount}, {isRejoin}',
      '재입장(들낙) 자동 감지 : 재입장 시 알림 제목과 색상을 구분 표시',
    ],
  },
  {
    key: '음성방',
    tier: CommandTier.ADMIN,
    name: '🔊 임시 음성방 (Join-to-Create)',
    commands: [
      {
        name: '/문구',
        items: [['음성방서식 [서식]', '생성될 방의 이름 서식 변경 (비우면 현재 서식 확인)']],
      },
    ],
    notes: [
      '방 이름 변경 : 누구나 디스코드 채널 설정에서 직접 변경 (명령어 없음)',
      '`/연결 채널 음성생성` 으로 연결한 생성 채널에 접속하면 개인 통화방이 자동 생성되고, 모두 나가면 자동 삭제됩니다.',
    ],
  },
  {
    key: '역할',
    tier: CommandTier.ADMIN,
    name: '🎭 역할 자동화',
    commands: [
      {
        name: '/자동역할',
        items: [
          ['설정 [이름]', '구성원 역할을 만들어 자동 역할로 지정하고 기존 멤버 전체에 부여 (기본 이름: 포켓몬)'],
          ['지정 <역할>', '기존 역할을 자동 역할로 지정'],
          ['일괄적용', '기존 멤버에게 자동 역할 일괄 부여'],
          ['확인', '자동 역할 확인'],
          ['해제', '자동 역할 비활성화'],
        ],
      },
      {
        name: '/역할',
        items: [
          ['추가 <역할> <이모지> [설명]', '이모지를 누르면 받는 역할 등록 (예: 🎲 → 겜블러)'],
          ['패널 [제목] [설명]', '패널 채널에 역할 패널 게시 또는 갱신 (반응 추가 = 부여, 해제 = 제거)'],
          ['목록', '등록된 이모지 역할과 패널 확인'],
          ['제거 <역할>', '이모지 역할 등록 해제'],
          ['갱신', '패널을 현재 목록으로 갱신'],
        ],
        note: '추가·제거하면 패널이 자동 갱신되고, 패널은 `/연결 채널 역할패널` 채널에 1개만 유지',
      },
    ],
  },
  {
    key: '백업',
    tier: CommandTier.ADMIN,
    name: '💾 백업 / 기타',
    commands: [
      {
        name: '/백업',
        items: [
          ['내보내기', '서버 설정과 멤버 이력, 활동 기록을 봇 서버의 backups/ 폴더에 저장하고 파일로도 내려받기'],
          ['미리보기', '내보내기 될 내용을 파일을 만들지 않고 미리 확인'],
          ['불러오기 [백업] [파일] [모드] [강제]', '비워두면 가장 최근 로컬 백업으로 복원 (복원 직전 상태는 자동 백업)'],
          ['목록', '저장된 로컬 백업 확인'],
        ],
      },
      { name: '/핑', description: '봇의 응답 속도 확인' },
    ],
  },
];

/**
 * 섹션 정의 → 임베드 칸에 들어갈 문자열
 * (명령어 이름은 제목 줄에 한 번만, 아래에는 서브커맨드·옵션만 나열)
 */
function renderSection(section) {
  const lines = [];
  for (const command of section.commands) {
    lines.push(`**\`${command.name}\`**${command.description ? ` : ${command.description}` : ''}`);
    for (const [usage, text] of command.items ?? []) {
      lines.push(`• \`${usage}\` : ${text}`);
    }
    if (command.note) lines.push(`　※ ${command.note}`);
  }
  for (const note of section.notes ?? []) {
    lines.push(`※ ${note}`);
  }
  return lines.join('\n');
}

const HELP_SECTIONS = SECTION_DEFS.map(section =>
  section.render ? section : { ...section, value: renderSection(section) }
);

/** 전체 보기를 뜻하는 분류 값 (`/도움말` 을 옵션 없이 실행해도 전체 보기) */
const ALL_CATEGORY = '전체';

/** 디스코드 임베드 제한 (칸 25개, 임베드 1개당 6000자, 메시지당 임베드 10개) */
const EMBED_LIMITS = { fields: 25, chars: 5800, embeds: 10 };

/** 인터랙션을 보낸 멤버가 볼 수 있는 섹션 목록 */
function visibleSectionsFor(interaction) {
  const admin = isAdmin(interaction);
  return HELP_SECTIONS
    .filter(s => admin || s.tier === CommandTier.EVERYONE)
    .map(s => (s.render ? { ...s, value: s.render(interaction.guild) } : s));
}

/**
 * 입력한 분류에 해당하는 섹션 찾기 (볼 수 있는 섹션 안에서만)
 * - 자동완성 목록에서 고르면 key 가 그대로 들어오고, 직접 입력하면 이름 일부로도 찾는다.
 */
function findSection(sections, input) {
  const q = input.trim();
  return sections.find(s => s.key === q) ?? sections.find(s => s.name.includes(q) || s.key.includes(q)) ?? null;
}

/** 분류 목록 안내 문구 (예: `정보`, `채널연결`, …) */
function categoryList(sections) {
  return sections.map(s => `\`${s.key}\``).join(', ');
}

/**
 * 필드 목록을 디스코드 제한에 맞춰 여러 임베드로 나눈다.
 * (분류가 많아져 한 임베드에 다 들어가지 않을 때를 대비)
 */
export function packEmbeds(fields, { title, description, footer }) {
  const embeds = [];
  let current = null;
  let chars = 0;
  const start = () => {
    current = new EmbedBuilder().setColor(0x5865F2);
    chars = 0;
    if (embeds.length === 0) {
      current.setTitle(title).setDescription(description);
      chars += title.length + description.length;
    }
    embeds.push(current);
  };

  start();
  for (const field of fields) {
    const size = field.name.length + field.value.length;
    const count = current.data.fields?.length ?? 0;
    if (count >= EMBED_LIMITS.fields || chars + size > EMBED_LIMITS.chars) start();
    current.addFields(field);
    chars += size;
  }

  const result = embeds.slice(0, EMBED_LIMITS.embeds);
  result[result.length - 1].setFooter({ text: footer }).setTimestamp();
  return result;
}

export default {
  tier: CommandTier.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('도움말')
    .setDescription('방 관리 봇의 사용 가능한 명령어 목록을 확인합니다.')
    .addStringOption(opt =>
      opt
        .setName('분류')
        .setDescription('볼 분류 (비워두거나 "전체"면 볼 수 있는 모든 명령어, 목록은 권한에 따라 다름)')
        .setAutocomplete(true)
    ),

  /**
   * 분류 자동완성: 사용자 등급에서 볼 수 있는 분류만 표시
   * @param {import('discord.js').AutocompleteInteraction} interaction
   */
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().trim();
    const choices = [
      { name: '📖 전체 (볼 수 있는 모든 명령어)', value: ALL_CATEGORY },
      ...visibleSectionsFor(interaction).map(s => ({ name: s.name, value: s.key })),
    ]
      .filter(c => !typed || c.name.includes(typed) || c.value.includes(typed))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const admin = isAdmin(interaction);
    const visibleSections = visibleSectionsFor(interaction);
    const category = interaction.options.getString('분류')?.trim() || ALL_CATEGORY;
    const tierFooter = admin
      ? '👑 관리자 전용 명령어는 서버 관리(Manage Server) 권한 또는 관리자 권한이 있는 멤버만 사용할 수 있습니다.'
      : '더 많은 기능은 서버 관리자에게 문의하세요.';

    // 1. 분류 하나만 보기
    if (category !== ALL_CATEGORY) {
      const section = findSection(visibleSections, category);
      if (!section) {
        // 볼 수 없는 분류인지, 없는 분류인지 구분하지 않음 (상위 등급 분류 이름을 노출하지 않기 위해)
        return interaction.reply({
          content: `❌ \`${category}\` 분류를 찾을 수 없습니다.\n볼 수 있는 분류: ${categoryList(visibleSections)} · 전체 보기: \`/도움말\``,
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📖 도움말 · ${section.name}`)
        .setDescription(section.value)
        .addFields({ name: '​', value: `${TIER_LABEL[section.tier]} · 다른 분류: ${categoryList(visibleSections)}` })
        .setFooter({ text: '전체 보기: /도움말 · 분류 보기: /도움말 분류:<이름>' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // 2. 전체 보기 (등급이 바뀌는 지점에 구분 헤더 삽입)
    const fields = [];
    if (visibleSections.length === 0) {
      fields.push({
        name: '사용 가능한 명령어가 없습니다',
        value: '현재 모든 명령어는 관리자 전용입니다. 필요한 기능은 서버 관리자에게 문의하세요.',
      });
    }
    let currentTier = null;
    for (const section of visibleSections) {
      if (section.tier !== currentTier) {
        currentTier = section.tier;
        fields.push({ name: '​', value: `**━━━ ${TIER_LABEL[section.tier]} ━━━**` });
      }
      fields.push({ name: section.name, value: section.value });
    }

    const embeds = packEmbeds(fields, {
      title: '📖 방 관리 봇 도움말',
      description:
        '서버와 채널을 원활하게 관리할 수 있도록 지원하는 봇입니다.\n' +
        (admin
          ? `${TIER_LABEL[CommandTier.EVERYONE]} 명령어와 ${TIER_LABEL[CommandTier.ADMIN]} 명령어를 모두 표시합니다.`
          : `${TIER_LABEL[CommandTier.EVERYONE]} 명령어만 표시됩니다. 관리자 전용 명령어는 서버 관리 권한이 있는 멤버에게만 보입니다.`) +
        `\n🔎 분류별 보기: \`/도움말 분류:<이름>\` (${categoryList(visibleSections)})`,
      footer: tierFooter,
    });

    // 관리자 포함 모두 본인에게만 보이는 메시지로 표시
    await interaction.reply({ embeds, ephemeral: true });
  },
};
