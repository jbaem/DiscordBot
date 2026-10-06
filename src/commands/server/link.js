import { SlashCommandBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import channelGroup from './link/channel.js';

/**
 * /연결 <그룹> <서브커맨드>
 * - 그룹마다 link/ 폴더의 파일 하나 ({ name, build, execute })
 * - link/ 는 하위 폴더라 명령어 로더가 별도 명령어로 등록하지 않음
 */
const GROUPS = [channelGroup];

function buildData() {
  const builder = new SlashCommandBuilder()
    .setName('연결')
    .setDescription('봇 기능별 채널 연결을 설정합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION);

  for (const group of GROUPS) {
    builder.addSubcommandGroup(g => group.build(g));
  }
  return builder;
}

export default {
  tier: CommandTier.ADMIN,
  data: buildData(),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const groupName = interaction.options.getSubcommandGroup();
    const group = GROUPS.find(g => g.name === groupName);
    if (!group) {
      return interaction.reply({ content: '❌ 알 수 없는 연결 항목입니다.', ephemeral: true });
    }
    return group.execute(interaction);
  },
};
