import { EmbedBuilder, Events } from 'discord.js';
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
        const descriptionText = settingsManager.formatMessage(settings.leaveMessage, {
          member,
          guild: member.guild,
          joinCount,
        });

        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('👋 멤버가 서버를 떠났습니다')
          .setDescription(descriptionText)
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
          .addFields(
            { name: '👤 유저명', value: member.user.tag, inline: true },
            { name: '👥 남은 서버 멤버 수', value: `${member.guild.memberCount}명`, inline: true }
          )
          .setFooter({ text: `유저 ID: ${member.id}` })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[Leave] 퇴장 메시지 전송 실패:', error);
    }
  },
};
