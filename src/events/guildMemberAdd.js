import { EmbedBuilder, Events } from 'discord.js';
import { config } from '../config.js';
import { settingsManager } from '../utils/settingsManager.js';
import { memberHistoryManager } from '../utils/memberHistoryManager.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    console.log(`[Member] 신규 멤버 입장: ${member.user.tag}`);

    // 입장 횟수(들낙) 카운트 기록
    const joinCount = memberHistoryManager.recordJoin(member.guild.id, member.id);

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

    // 2. 환영 메시지 전송 (동적 설정 반영)
    const settings = settingsManager.getGuildSettings(member.guild.id);
    const welcomeChannelId = settings.welcomeChannelId || config.welcomeChannelId;

    if (welcomeChannelId) {
      try {
        const channel = member.guild.channels.cache.get(welcomeChannelId);
        if (channel && channel.isTextBased()) {
          const descriptionText = settingsManager.formatMessage(settings.welcomeMessage, {
            member,
            guild: member.guild,
            joinCount,
          });

          const isRejoinText = joinCount > 1 ? `⚠️ 재입장 (${joinCount}회차)` : '✨ 최초 입장';

          const embed = new EmbedBuilder()
            .setColor(joinCount > 1 ? 0xFEE75C : 0x57F287)
            .setTitle(joinCount > 1 ? '🔁 멤버가 다시 입장했습니다' : '🎉 새로운 멤버가 입장했습니다!')
            .setDescription(descriptionText)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
              { name: '👤 유저명', value: member.user.tag, inline: true },
              { name: '👥 현재 서버 멤버 수', value: `${member.guild.memberCount}명`, inline: true },
              { name: '📊 입장 횟수', value: isRejoinText, inline: true }
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
