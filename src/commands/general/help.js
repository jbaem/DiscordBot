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
            '• `/autovoice setup` : 전용 카테고리 및 생성 채널 원클릭 자동 설정 (관리자)\n' +
            '• `/autovoice channel <채널>` : 기존 음성 채널을 방 생성 트리거로 등록 (관리자)\n' +
            '• `/autovoice name <서식>` : 기본 방 이름 서식 변경 (관리자)\n' +
            '• `/autovoice view` / `/autovoice disable` : 상태 확인 및 비활성화 (관리자)\n' +
            '• `/voice name <이름>` : 내 음성방 이름 변경 (방장)\n' +
            '• `/voice limit <인원수>` : 내 음성방 입장 인원 제한 (0은 무제한, 방장)\n' +
            '• `/voice lock` : 내 음성방 잠금 (다른 유저 입장 차단, 방장)\n' +
            '• `/voice unlock` : 내 음성방 잠금 해제 (방장)',
        },
        {
          name: '🛡️ 채널 관리 및 모더레이션',
          value:
            '• `/clear <개수> [유저]` : 메시지 일괄 삭제 (최대 100개, 특정 유저 필터링 가능)\n' +
            '• `/lock [이유]` : 현재 채널 잠금 (일반 유저 채팅 차단)\n' +
            '• `/unlock` : 현재 채널 잠금 해제\n' +
            '• `/slowmode <초>` : 채팅 슬로우 모드 설정 (0초는 해제)\n' +
            '• `/backup export` : 서버 설정(채널 ID, 문구)과 멤버 입장 이력을 JSON 파일로 내려받기 (관리자)\n' +
            '• `/backup import <파일> [모드]` : 백업 파일을 업로드해 설정과 이력 복원 (관리자)',
        },
        {
          name: '🎭 역할 자동화',
          value:
            '• `/autorole setup [이름]` : 구성원 역할을 만들어 자동 역할로 지정하고 기존 멤버 전체에 부여 (기본 이름: 포켓몬)\n' +
            '• `/autorole set <역할>` / `/autorole apply` : 기존 역할을 자동 역할로 지정 / 기존 멤버에게 일괄 부여\n' +
            '• `/autorole view` / `/autorole disable` : 자동 역할 확인 / 비활성화\n' +
            '• `/reactionrole add <역할> <이모지> [설명]` : 이모지를 누르면 받는 역할 등록 (예: 🎲 → 겜블러)\n' +
            '• `/reactionrole panel [채널]` : 이모지 역할 패널 메시지 게시 (반응 추가 = 역할 부여, 해제 = 역할 제거)\n' +
            '• `/reactionrole list` / `remove <역할>` / `refresh` : 목록 확인 / 등록 해제 / 패널 갱신',
        },
        {
          name: '👋 멤버 입장 / 퇴장 채널 및 메시지 커스텀',
          value:
            '• `/welcome channel <채널>` : 입장(환영) 알림을 보낼 텍스트 채널 지정\n' +
            '• `/welcome message <문구>` : 환영 메시지 커스텀 ({user}, {userName}, {server}, {count}, {joinedAt}, {accountAge}, {joinCount}, {isRejoin} 등 변수 지원)\n' +
            '• `/welcome view` / `/welcome test` / `/welcome disable` : 입장 알림 확인 / 테스트 / 비활성화\n' +
            '• `/leave channel <채널>` : 퇴장 알림을 보낼 텍스트 채널 지정\n' +
            '• `/leave message <문구>` : 퇴장 메시지 커스텀 (입장 메시지와 동일한 변수 지원)\n' +
            '• `/leave view` / `/leave test` / `/leave disable` : 퇴장 알림 확인 / 테스트 / 비활성화\n' +
            '• 재입장(들낙) 자동 감지 : 입장 횟수를 기록해 재입장 시 알림 제목과 색상을 구분 표시\n' +
            '• `/nicklog channel <채널>` : 닉네임 변경 로그 채널 지정 (변경 시각, 변경 전/후 이름 기록)\n' +
            '• `/nicklog view` / `/nicklog disable` : 닉네임 로그 설정 확인 / 비활성화',
        },
        {
          name: '⚙️ 일반',
          value:
            '• `/userinfo [유저]` : 유저 정보 확인 (이름, 계정 생성일, 서버 입장일, 입장 횟수, 포인트, 활동일, 메시지 수, 음성 시간, 역할)\n' +
            '• `/ping` : 봇의 응답 속도 확인\n' +
            '• `/help` : 이 안내 메시지 확인',
        }
      )
      .setFooter({ text: '관리자 권한이 있는 멤버만 모더레이션 명령어를 사용할 수 있습니다.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
