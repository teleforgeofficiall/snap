import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage } from "../telegram";
import { getSetting } from "../utils";

const BOT_USERNAME = "SnapbucksAirdrop_Bot";

export async function handleRefer(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  messageId: number
) {
  await deleteMessage(token, chatId, messageId);

  const { data: user } = await supabase
    .from("users")
    .select("referral_code, referral_count")
    .eq("telegram_id", userId)
    .single();

  if (!user) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ User not found. Please /start the bot.",
    });
    return;
  }

  const perRefStr = await getSetting(supabase, "per_referral_points");
  const perRef = parseInt(perRefStr || "100");
  const totalEarned = user.referral_count * perRef;

  const referralLink = `https://t.me/${BOT_USERNAME}?start=${user.referral_code}`;

  await sendMessage(token, {
    chat_id: chatId,
    text: referText(user.referral_count, totalEarned, perRef, referralLink),
  });
}

function referText(
  referralCount: number,
  totalEarned: number,
  perRef: number,
  referralLink: string
): string {
  return `👥 <b>Refer & Earn SNAP</b> 🪙

Invite your friends to Snapbucks using your unique referral link and earn SNAP for every successful referral.

👥 Total Referrals: <b>${referralCount}</b>
🪙 Total Earned: <b>${totalEarned} SNAP</b>
🪙 Per Referral: <b>${perRef} SNAP</b>
━━━━━━━━━━━━━━━
🔗 <b>Your Referral Link:</b>
<code>${referralLink}</code>`;
}
