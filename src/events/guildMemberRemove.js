import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

export default {
  name: 'guildMemberRemove',
  async execute(member) {
    console.log(`[Member] 멤버 퇴장: ${member.user.tag}`);

    const targetChannelId = config.leaveChannelId || config.welcomeChannelId;
    if (!targetChannelId) return;

    try {
      const channel = member.guild.channels.cache.get(targetChannelId);
      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('👋 멤버가 서버를 떠났습니다')
          .setDescription(`**${member.user.tag}** 님이 서버를 떠났습니다.`)
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
          .addFields(
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
