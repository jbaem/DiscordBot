import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

export default {
  name: 'guildMemberAdd',
  async execute(member) {
    console.log(`[Member] 신규 멤버 입장: ${member.user.tag}`);

    // 1. 자동 역할 부여
    if (config.autoRoleId) {
      try {
        const role = member.guild.roles.cache.get(config.autoRoleId);
        if (role) {
          await member.roles.add(role);
          console.log(`[AutoRole] ${member.user.tag} 님에게 '${role.name}' 역할 부여 완료`);
        } else {
          console.warn(`[AutoRole] 역할 ID(${config.autoRoleId})를 찾을 수 없습니다.`);
        }
      } catch (error) {
        console.error('[AutoRole] 역할 부여 실패:', error);
      }
    }

    // 2. 환영 메시지 전송
    if (config.welcomeChannelId) {
      try {
        const channel = member.guild.channels.cache.get(config.welcomeChannelId);
        if (channel && channel.isTextBased()) {
          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🎉 새로운 멤버가 입장했습니다!')
            .setDescription(`환영합니다, **${member}** 님! 서버에 오신 것을 환영해요.`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
              { name: '👤 유저명', value: member.user.tag, inline: true },
              { name: '👥 현재 서버 멤버 수', value: `${member.guild.memberCount}명`, inline: true }
            )
            .setFooter({ text: `유저 ID: ${member.id}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('[Welcome] 환영 메시지 전송 실패:', error);
      }
    }
  },
};
