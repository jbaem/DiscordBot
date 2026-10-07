import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { settingsManager } from '../stores/settingsManager.js';
import { syncReactionRolePanel, removeReactionRolePanels, describePanelSync } from './roleManager.js';
import { backupGuild, AUTO_BACKUP_INTERVAL_MS, MAX_KEPT_BACKUPS } from './autoBackup.js';

/**
 * 채널 연결 종류 정의
 * key: 서브커맨드 이름(한글) → 설정 키, 표시 이름, 채널 종류, 봇에 필요한 권한, 안내 문구
 * - onLink / onUnlink (선택): 연결·해제 직후 실행할 작업, 반환한 문자열은 결과 안내에 덧붙임
 */
export const CHANNEL_LINKS = {
  입장알림: {
    settingKey: 'welcomeChannelId',
    label: '👋 입장 알림',
    channelType: ChannelType.GuildText,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    doneText: channel => `이제 새로운 멤버가 들어오면 ${channel} 채널에 환영 메시지가 전송됩니다.`,
  },
  퇴장알림: {
    settingKey: 'leaveChannelId',
    label: '🚪 퇴장 알림',
    channelType: ChannelType.GuildText,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    doneText: channel => `이제 멤버가 서버를 떠나면 ${channel} 채널에 퇴장 알림이 전송됩니다.`,
  },
  닉네임로그: {
    settingKey: 'nicknameLogChannelId',
    label: '✏️ 닉네임 변경 로그',
    channelType: ChannelType.GuildText,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    doneText: channel => `이제 멤버가 서버 닉네임을 바꾸면 ${channel} 채널에 변경 시각과 변경 전/후 이름이 기록됩니다.`,
  },
  음성생성: {
    settingKey: 'joinToCreateChannelId',
    label: '🔊 임시 음성방 생성 채널',
    channelType: ChannelType.GuildVoice,
    requiredPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers],
    doneText: channel =>
      `이제 멤버가 ${channel} 채널에 접속하면 전용 통화방이 자동 생성됩니다.\n💡 생성용 채널의 인원 제한을 1명으로 두면 더 자연스럽게 동작합니다.`,
  },
  역할패널: {
    settingKey: 'rolePanelChannelId',
    label: '🎭 역할 패널',
    channelType: ChannelType.GuildText,
    requiredPermissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    doneText: channel =>
      `이제 ${channel} 채널에 이모지 역할 패널이 1개만 유지됩니다. \`/역할 추가\`·\`/역할 제거\` 를 하면 패널이 자동으로 갱신됩니다.`,
    // 연결 즉시 패널을 게시(이미 있으면 갱신)하고, 다른 채널에 있던 예전 패널은 정리
    onLink: async guild => describePanelSync(await syncReactionRolePanel(guild)),
    onUnlink: async guild => {
      const removed = await removeReactionRolePanels(guild);
      return removed ? `🧹 게시되어 있던 역할 패널 ${removed}개를 삭제했습니다.` : '';
    },
  },
  백업: {
    settingKey: 'backupChannelId',
    label: '🗄️ 자동 백업',
    channelType: ChannelType.GuildText,
    requiredPermissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    doneText: channel =>
      `이제 ${channel} 채널의 백업 메시지 1개에 ${AUTO_BACKUP_INTERVAL_MS / 60000}분마다(바뀐 내용이 있을 때)와 봇 종료 시 ` +
      `백업 파일이 붙고(새 메시지·알림 없이 수정, 최근 ${MAX_KEPT_BACKUPS}개 보관), 봇 시작 시 가장 최근 백업을 불러옵니다.\n` +
      '⚠️ 멤버 ID와 이력이 올라가므로 관리자만 볼 수 있는 비공개 채널이어야 합니다.',
    // 연결 즉시 현재 데이터를 새 채널에 올림 (마지막 백업과 같아도 올림)
    onLink: async guild => {
      const result = await backupGuild(guild, '채널 연결', { force: true });
      return result === 'uploaded'
        ? '🗄️ 현재 데이터를 바로 백업했습니다.'
        : '⚠️ 첫 백업을 올리지 못했습니다. 봇의 채널 권한을 확인해 주세요.';
    },
  },
};

/** 현재 적용 중인 채널 ID (슬래시 설정 우선, 해제 시 null, 설정 이력이 없으면 .env 폴백) */
export function resolveLinkedChannelId(settings, linkName) {
  return settingsManager.resolveId(settings, CHANNEL_LINKS[linkName].settingKey);
}
