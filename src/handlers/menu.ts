import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage, answerCallbackQuery } from "../telegram";
import { mainMenuKeyboard } from "../keyboards";

export async function handleMainMenu(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  messageId: number
) {
  await deleteMessage(token, chatId, messageId);

  await sendMessage(token, {
    chat_id: chatId,
    text: menuText(),
    reply_markup: mainMenuKeyboard(),
  });
}

function menuText(): string {
  return `🎉 <b>Welcome to Snapbucks!</b> 👋

━━━━━━━━━━━━━━━
Choose an option below to get started: 🚀`;
}
