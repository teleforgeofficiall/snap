import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage, answerCallbackQuery } from "../telegram";
import { withdrawClaimKeyboard } from "../keyboards";
import { checkAllChannelsJoined, getSetting } from "../utils";

export async function handleWithdraw(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  messageId: number
) {
  await deleteMessage(token, chatId, messageId);

  const { data: user } = await supabase
    .from("users")
    .select("referral_count")
    .eq("telegram_id", userId)
    .single();

  if (!user) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ User not found. Please /start the bot.",
    });
    return;
  }

  const { data: channels } = await supabase
    .from("channels")
    .select("channel_id, channel_username")
    .eq("is_active", true);

  let channelJoined = true;
  if (channels && channels.length > 0) {
    const { allJoined } = await checkAllChannelsJoined(token, userId, channels);
    channelJoined = allJoined;
  }

  const referralRequired = 5;
  const hasEnoughReferrals = user.referral_count >= referralRequired;
  const isEligible = channelJoined && hasEnoughReferrals;

  // Update eligible flag in database
  if (isEligible) {
    await supabase
      .from("users")
      .update({ eligible: true })
      .eq("telegram_id", userId);
  }

  const miniAppUrl = await getSetting(supabase, "mini_app_url");

  await sendMessage(token, {
    chat_id: chatId,
    text: withdrawText(
      channelJoined,
      hasEnoughReferrals,
      user.referral_count,
      referralRequired
    ),
    reply_markup: withdrawClaimKeyboard(miniAppUrl),
  });
}

export async function handleClaimComingSoon(
  token: string,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "⏳ Coming Soon... Mini App launching on September 1, 2026!",
    show_alert: true,
  });
}

function withdrawText(
  channelJoined: boolean,
  hasEnoughReferrals: boolean,
  currentReferrals: number,
  referralRequired: number
): string {
  return `💸 <b>Claim SNAP</b> 🪙

📆 Claim Available on: 1 September 2026

<blockquote expandable>Your SNAP Coins will be automatically credited to the Snapbucks Mini App. Just open the Mini App after launch with the same Telegram account to view your points.</blockquote>

✅ <b>Eligibility Criteria</b>

1️⃣ Join Official TG channel.   ${channelJoined ? "✅" : "❌"}
2️⃣ Invite at least ${referralRequired} friends.    ${hasEnoughReferrals ? "✅" : `${currentReferrals}/${referralRequired}`}

${channelJoined && hasEnoughReferrals ? "🎉 <b>You are eligible for SNAP claiming!</b>" : "<i>🚀 Complete all required criteria to become eligible for SNAP claiming.</i>"}`;
}
