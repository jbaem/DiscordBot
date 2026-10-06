import { ChannelType, PermissionFlagsBits, Events } from 'discord.js';
import { tempVoiceManager } from '../../stores/tempVoiceManager.js';
import { settingsManager } from '../../stores/settingsManager.js';
import { buildTempVoiceName, deleteTempChannel } from '../../services/tempVoiceChannels.js';

export default {
  name: Events.VoiceStateUpdate,
  /**
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   */
  async execute(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guild = newState.guild || oldState.guild;
    const settings = settingsManager.getGuildSettings(guild.id);
    const triggerChannelId = settingsManager.resolveId(settings, 'joinToCreateChannelId');

    // 1. Join-to-Create: 생성 채널에 접속했을 때
    if (triggerChannelId && newState.channelId === triggerChannelId) {
      const triggerChannel = newState.channel;
      const parentId = triggerChannel ? triggerChannel.parentId : null;
      let newVoiceChannel = null;

      try {
        const channelName = buildTempVoiceName(settings.voiceNameTemplate, member, guild);

        // 새 개인 임시 음성 채널 생성
        newVoiceChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: parentId,
          permissionOverwrites: [
            {
              id: member.id,
              allow: [
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.MoveMembers,
              ],
            },
          ],
        });

        // 생성 목록에 등록
        tempVoiceManager.addChannel(newVoiceChannel.id, member.id, guild.id);

        // 유저를 새 방으로 이동
        await member.voice.setChannel(newVoiceChannel);
        console.log(`[TempVoice] ${member.user.tag} 님의 임시 음성 채널 생성 완료 (${newVoiceChannel.name})`);
      } catch (error) {
        console.error('[TempVoice] 임시 채널 생성 및 이동 오류:', error);

        // 방은 만들었지만 이동에 실패한 경우(이동 전에 유저가 나감 등) 아무도 들어오지 않아
        // 퇴장 이벤트로 지워지지 않으므로 바로 정리
        if (newVoiceChannel && newVoiceChannel.members.size === 0) {
          await deleteTempChannel(newVoiceChannel, '임시 음성 채널 이동 실패로 인한 정리');
        }
      }
    }

    // 2. 나간 채널이 임시 음성 채널이고, 방이 비었으면 자동 삭제
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const oldChannel = oldState.channel;

      if (oldChannel && tempVoiceManager.isTempChannel(oldChannel.id)) {
        // 남은 멤버가 0명인 경우 채널 삭제
        if (oldChannel.members.size === 0) {
          await deleteTempChannel(oldChannel, '임시 음성 채널 인원 퇴장으로 인한 자동 삭제');
        }
      }
    }
  },
};
