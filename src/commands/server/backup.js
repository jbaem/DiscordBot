import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { CommandTier, ADMIN_DEFAULT_PERMISSION } from '../../core/permissions.js';
import {
  createBackup,
  parseBackup,
  applyBackup,
  BackupError,
  MAX_BACKUP_FILE_BYTES,
} from '../../services/backupManager.js';
import { backupStore, BACKUP_TAG_LABEL, MAX_LOCAL_BACKUPS_PER_GUILD } from '../../stores/backupStore.js';

/** 로컬 백업 한 건을 사람이 읽기 좋은 한 줄로 표시 */
function describeLocalBackup(info) {
  const tag = info.tag ? ` · ${BACKUP_TAG_LABEL[info.tag] || info.tag}` : '';
  return `${info.label}${tag} · ${(info.size / 1024).toFixed(1)}KB`;
}

/**
 * 복원할 백업 원본 텍스트를 가져온다.
 * 우선순위: 첨부 파일 → 로컬 백업 이름 지정 → 서버의 가장 최근 로컬 백업
 * @returns {Promise<{ rawText: string, sourceName: string }>}
 */
async function loadBackupSource(interaction) {
  const attachment = interaction.options.getAttachment('파일');
  if (attachment) {
    if (attachment.size > MAX_BACKUP_FILE_BYTES) {
      throw new BackupError(`파일이 너무 큽니다. (최대 ${MAX_BACKUP_FILE_BYTES / 1024 / 1024}MB)`);
    }
    const looksLikeJson =
      attachment.name?.toLowerCase().endsWith('.json') || attachment.contentType?.includes('json');
    if (!looksLikeJson) throw new BackupError('`.json` 백업 파일만 업로드할 수 있습니다.');

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new BackupError(`첨부 파일을 내려받지 못했습니다. (HTTP ${response.status})`);
    }
    return { rawText: await response.text(), sourceName: `첨부 파일 \`${attachment.name}\`` };
  }

  const requested = interaction.options.getString('백업');
  if (requested) {
    const rawText = backupStore.read(requested);
    if (rawText === null) {
      throw new BackupError(`로컬 백업 \`${requested}\` 을(를) 찾을 수 없습니다. \`/백업 목록\` 으로 확인해 주세요.`);
    }
    return { rawText, sourceName: `로컬 백업 \`${requested}\`` };
  }

  const latest = backupStore.latest(interaction.guild.id);
  if (!latest) {
    throw new BackupError('이 서버의 로컬 백업이 없습니다. 먼저 `/백업 내보내기` 를 실행하거나 백업 파일을 첨부해 주세요.');
  }
  return { rawText: backupStore.read(latest.fileName), sourceName: `가장 최근 로컬 백업 \`${latest.fileName}\`` };
}

export default {
  tier: CommandTier.ADMIN,
  data: new SlashCommandBuilder()
    .setName('백업')
    .setDescription('서버 설정과 멤버 이력, 활동 기록을 백업하거나 복원합니다. (봇 서버의 backups/ 폴더에 자동 저장)')
    .setDefaultMemberPermissions(ADMIN_DEFAULT_PERMISSION)
    .addSubcommand(sub =>
      sub
        .setName('내보내기')
        .setDescription('현재 상태를 backups/ 폴더에 저장하고 JSON 파일로도 내려받습니다.')
    )
    .addSubcommand(sub =>
      sub
        .setName('불러오기')
        .setDescription('로컬 백업(기본: 가장 최근) 또는 첨부한 백업 파일로 복원합니다.')
        .addStringOption(opt =>
          opt
            .setName('백업')
            .setDescription('복원할 로컬 백업 (비워두면 가장 최근 백업)')
            .setAutocomplete(true)
        )
        .addAttachmentOption(opt =>
          opt.setName('파일').setDescription('내려받아 둔 JSON 백업 파일 (첨부하면 로컬 백업 대신 사용)')
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
    )
    .addSubcommand(sub => sub.setName('목록').setDescription('backups/ 폴더에 저장된 이 서버의 백업 목록을 확인합니다.')),

  /**
   * /백업 불러오기 의 `백업` 옵션 자동완성: 이 서버의 로컬 백업 목록
   * @param {import('discord.js').AutocompleteInteraction} interaction
   */
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = backupStore
      .list(interaction.guildId)
      .map(info => ({ name: describeLocalBackup(info).slice(0, 100), value: info.fileName }))
      .filter(c => !typed || c.name.toLowerCase().includes(typed) || c.value.includes(typed))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({ content: '❌ 서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    }

    // 1. 백업: backups/ 폴더에 자동 저장 + 파일 내려받기
    if (subcommand === '내보내기') {
      try {
        const backup = createBackup(guild);
        const json = JSON.stringify(backup, null, 2);
        const fileName = backupStore.save(guild.id, backup);
        if (!fileName) throw new Error('backups/ 폴더에 백업 파일을 저장하지 못했습니다.');
        const file = new AttachmentBuilder(Buffer.from(json, 'utf-8'), { name: fileName });

        const configuredCount = Object.values(backup.settings).filter(v => v !== null && v !== '').length;
        const memberCount = Object.keys(backup.memberHistory).length;
        const activityCount = Object.keys(backup.activity).length;
        const sizeKb = (Buffer.byteLength(json, 'utf-8') / 1024).toFixed(1);
        const localCount = backupStore.list(guild.id).length;

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('💾 백업 완료')
          .setDescription(
            `봇 서버의 \`backups/${fileName}\` 에 저장했습니다. \`/백업 불러오기\` 를 파일 없이 실행하면 가장 최근 백업으로 복원됩니다.\n` +
              '서버 자체가 사라지는 경우에 대비해 아래 첨부 파일도 내려받아 보관하세요.'
          )
          .addFields(
            { name: '⚙️ 저장된 설정 항목', value: `${configuredCount}개 / ${Object.keys(backup.settings).length}개`, inline: true },
            { name: '👥 멤버 이력 레코드', value: `${memberCount.toLocaleString()}명`, inline: true },
            { name: '📊 활동 기록 레코드', value: `${activityCount.toLocaleString()}명`, inline: true },
            { name: '📦 파일 크기', value: `${sizeKb} KB`, inline: true },
            { name: '🗂️ 로컬 백업', value: `${localCount}개 보관 중 (최대 ${MAX_LOCAL_BACKUPS_PER_GUILD}개, 초과 시 오래된 것부터 삭제)`, inline: true }
          )
          .setFooter({ text: '⚠️ 이 파일에는 채널 ID와 멤버 ID, 입장 이력이 포함되어 있으니 외부에 공유하지 마세요.' })
          .setTimestamp();

        console.log(`[Backup] ${guild.name}(${guild.id}) 백업 저장: backups/${fileName} by ${interaction.user.tag}`);
        return interaction.reply({ embeds: [embed], files: [file], ephemeral: true });
      } catch (error) {
        console.error('[Backup] 백업 생성 실패:', error);
        return interaction.reply({ content: '❌ 백업 파일을 만드는 중 오류가 발생했습니다.', ephemeral: true });
      }
    }

    // 2. 복원: 첨부 파일 → 지정한 로컬 백업 → 가장 최근 로컬 백업 순으로 사용
    if (subcommand === '불러오기') {
      const mode = interaction.options.getString('모드') || 'merge';
      const force = interaction.options.getBoolean('강제') || false;

      // 파일 다운로드 및 반영은 3초를 넘길 수 있으므로 지연 응답
      await interaction.deferReply({ ephemeral: true });

      try {
        const { rawText, sourceName } = await loadBackupSource(interaction);
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

        // 복원 직전 상태를 자동 백업 → 잘못 복원해도 이 백업으로 되돌릴 수 있음
        const restorePoint = backupStore.save(guild.id, createBackup(guild), 'before-restore');

        const result = applyBackup(guild, backup, mode);

        const modeText = mode === 'replace' ? '전체 교체' : '병합';
        const exportedMs = Date.parse(backup.exportedAt);
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('✅ 백업 복원 완료')
          .setDescription(`${sourceName} 의 내용을 현재 서버에 적용했습니다.`)
          .addFields(
            { name: '⚙️ 복원된 설정', value: result.appliedSettings.length ? result.appliedSettings.map(k => `\`${k}\``).join(', ') : '없음' },
            { name: '👥 멤버 이력', value: `${result.history.imported.toLocaleString()}명 반영 (${modeText}) · 현재 총 ${result.history.total.toLocaleString()}명`, inline: true },
            { name: '📊 활동 기록', value: `${result.activity.imported.toLocaleString()}명 반영 (${modeText}) · 현재 총 ${result.activity.total.toLocaleString()}명`, inline: true },
            { name: '🕒 백업 생성 시각', value: Number.isFinite(exportedMs) ? `<t:${Math.floor(exportedMs / 1000)}:f>` : '알 수 없음', inline: true },
            {
              name: '↩️ 되돌리기',
              value: restorePoint
                ? `복원 직전 상태를 \`${restorePoint}\` 로 저장했습니다. \`/백업 불러오기 백업:${restorePoint} 모드:전체 교체\` 로 되돌릴 수 있습니다.`
                : '⚠️ 복원 직전 상태를 저장하지 못했습니다.',
            }
          )
          .setTimestamp();

        if (result.missingChannels.length) {
          embed.addFields({
            name: '⚠️ 현재 서버에 없는 채널',
            value:
              result.missingChannels.map(v => `\`${v}\``).join('\n') +
              '\n해당 기능은 `/연결 채널` 명령어로 채널을 다시 연결해 주세요.',
          });
        }
        if (result.skippedSettings.length) {
          embed.addFields({
            name: '⏭️ 형식이 달라 건너뛴 설정',
            value: result.skippedSettings.map(k => `\`${k}\``).join(', '),
          });
        }

        console.log(`[Backup] ${guild.name}(${guild.id}) 복원 완료 by ${interaction.user.tag} (mode=${mode}, source=${sourceName})`);
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        if (error instanceof BackupError) {
          return interaction.editReply({ content: `❌ ${error.message}` });
        }
        console.error('[Backup] 복원 실패:', error);
        return interaction.editReply({ content: '❌ 백업을 복원하는 중 오류가 발생했습니다.' });
      }
    }

    // 3. 로컬 백업 목록
    if (subcommand === '목록') {
      const backups = backupStore.list(guild.id);
      const MAX_SHOWN = 15;
      const lines = backups.slice(0, MAX_SHOWN).map((info, i) => `${i === 0 ? '🆕' : '•'} \`${info.fileName}\`\n　${describeLocalBackup(info)}`);
      if (backups.length > MAX_SHOWN) lines.push(`… 외 ${backups.length - MAX_SHOWN}개`);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🗂️ 로컬 백업 목록 (${backups.length}/${MAX_LOCAL_BACKUPS_PER_GUILD})`)
        .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '저장된 백업이 없습니다. `/백업 내보내기` 로 만들 수 있습니다.')
        .setFooter({ text: '복원: /백업 불러오기 (비워두면 🆕 가장 최근 백업) · 시각은 한국 시간 기준' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
