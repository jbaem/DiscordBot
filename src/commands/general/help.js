import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('방 관리 봇의 사용 가능한 명령어 목록을 확인합니다.'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📖 방 관리 봇 도움말')
      .setDescription('서버와 채널을 원활하게 관리할 수 있도록 지원하는 봇입니다.')
      .addFields(
        {
          name: '🔊 임시 음성 채널 (Join-to-Create)',
          value:
            '• 지정된 생성 채널에 접속하면 전용 음성방이 자동 생성됩니다.\n' +
            '• 마지막 유저가 퇴장하면 방이 자동으로 정리(삭제)됩니다.\n' +
            '• `/voice name <이름>` : 내 음성방 이름 변경\n' +
            '• `/voice limit <인원수>` : 내 음성방 입장 인원 제한 (0은 무제한)\n' +
            '• `/voice lock` : 내 음성방 잠금 (다른 유저 입장 차단)\n' +
            '• `/voice unlock` : 내 음성방 잠금 해제',
        },
        {
          name: '🛡️ 채널 관리 및 모더레이션',
          value:
            '• `/clear <개수> [유저]` : 메시지 일괄 삭제 (최대 100개, 특정 유저 필터링 가능)\n' +
            '• `/lock [이유]` : 현재 채널 잠금 (일반 유저 채팅 차단)\n' +
            '• `/unlock` : 현재 채널 잠금 해제\n' +
            '• `/slowmode <초>` : 채팅 슬로우 모드 설정 (0초는 해제)',
        },
        {
          name: '👋 멤버 입장 / 퇴장 채널 및 메시지 커스텀',
          value:
            '• `/welcome channel <채널>` : 입장(환영) 알림을 보낼 텍스트 채널 지정\n' +
            '• `/welcome message <문구>` : 환영 메시지 커스텀 ({user}, {userName}, {server}, {count} 변수 지원)\n' +
            '• `/welcome view` / `/welcome test` / `/welcome disable` : 입장 알림 확인 / 테스트 / 비활성화\n' +
            '• `/leave channel <채널>` : 퇴장 알림을 보낼 텍스트 채널 지정\n' +
            '• `/leave message <문구>` : 퇴장 메시지 커스텀 문구 설정\n' +
            '• `/leave view` / `/leave test` / `/leave disable` : 퇴장 알림 확인 / 테스트 / 비활성화',
        },
        {
          name: '⚙️ 일반',
          value: '• `/ping` : 봇의 응답 속도 확인\n• `/help` : 이 안내 메시지 확인',
        }
      )
      .setFooter({ text: '관리자 권한이 있는 멤버만 모더레이션 명령어를 사용할 수 있습니다.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
