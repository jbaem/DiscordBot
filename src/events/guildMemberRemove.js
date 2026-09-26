import { Events } from 'discord.js';
import { buildLeaveEmbed } from '../utils/memberNotifications.js';
import { config } from '../config.js';
import { settingsManager } from '../utils/settingsManager.js';
import { memberHistoryManager } from '../utils/memberHistoryManager.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member) {
    console.log(`[Member] 멤버 퇴장: ${member.user.tag}`);

    // 퇴장 기록
    memberHistoryManager.recordLeave(member.guild.id, member.id);
    const joinCount = memberHistoryManager.getJoinCount(member.guild.id, member.id);

    const settings = settingsManager.getGuildSettings(member.guild.id);
    const targetChannelId = settings.leaveChannelId || config.leaveChannelId;
    if (!targetChannelId) return;

    try {
      const channel = member.guild.channels.cache.get(targetChannelId);
      if (channel && channel.isTextBased()) {
        const embed = buildLeaveEmbed({ member, guild: member.guild, settings, joinCount });

        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[Leave] 퇴장 메시지 전송 실패:', error);
    }
  },
};
