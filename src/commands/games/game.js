import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandTier } from '../../core/permissions.js';
import { settingsManager } from '../../stores/settingsManager.js';
import { pointsManager, POINT_RULES } from '../../stores/pointsManager.js';
import { toDayKey } from '../../stores/activityManager.js';
import { playSolo, playDuel } from '../../services/games/rockPaperScissors.js';

/** 최소 베팅 포인트 */
export const MIN_BET = 10;
/** 순위에 보여 줄 인원 */
const RANKING_SIZE = 10;

const p = n => `${n.toLocaleString()}P`;
const record = r => `${r.wins}승 ${r.losses}패 ${r.draws}무`;

/** 게임은 /연결 채널 게임랜드 로 연결한 채널에서만 */
function checkGameChannel(interaction) {
  const channelId = settingsManager.resolveId(settingsManager.getGuildSettings(interaction.guild.id), 'gameChannelId');
  if (!channelId) return '🎮 아직 게임랜드 채널이 없습니다. 관리자가 `/연결 채널 게임랜드` 로 채널을 연결해야 합니다.';
  if (interaction.channelId !== channelId) return `🎮 게임은 <#${channelId}> 채널에서만 할 수 있습니다.`;
  return null;
}

export default {
  tier: CommandTier.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('게임')
    .setDescription('게임랜드: 포인트를 걸고 게임을 합니다.')
    .addSubcommand(sub =>
      sub.setName('등록').setDescription(`게임랜드에 등록하고 시작 포인트 ${POINT_RULES.START_POINTS.toLocaleString()}P를 받습니다. (1번만)`)
    )
    .addSubcommand(sub =>
      sub
        .setName('가위바위보')
        .setDescription('가위바위보를 합니다. 상대를 비우면 봇과 1인용, 지정하면 그 멤버와 대결합니다.')
        .addIntegerOption(opt =>
          opt.setName('베팅').setDescription(`걸 포인트 (최소 ${MIN_BET}P)`).setRequired(true).setMinValue(MIN_BET)
        )
        .addUserOption(opt => opt.setName('상대').setDescription('대결할 멤버 (비우면 봇과 대결)'))
    )
    .addSubcommand(sub =>
      sub
        .setName('포인트')
        .setDescription('포인트와 전적을 확인합니다. (본인에게만 표시)')
        .addUserOption(opt => opt.setName('유저').setDescription('확인할 멤버 (비우면 나)'))
    )
    .addSubcommand(sub => sub.setName('순위').setDescription(`포인트 순위 상위 ${RANKING_SIZE}명을 확인합니다.`)),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const { guild, user } = interaction;
    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    // 포인트 확인 (어디서나, 본인에게만)
    if (subcommand === '포인트') {
      const target = interaction.options.getUser('유저') ?? user;
      const r = pointsManager.get(guild.id, target.id);
      if (!r.registeredAt && r.balance === 0) {
        const who = target.id === user.id ? '아직 게임랜드에 등록하지 않았습니다. `/게임 등록` 으로 시작하세요!' : `${target} 님은 아직 게임랜드에 등록하지 않았습니다.`;
        return interaction.reply({ content: `🎮 ${who}`, ephemeral: true });
      }
      const rank = pointsManager.ranking(guild.id).findIndex(x => x.userId === target.id) + 1;
      const today = r.activityDay === toDayKey() ? r.activityToday : 0;
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🎮 ${target.username} 님의 포인트`)
        .addFields(
          { name: '💰 잔액', value: `**${p(r.balance)}**${rank ? ` · ${rank}위` : ''}`, inline: true },
          { name: '⚔️ 전적', value: record(r), inline: true },
          { name: '📈 오늘 활동 적립', value: `${p(today)} / ${p(POINT_RULES.DAILY_ACTIVITY_CAP)}`, inline: true }
        );
      if (!r.registeredAt) embed.setFooter({ text: '아직 /게임 등록 을 하지 않아 활동 적립과 게임은 등록 후부터 가능합니다.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // 순위 (게임랜드 채널에서는 모두에게, 다른 채널에서는 본인에게만)
    if (subcommand === '순위') {
      const ranking = pointsManager.ranking(guild.id);
      if (!ranking.length) return interaction.reply({ content: '🎮 아직 등록한 멤버가 없습니다.', ephemeral: true });
      const medal = i => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
      const lines = ranking.slice(0, RANKING_SIZE).map((r, i) => `${medal(i)} <@${r.userId}> **${p(r.balance)}** · ${record(r)}`);
      const myRank = ranking.findIndex(r => r.userId === user.id);
      if (myRank >= RANKING_SIZE) lines.push(`…\n${myRank + 1}. <@${user.id}> **${p(ranking[myRank].balance)}** (나)`);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle(`🏆 포인트 순위 (등록 ${ranking.length}명)`).setDescription(lines.join('\n'))],
        allowedMentions: { parse: [] },
        ephemeral: Boolean(checkGameChannel(interaction)),
      });
    }

    // 이하 게임랜드 채널에서만
    const channelError = checkGameChannel(interaction);
    if (channelError) return interaction.reply({ content: channelError, ephemeral: true });

    if (subcommand === '등록') {
      const { registered, balance } = pointsManager.register(guild.id, user.id);
      if (!registered) {
        return interaction.reply({ content: `🎮 이미 등록했습니다. 현재 잔액 **${p(balance)}**`, ephemeral: true });
      }
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🎮 게임랜드 등록 완료!')
            .setDescription(
              `${user} 님, 환영합니다! 시작 포인트 **${p(POINT_RULES.START_POINTS)}** 를 받았습니다. (잔액 ${p(balance)})\n\n` +
                `• 메시지 ${p(POINT_RULES.MESSAGE_POINTS)} (${POINT_RULES.MESSAGE_COOLDOWN_MS / 60000}분에 1번), ` +
                `음성 채널 1분당 ${p(POINT_RULES.VOICE_POINTS_PER_MINUTE)} 자동 적립 (하루 최대 ${p(POINT_RULES.DAILY_ACTIVITY_CAP)})\n` +
                '• `/게임 가위바위보 베팅:<포인트>` 로 봇과, `상대:@멤버` 를 지정하면 멤버와 대결'
            ),
        ],
      });
    }

    if (subcommand === '가위바위보') {
      const bet = interaction.options.getInteger('베팅');
      const opponent = interaction.options.getUser('상대');

      if (!pointsManager.isRegistered(guild.id, user.id)) {
        return interaction.reply({ content: '🎮 먼저 `/게임 등록` 으로 게임랜드에 등록해 주세요.', ephemeral: true });
      }
      const balance = pointsManager.get(guild.id, user.id).balance;
      if (balance < bet) {
        return interaction.reply({ content: `💸 포인트가 부족합니다. (잔액 ${p(balance)}, 베팅 ${p(bet)})`, ephemeral: true });
      }
      if (!opponent) return playSolo(interaction, bet);

      if (opponent.id === user.id) return interaction.reply({ content: '🙅 자기 자신과는 대결할 수 없습니다.', ephemeral: true });
      if (opponent.bot) return interaction.reply({ content: '🙅 봇과 하려면 `상대` 를 비워 주세요.', ephemeral: true });
      if (!pointsManager.isRegistered(guild.id, opponent.id)) {
        return interaction.reply({ content: `🎮 ${opponent} 님은 아직 게임랜드에 등록하지 않았습니다.`, ephemeral: true });
      }
      const opponentBalance = pointsManager.get(guild.id, opponent.id).balance;
      if (opponentBalance < bet) {
        return interaction.reply({ content: `💸 ${opponent} 님의 포인트가 베팅액보다 적습니다. (잔액 ${p(opponentBalance)})`, ephemeral: true });
      }
      return playDuel(interaction, opponent, bet);
    }
  },
};
