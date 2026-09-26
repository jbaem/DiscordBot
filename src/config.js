import dotenv from 'dotenv';
dotenv.config();

export const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  joinToCreateChannelId: process.env.JOIN_TO_CREATE_CHANNEL_ID || '',
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || '',
  leaveChannelId: process.env.LEAVE_CHANNEL_ID || '',
  autoRoleId: process.env.AUTO_ROLE_ID || '',
  botStatus: process.env.BOT_STATUS || '/도움말', // 봇 프로필 말풍선(커스텀 상태) 문구
};
