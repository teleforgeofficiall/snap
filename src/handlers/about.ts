import { sendMessage, deleteMessage } from "../telegram";
import { aboutInlineKeyboard } from "../keyboards";

export async function handleAbout(
  token: string,
  chatId: number,
  messageId: number
) {
  await deleteMessage(token, chatId, messageId);

  await sendMessage(token, {
    chat_id: chatId,
    text: aboutText(),
    reply_markup: aboutInlineKeyboard(),
  });
}

function aboutText(): string {
  return `ℹ️ <b>About Snapbucks</b> 📃

<b>SNAP is the official reward point of the Snapbucks ecosystem.</b>

<blockquote expandable>Invite friends and earn SNAP before the Mini App launches. Once the Snapbucks Mini App is live, you can use your SNAP to earn real Gram (formerly TON) rewards.

━━━━━━━━━━━━━━━
🚀 <b>Mini App Launch</b>
September 1, 2026

On launch day, you will be able to claim all the SNAP earned in this Airdrop Bot directly inside the Snapbucks Mini App. Your SNAP balance will be transferred automatically after claiming.

━━━━━━━━━━━━━━━
<b>What is Snapbucks?</b>

Snapbucks is a Telegram Mini App where users can complete tasks, join campaigns, invite friends, and participate in community activities to earn Gram (formerly TON) rewards.

More features and earning opportunities will be available after launch.</blockquote>

━━━━━━━━━━━━━━━
<b>📢 Stay active in our official Telegram channel to receive the latest updates and announcements. ⭐️</b>`;
}
