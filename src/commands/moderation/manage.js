import { SlashCommandBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import channelGroup from './manage/channel.js';
import roleGroup from './manage/role.js';
import pointsGroup from './manage/points.js';

/**
 * /관리 <그룹> <서브커맨드>
 * - 그룹마다 manage/ 폴더의 파일 하나 ({ name, build, execute })
 * - manage/ 는 하위 폴더라 명령어 로더가 별도 명령어로 등록하지 않음
 */
const GROUPS = [channelGroup, roleGroup, pointsGroup];

function buildData() {
  const builder = new SlashCommandBuilder()
    .setName('관리')
    .setDescription('채널 잠금, 역할 부여, 게임 포인트 등 서버 관리 기능을 사용합니다.')
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
      return interaction.reply({ content: '❌ 알 수 없는 관리 항목입니다.', ephemeral: true });
    }
    return group.execute(interaction);
  },
};
