import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier, TIER_LABEL, isAdmin } from '../../utils/permissions.js';

/**
 * 도움말 섹션 정의
 * - tier 가 EVERYONE 인 섹션은 모든 멤버에게, ADMIN 인 섹션은 관리자 등급 멤버에게만 표시된다.
 * - 관리자는 두 그룹을 모두 보고, 일반 구성원은 EVERYONE 그룹만 본다.
 */
const HELP_SECTIONS = [
  // ───────────── 👥 모든 멤버 ─────────────
  {
    tier: CommandTier.EVERYONE,
    name: '📊 유저 정보 / 도움말',
    value:
      '• `/유저정보 [유저]` : 유저 정보 확인 (계정 생성일, 서버 입장일, 입장 횟수, 포인트, 활동일, 메시지 수, 음성 시간, 역할, 최근 닉네임 변경)\n' +
      '• `/도움말` : 이 안내 메시지 확인\n' +
      '※ 포인트는 메시지 1개 1점(60초 쿨다운), 음성 채널 1분 1점으로 쌓입니다.',
  },

  // ───────────── 👑 관리자 전용 ─────────────
  {
    tier: CommandTier.ADMIN,
    name: '🔗 채널 연결',
    value:
      '• `/채널연결 입장알림 <채널>` / `퇴장알림 <채널>` : 입장·퇴장 알림 채널 연결\n' +
      '• `/채널연결 닉네임로그 <채널>` : 닉네임 변경 로그 채널 연결\n' +
      '• `/채널연결 음성생성 <채널>` : 임시 음성방 생성 채널 연결\n' +
      '• `/채널연결 확인` / `/채널연결 해제 <기능>` : 연결 상태 확인 / 연결 해제(비활성화)',
  },
  {
    tier: CommandTier.ADMIN,
    name: '👋 입장 / 퇴장 알림',
    value:
      '• `/알림문구 입장 <문구>` / `/알림문구 퇴장 <문구>` : 알림 문구 설정\n' +
      '• `/알림문구 확인` : 현재 문구와 미리보기 확인\n' +
      '• `/테스트 입장알림` / `/테스트 퇴장알림` : 연결된 채널로 테스트 전송\n' +
      '• 문구 변수: {user}, {userName}, {userTag}, {userId}, {server}, {count}, {joinedAt}, {joinedAtRelative}, {createdAt}, {accountAge}, {joinCount}, {isRejoin}\n' +
      '• 재입장(들낙) 자동 감지 : 재입장 시 알림 제목과 색상을 구분 표시',
  },
  {
    tier: CommandTier.ADMIN,
    name: '🔊 임시 음성방 (Join-to-Create)',
    value:
      '• `/음성방설정 자동설정` : 전용 카테고리 및 생성 채널 원클릭 자동 설정\n' +
      '• `/음성방설정 이름서식 <서식>` : 생성될 방의 기본 이름 서식 변경\n' +
      '• `/음성방설정 확인` : 설정 상태 확인\n' +
      '• `/음성방 이름 <이름>` / `인원 <인원수>` / `잠금` / `잠금해제` : 임시 음성방 제어 (해당 방에 접속한 상태에서 사용)\n' +
      '※ "➕ 클릭하여 통화방 생성" 채널에 접속하면 개인 통화방이 자동 생성되고, 모두 나가면 자동 삭제됩니다.',
  },
  {
    tier: CommandTier.ADMIN,
    name: '🛡️ 채널 관리',
    value:
      '• `/채널관리 잠금 [사유]` / `/채널관리 잠금해제` : 현재 채널 잠금 / 해제\n' +
      '• `/채널관리 슬로우모드 <초>` : 슬로우 모드 설정 (0은 해제)\n' +
      '• `/채널관리 메시지삭제 <개수> [유저]` : 메시지 일괄 삭제 (최대 100개, 특정 유저 필터)',
  },
  {
    tier: CommandTier.ADMIN,
    name: '🎭 역할 자동화',
    value:
      '• `/자동역할 설정 [이름]` : 구성원 역할을 만들어 자동 역할로 지정하고 기존 멤버 전체에 부여 (기본 이름: 포켓몬)\n' +
      '• `/자동역할 지정 <역할>` / `/자동역할 일괄적용` : 기존 역할을 자동 역할로 지정 / 기존 멤버에게 일괄 부여\n' +
      '• `/자동역할 확인` / `/자동역할 해제` : 자동 역할 확인 / 비활성화\n' +
      '• `/이모지역할 추가 <역할> <이모지> [설명]` : 이모지를 누르면 받는 역할 등록 (예: 🎲 → 겜블러)\n' +
      '• `/이모지역할 패널 [채널] [제목] [설명]` : 이모지 역할 패널 게시 (반응 추가 = 부여, 해제 = 제거)\n' +
      '• `/이모지역할 목록` / `제거 <역할>` / `갱신` : 목록 확인 / 등록 해제 / 패널 갱신',
  },
  {
    tier: CommandTier.ADMIN,
    name: '💾 백업 / 기타',
    value:
      '• `/백업 내보내기` : 서버 설정과 멤버 이력, 활동 기록을 JSON 파일로 내려받기\n' +
      '• `/백업 불러오기 <파일> [모드] [강제]` : 백업 파일을 업로드해 복원 (병합 / 전체 교체)\n' +
      '• `/핑` : 봇의 응답 속도 확인',
  },
];

export default {
  tier: CommandTier.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('도움말')
    .setDescription('방 관리 봇의 사용 가능한 명령어 목록을 확인합니다.'),

  async execute(interaction) {
    const admin = isAdmin(interaction);
    const visibleSections = HELP_SECTIONS.filter(s => admin || s.tier === CommandTier.EVERYONE);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📖 방 관리 봇 도움말')
      .setDescription(
        '서버와 채널을 원활하게 관리할 수 있도록 지원하는 봇입니다.\n' +
          (admin
            ? `${TIER_LABEL[CommandTier.EVERYONE]} 명령어와 ${TIER_LABEL[CommandTier.ADMIN]} 명령어를 모두 표시합니다.`
            : `${TIER_LABEL[CommandTier.EVERYONE]} 명령어만 표시됩니다. 관리자 전용 명령어는 서버 관리 권한이 있는 멤버에게만 보입니다.`)
      );

    if (visibleSections.length === 0) {
      embed.addFields({
        name: '사용 가능한 명령어가 없습니다',
        value: '현재 모든 명령어는 관리자 전용입니다. 필요한 기능은 서버 관리자에게 문의하세요.',
      });
    }

    let currentTier = null;
    for (const section of visibleSections) {
      // 등급이 바뀌는 지점에 구분 헤더 삽입
      if (section.tier !== currentTier) {
        currentTier = section.tier;
        embed.addFields({ name: '​', value: `**━━━ ${TIER_LABEL[section.tier]} ━━━**` });
      }
      embed.addFields({ name: section.name, value: section.value });
    }

    embed
      .setFooter({
        text: admin
          ? '👑 관리자 전용 명령어는 서버 관리(Manage Server) 권한 또는 관리자 권한이 있는 멤버만 사용할 수 있습니다.'
          : '더 많은 기능은 서버 관리자에게 문의하세요.',
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: !admin });
  },
};
