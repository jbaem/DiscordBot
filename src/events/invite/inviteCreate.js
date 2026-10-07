import { Events } from 'discord.js';
import { rememberInvite } from '../../services/inviteTracker.js';

/**
 * 초대 링크 생성 → 사용 횟수 기록에 추가 (입장 알림의 초대자 확인용)
 */
export default {
  name: Events.InviteCreate,
  /** @param {import('discord.js').Invite} invite */
  async execute(invite) {
    rememberInvite(invite);
  },
};
