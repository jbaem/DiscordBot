import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { tempVoiceManager } from '../utils/tempVoiceManager.js';

export default {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    // 1. Join-to-Create: 생성 채널에 접속했을 때
    if (config.joinToCreateChannelId && newState.channelId === config.joinToCreateChannelId) {
      const guild = newState.guild;
      const triggerChannel = newState.channel;
      const parentId = triggerChannel ? triggerChannel.parentId : null;

      try {
        const channelName = `🔊 ${member.displayName}님의 통화방`;

        // 새 개인 임시 음성 채널 생성
        const newVoiceChannel = await guild.channels.create({
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
      }
    }

    // 2. 나간 채널이 임시 음성 채널이고, 방이 비었으면 자동 삭제
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const oldChannel = oldState.channel;

      if (oldChannel && tempVoiceManager.isTempChannel(oldChannel.id)) {
        // 남은 멤버가 0명인 경우 채널 삭제
        if (oldChannel.members.size === 0) {
          tempVoiceManager.removeChannel(oldChannel.id);
          try {
            await oldChannel.delete('임시 음성 채널 인원 퇴장으로 인한 자동 삭제');
            console.log(`[TempVoice] 빈 임시 음성 채널 삭제 완료 (${oldChannel.name})`);
          } catch (error) {
            console.error('[TempVoice] 임시 채널 삭제 오류:', error);
          }
        }
      }
    }
  },
};
