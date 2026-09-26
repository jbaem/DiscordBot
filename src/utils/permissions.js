import { PermissionFlagsBits } from 'discord.js';

/**
 * 명령어 사용 등급
 * - ADMIN: 서버 관리 권한(또는 관리자 권한, 서버 소유자)이 있는 멤버만 사용
 * - EVERYONE: 모든 멤버 사용 가능 (명령어 내부에서 방장 여부 등 추가 검사 가능)
 */
export const CommandTier = Object.freeze({
  ADMIN: 'admin',
  EVERYONE: 'everyone',
});

/**
 * 관리자 전용 명령어의 디스코드 기본 권한.
 * 이 권한이 없는 멤버에게는 명령어 목록에서 자체가 숨겨진다.
 * (관리자(Administrator) 권한은 모든 권한을 포함하므로 자동으로 통과)
 */
export const ADMIN_DEFAULT_PERMISSION = PermissionFlagsBits.ManageGuild;

/** 등급 표시용 라벨 */
export const TIER_LABEL = Object.freeze({
  [CommandTier.ADMIN]: '👑 관리자 전용',
  [CommandTier.EVERYONE]: '👥 모든 멤버',
});

/**
 * 인터랙션을 보낸 멤버가 관리자 등급인지 판정
 * - 서버 소유자
 * - 관리자(Administrator) 권한 보유
 * - 서버 관리(Manage Guild) 권한 보유
 */
export function isAdmin(interaction) {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId && interaction.guild.ownerId === interaction.user?.id) return true;

  const permissions = interaction.memberPermissions;
  if (!permissions) return false;
  return permissions.has(PermissionFlagsBits.Administrator) || permissions.has(ADMIN_DEFAULT_PERMISSION);
}

/**
 * 명령어 객체의 등급을 반환 (미지정 시 안전하게 ADMIN 으로 취급)
 */
export function getCommandTier(command) {
  return command?.tier === CommandTier.EVERYONE ? CommandTier.EVERYONE : CommandTier.ADMIN;
}

/**
 * 멤버가 해당 명령어를 사용할 수 있는지 판정
 */
export function canUseCommand(interaction, command) {
  return getCommandTier(command) === CommandTier.EVERYONE || isAdmin(interaction);
}
