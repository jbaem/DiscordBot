import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { settingsManager } from '../stores/settingsManager.js';

/**
 * 채널 연결 종류 정의
 * key: 서브커맨드 이름(한글) → 설정 키, 표시 이름, 채널 종류, 봇에 필요한 권한, 안내 문구
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
};

/** 현재 적용 중인 채널 ID (슬래시 설정 우선, 해제 시 null, 설정 이력이 없으면 .env 폴백) */
export function resolveLinkedChannelId(settings, linkName) {
  return settingsManager.resolveId(settings, CHANNEL_LINKS[linkName].settingKey);
}
