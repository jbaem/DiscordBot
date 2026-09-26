import { Events } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.warn(`[Command] 알 수 없는 명령어 요청: ${interaction.commandName}`);
      return;
    }

    // 관리자 전용 명령어 권한 검사
    // (디스코드 기본 권한으로 이미 숨겨지지만, 서버 설정에서 권한을 바꾼 경우에 대비해 한 번 더 확인)
    if (!canUseCommand(interaction, command)) {
      console.warn(`[Command] 권한 없는 관리자 명령어 시도: /${interaction.commandName} by ${interaction.user.tag}`);
      return interaction
        .reply({
          content: '🔒 이 명령어는 **관리자 전용**입니다. 서버 관리 권한이 있는 멤버만 사용할 수 있습니다.',
          ephemeral: true,
        })
        .catch(() => {});
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`[Command] 명령어 실행 중 에러 (${interaction.commandName}):`, error);

      const errorMessage = {
        content: '⚠️ 명령어 실행 중 오류가 발생했습니다.',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage).catch(() => {});
      } else {
        await interaction.reply(errorMessage).catch(() => {});
      }
    }
  },
};
