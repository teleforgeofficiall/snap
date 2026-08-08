import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage } from "../telegram";
import { leaderboardLoadMoreKeyboard } from "../keyboards";

const PAGE_SIZE = 20;
const MAX_USERS = 100;

export async function handleLeaderboard(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  messageId: number,
  page: number = 1
) {
  if (messageId) {
    await deleteMessage(token, chatId, messageId);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: topUsers } = await supabase
    .from("users")
    .select("telegram_id, referral_count")
    .gt("referral_count", 0)
    .order("referral_count", { ascending: false })
    .range(from, to);

  const { count: totalCount } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .gt("referral_count", 0);

  const { data: allRanked } = await supabase
    .from("users")
    .select("telegram_id, referral_count")
    .gt("referral_count", 0)
    .order("referral_count", { ascending: false });

  const { data: currentUser } = await supabase
    .from("users")
    .select("referral_count")
    .eq("telegram_id", userId)
    .single();

  let userRank = -1;
  let userReferrals = currentUser?.referral_count || 0;

  if (allRanked) {
    const idx = allRanked.findIndex((u) => u.telegram_id === userId);
    if (idx !== -1) {
      userRank = idx + 1;
    }
  }

  const displayCount = Math.min(totalCount || 0, MAX_USERS);
  const medals = ["🥇", "🥈", "🥉"];

  let table = "Rank    User ID         Referrals\n";

  if (topUsers && topUsers.length > 0) {
    for (let i = 0; i < topUsers.length; i++) {
      const rank = from + i + 1;
      if (rank > MAX_USERS) break;

      const u = topUsers[i];
      const rankStr = rank <= 3 ? medals[rank - 1] : `${rank}.`;
      const padLen = rank <= 3 ? 7 : 8;
      const paddedRank = rankStr.padEnd(padLen);
      const paddedId = String(u.telegram_id).padEnd(19);
      table += `${paddedRank}${paddedId}${u.referral_count}\n`;
    }
  } else {
    table += "\nNo referrals yet. Be the first! 🚀";
  }

  const text = `🏆 <b>Top ${displayCount} Referrers</b> 🔥

<b>The leaderboard updates automatically as new referrals are counted. Keep inviting friends to climb the rankings.</b>

<pre>${table}</pre>
━━━━━━━━━━━━━━━━
🏅 <b>Your Current Rank: #${userRank !== -1 ? userRank : "N/A"}</b>
👥 <b>Your Referrals: ${userReferrals}</b>`;

  await sendMessage(token, {
    chat_id: chatId,
    text,
    reply_markup: leaderboardLoadMoreKeyboard(page, Math.min(totalCount || 0, MAX_USERS)),
  });
}
