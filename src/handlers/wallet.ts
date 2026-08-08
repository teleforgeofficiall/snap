import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage, answerCallbackQuery } from "../telegram";
import { walletClaimKeyboard } from "../keyboards";
import { isToday, getToday, getSetting } from "../utils";

export async function handleWallet(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  messageId: number
) {
  await deleteMessage(token, chatId, messageId);

  const { data: user } = await supabase
    .from("users")
    .select("first_name, telegram_id, balance, daily_claim_date")
    .eq("telegram_id", userId)
    .single();

  if (!user) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ User not found. Please /start the bot.",
    });
    return;
  }

  const claimed = isToday(user.daily_claim_date);

  await sendMessage(token, {
    chat_id: chatId,
    text: walletText(user.first_name, user.telegram_id, user.balance),
    reply_markup: walletClaimKeyboard(claimed),
  });
}

export async function handleDailyClaim(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string,
  messageId: number
) {
  const { data: user } = await supabase
    .from("users")
    .select("daily_claim_date, balance")
    .eq("telegram_id", userId)
    .single();

  if (!user) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "❌ User not found!",
    });
    return;
  }

  if (isToday(user.daily_claim_date)) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "✅ You already claimed today! Come back tomorrow.",
      show_alert: true,
    });
    return;
  }

  const bonusStr = await getSetting(supabase, "daily_bonus");
  const bonus = parseInt(bonusStr || "10");

  await supabase
    .from("users")
    .update({
      balance: user.balance + bonus,
      daily_claim_date: getToday(),
    })
    .eq("telegram_id", userId);

  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: `🎉 +${bonus} SNAP claimed! Come back tomorrow for more.`,
  });

  const { data: updatedUser } = await supabase
    .from("users")
    .select("first_name, telegram_id, balance")
    .eq("telegram_id", userId)
    .single();

  if (updatedUser) {
    await deleteMessage(token, chatId, messageId);
    await sendMessage(token, {
      chat_id: chatId,
      text: walletText(
        updatedUser.first_name,
        updatedUser.telegram_id,
        updatedUser.balance
      ),
      reply_markup: walletClaimKeyboard(true),
    });
  }
}

function walletText(
  firstName: string,
  telegramId: number,
  balance: number
): string {
  return `👤 Name: ${firstName}
🆔 User ID: ${telegramId}

🪙 Balance: <b>${balance} SNAP</b>
━━━━━━━━━━━━━━━
<i>Keep inviting friends to earn more SNAP before the official launch. 🚀</i>`;
}
