import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import {
  createBackup,
  parseBackup,
  applyBackup,
  buildBackupFileName,
  BackupError,
  MAX_BACKUP_FILE_BYTES,
} from '../../services/backupManager.js';

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('백업')
    .setDescription('서버 설정(채널 ID, 문구)과 멤버 입장 이력을 백업하거나 복원합니다.')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('내보내기')
        .setDescription('현재 서버의 설정과 멤버 이력을 JSON 파일로 내려받습니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('불러오기')
        .setDescription('백업 JSON 파일을 업로드하여 설정과 멤버 이력을 복원합니다.')
        .addAttachmentOption(opt =>
          opt
            .setName('파일')
            .setDescription('/백업 내보내기 로 내려받은 JSON 백업 파일')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('모드')
            .setDescription('멤버 이력 복원 방식 (기본: 병합)')
            .addChoices(
              { name: '병합 (권장) - 기존 기록과 합치고 더 큰 입장 횟수를 유지', value: 'merge' },
              { name: '전체 교체 - 현재 이력을 지우고 백업 내용으로 덮어쓰기', value: 'replace' }
            )
        )
        .addBooleanOption(opt =>
          opt
            .setName('강제')
            .setDescription('다른 서버에서 만든 백업 파일도 강제로 적용 (기본: 아니오)')
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    // 1. 백업 파일 내려받기
    if (subcommand === '내보내기') {
      try {
        const backup = createBackup(guild);
        const json = JSON.stringify(backup, null, 2);
        const fileName = buildBackupFileName(guild.id);
        const file = new AttachmentBuilder(Buffer.from(json, 'utf-8'), { name: fileName });

        const configuredCount = Object.values(backup.settings).filter(v => v !== null && v !== '').length;
        const memberCount = Object.keys(backup.memberHistory).length;
        const activityCount = Object.keys(backup.activity).length;
        const sizeKb = (Buffer.byteLength(json, 'utf-8') / 1024).toFixed(1);

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('💾 백업 파일 생성 완료')
          .setDescription('아래 파일을 내려받아 안전한 곳에 보관하세요. 복원은 `/백업 불러오기` 로 할 수 있습니다.')
          .addFields(
            { name: '⚙️ 저장된 설정 항목', value: `${configuredCount}개 / ${Object.keys(backup.settings).length}개`, inline: true },
            { name: '👥 멤버 이력 레코드', value: `${memberCount.toLocaleString()}명`, inline: true },
            { name: '📊 활동 기록 레코드', value: `${activityCount.toLocaleString()}명`, inline: true },
            { name: '📦 파일 크기', value: `${sizeKb} KB`, inline: true }
          )
          .setFooter({ text: '⚠️ 이 파일에는 채널 ID와 멤버 ID, 입장 이력이 포함되어 있으니 외부에 공유하지 마세요.' })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], files: [file], ephemeral: true });
      } catch (error) {
        console.error('[Backup] 백업 생성 실패:', error);
        return interaction.reply({ content: '❌ 백업 파일을 만드는 중 오류가 발생했습니다.', ephemeral: true });
      }
    }

    // 2. 백업 파일로 복원
    if (subcommand === '불러오기') {
      const attachment = interaction.options.getAttachment('파일');
      const mode = interaction.options.getString('모드') || 'merge';
      const force = interaction.options.getBoolean('강제') || false;

      if (attachment.size > MAX_BACKUP_FILE_BYTES) {
        return interaction.reply({
          content: `❌ 파일이 너무 큽니다. (최대 ${MAX_BACKUP_FILE_BYTES / 1024 / 1024}MB)`,
          ephemeral: true,
        });
      }

      const looksLikeJson =
        attachment.name?.toLowerCase().endsWith('.json') || attachment.contentType?.includes('json');
      if (!looksLikeJson) {
        return interaction.reply({ content: '❌ `.json` 백업 파일만 업로드할 수 있습니다.', ephemeral: true });
      }

      // 파일 다운로드 및 반영은 3초를 넘길 수 있으므로 지연 응답
      await interaction.deferReply({ ephemeral: true });

      try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new BackupError(`첨부 파일을 내려받지 못했습니다. (HTTP ${response.status})`);
        }
        const rawText = await response.text();
        const backup = parseBackup(rawText);

        if (backup.guildId !== guild.id && !force) {
          const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('⚠️ 다른 서버의 백업 파일입니다')
            .setDescription(
              '이 파일은 다른 서버에서 만들어졌습니다. 채널 ID 등이 현재 서버와 맞지 않을 수 있습니다.\n' +
              '그래도 적용하려면 `강제` 옵션을 **예**로 설정해 다시 실행해 주세요.'
            )
            .addFields(
              { name: '백업 서버', value: `${backup.guildName || '알 수 없음'} (\`${backup.guildId}\`)`, inline: true },
              { name: '현재 서버', value: `${guild.name} (\`${guild.id}\`)`, inline: true }
            );
          return interaction.editReply({ embeds: [embed] });
        }

        const result = applyBackup(guild, backup, mode);

        const modeText = mode === 'replace' ? '전체 교체' : '병합';
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('✅ 백업 복원 완료')
          .setDescription(`\`${attachment.name}\` 파일의 내용을 현재 서버에 적용했습니다.`)
          .addFields(
            { name: '⚙️ 복원된 설정', value: result.appliedSettings.length ? result.appliedSettings.map(k => `\`${k}\``).join(', ') : '없음' },
            { name: '👥 멤버 이력', value: `${result.history.imported.toLocaleString()}명 반영 (${modeText}) · 현재 총 ${result.history.total.toLocaleString()}명`, inline: true },
            { name: '📊 활동 기록', value: `${result.activity.imported.toLocaleString()}명 반영 (${modeText}) · 현재 총 ${result.activity.total.toLocaleString()}명`, inline: true },
            { name: '🕒 백업 생성 시각', value: backup.exportedAt ? `<t:${Math.floor(Date.parse(backup.exportedAt) / 1000)}:f>` : '알 수 없음', inline: true }
          )
          .setTimestamp();

        if (result.missingChannels.length) {
          embed.addFields({
            name: '⚠️ 현재 서버에 없는 채널',
            value:
              result.missingChannels.map(v => `\`${v}\``).join('\n') +
              '\n해당 기능은 `/채널연결` 명령어로 채널을 다시 연결해 주세요.',
          });
        }
        if (result.skippedSettings.length) {
          embed.addFields({
            name: '⏭️ 형식이 달라 건너뛴 설정',
            value: result.skippedSettings.map(k => `\`${k}\``).join(', '),
          });
        }

        console.log(`[Backup] ${guild.name}(${guild.id}) 복원 완료 by ${interaction.user.tag} (mode=${mode})`);
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        if (error instanceof BackupError) {
          return interaction.editReply({ content: `❌ ${error.message}` });
        }
        console.error('[Backup] 복원 실패:', error);
        return interaction.editReply({ content: '❌ 백업을 복원하는 중 오류가 발생했습니다.' });
      }
    }
  },
};
