import { Events } from 'discord.js';
import { buildWelcomeEmbed } from '../utils/memberNotifications.js';
import { config } from '../config.js';
import { settingsManager } from '../utils/settingsManager.js';
import { memberHistoryManager } from '../utils/memberHistoryManager.js';
import { assignAutoRole } from '../utils/roleManager.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    console.log(`[Member] 신규 멤버 입장: ${member.user.tag}`);

    // 입장 횟수(들낙) 카운트 기록
    const joinCount = memberHistoryManager.recordJoin(member.guild.id, member.id);

    // 1. 자동 역할 부여 (/autorole 설정 우선, 없으면 .env AUTO_ROLE_ID 폴백)
    try {
      const result = await assignAutoRole(member);
      if (result.status === 'assigned') {
        console.log(`[AutoRole] ${member.user.tag} 님에게 '${result.role.name}' 역할 부여 완료`);
      } else if (result.status === 'missing' || result.status === 'failed') {
        console.warn(`[AutoRole] ${member.user.tag} 역할 부여 불가: ${result.reason}`);
      }
    } catch (error) {
      console.error('[AutoRole] 역할 부여 실패:', error);
    }

    // 2. 환영 메시지 전송 (동적 설정 반영)
    const settings = settingsManager.getGuildSettings(member.guild.id);
    const welcomeChannelId = settings.welcomeChannelId || config.welcomeChannelId;

    if (welcomeChannelId) {
      try {
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        if (channel && channel.isTextBased()) {
          const embed = buildWelcomeEmbed({ member, guild: member.guild, settings, joinCount });

          await channel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('[Welcome] 환영 메시지 전송 실패:', error);
      }
    }
  },
};
