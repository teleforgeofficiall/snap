import { Env, loadAdminIds } from "./config";
import { getSupabase } from "./supabase";
import { sendMessage, copyMessage, deleteMessage, answerCallbackQuery } from "./telegram";
import { launchMessageText, launchMessageKeyboard } from "./keyboards";
import { handleStart, handleVerifyContinue } from "./handlers/start";
import { handleMainMenu } from "./handlers/menu";
import { handleWallet, handleDailyClaim } from "./handlers/wallet";
import { handleRefer } from "./handlers/refer";
import { handleLeaderboard } from "./handlers/leaderboard";
import { handleAbout } from "./handlers/about";
import {
  handleWithdraw,
  handleClaimComingSoon,
} from "./handlers/withdraw";
import {
  isAdmin,
  handleAdmin,
  handleAdminStats,
  handleAdminAddChannel,
  handleAdminRemoveChannel,
  handleAdminRemoveChannelConfirm,
  handleAdminListChannels,
  handleAdminClaimMsg,
  handleAdminBroadcast,
  handleAdminUserInfo,
  handleAdminRefPoints,
  handleAdminDailyBonus,
  handleAdminMiniApp,
  handleAdminRemoveMiniApp,
  handleAdminRemoveMiniAppYes,
  handleAdminResetData,
  handleAdminResetDataYes,
  handleAdminBroadcastYes,
  handleAdminBroadcastSend,
  handleAdminInput,
  BROADCAST_PENDING,
} from "./handlers/admin";
import { getSetting } from "./utils";

const USER_MENU_BUTTONS = ["💵 Wallet", "👥 Refer", "🏆 Leaderboard", "ℹ️ About", "💸 Withdraw", "⬅️ Back to Menu"];
const ADMIN_MENU_BUTTONS = ["📊 Stats", "📢 Add Channel", "🗑️ Remove Channel", "📋 List Channels", "📝 Claim Msg", "📢 Broadcast", "🔍 User Info", "💰 Ref Points", "🎁 Daily Bonus", "🔗 Mini App URL", "🗑️ Remove Mini App URL", "🗑️ Reset Data"];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        await handleUpdate(update, env);
        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("Webhook error:", err);
        return new Response("Error", { status: 500 });
      }
    }

    if (url.pathname === "/") {
      return new Response("Snapbucks Telegram Bot is running!", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleUpdate(update: any, env: Env) {
  const supabase = getSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);
  const adminIds = loadAdminIds(env.ADMIN_IDS);

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env, supabase, adminIds);
    return;
  }

  if (update.message) {
    await handleMessage(update.message, env, supabase, adminIds);
  }
}

async function handleMessage(
  message: any,
  env: Env,
  supabase: any,
  adminIds: string[]
) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "";
  const messageId = message.message_id;

  const user = {
    id: userId,
    first_name: message.from.first_name,
    username: message.from.username,
  };

  // ===== COMMANDS =====
  if (text.startsWith("/start")) {
    const refCode = text.split(" ")[1] || undefined;
    await handleStart(env.BOT_TOKEN, supabase, chatId, userId, user, refCode, messageId);
    return;
  }

  if (text === "/menu" || text === "/help") {
    await deleteMessage(env.BOT_TOKEN, chatId, messageId);
    await handleMainMenu(env.BOT_TOKEN, supabase, chatId, 0);
    return;
  }

  if (text === "/admin") {
    if (isAdmin(userId, adminIds)) {
      await deleteMessage(env.BOT_TOKEN, chatId, messageId);
      await handleAdmin(env.BOT_TOKEN, supabase, chatId, userId, 0);
    } else {
      await sendMessage(env.BOT_TOKEN, { chat_id: chatId, text: "❌ Not authorized." });
    }
    return;
  }

  // ===== REPLY KEYBOARD BUTTONS (BEFORE handleAdminInput!) =====
  if (USER_MENU_BUTTONS.includes(text) || ADMIN_MENU_BUTTONS.includes(text)) {
    await deleteMessage(env.BOT_TOKEN, chatId, messageId);
  }

  // If Mini App is live, ALL menu buttons show launch message
  if (USER_MENU_BUTTONS.includes(text)) {
    const miniAppUrl = await getSetting(supabase, "mini_app_url");
    if (miniAppUrl) {
      await sendMessage(env.BOT_TOKEN, {
        chat_id: chatId,
        text: launchMessageText(),
        reply_markup: launchMessageKeyboard(miniAppUrl),
      });
      return;
    }
  }

  if (text === "💵 Wallet") { await handleWallet(env.BOT_TOKEN, supabase, chatId, userId, messageId); return; }
  if (text === "👥 Refer") { await handleRefer(env.BOT_TOKEN, supabase, chatId, userId, messageId); return; }
  if (text === "🏆 Leaderboard") { await handleLeaderboard(env.BOT_TOKEN, supabase, chatId, userId, messageId, 1); return; }
  if (text === "ℹ️ About") { await handleAbout(env.BOT_TOKEN, chatId, messageId); return; }
  if (text === "💸 Withdraw") { await handleWithdraw(env.BOT_TOKEN, supabase, chatId, userId, messageId); return; }
  if (text === "⬅️ Back to Menu") { await handleMainMenu(env.BOT_TOKEN, supabase, chatId, messageId); return; }

  // Admin buttons
  if (adminIds.includes(String(userId))) {
    if (text === "📊 Stats") { await handleAdminStats(env.BOT_TOKEN, supabase, chatId, "admin_stats"); return; }
    if (text === "📢 Add Channel") { await handleAdminAddChannel(env.BOT_TOKEN, supabase, chatId, userId, "admin_add_ch"); return; }
    if (text === "🗑️ Remove Channel") { await handleAdminRemoveChannel(env.BOT_TOKEN, supabase, chatId, userId, "admin_rm_ch"); return; }
    if (text === "📋 List Channels") { await handleAdminListChannels(env.BOT_TOKEN, supabase, chatId, "admin_list_ch"); return; }
    if (text === "📝 Claim Msg") { await handleAdminClaimMsg(env.BOT_TOKEN, supabase, chatId, userId, "admin_claim_msg"); return; }
    if (text === "📢 Broadcast") { await handleAdminBroadcast(env.BOT_TOKEN, supabase, chatId, userId, "admin_broadcast"); return; }
    if (text === "🔍 User Info") { await handleAdminUserInfo(env.BOT_TOKEN, supabase, chatId, userId, "admin_user"); return; }
    if (text === "💰 Ref Points") { await handleAdminRefPoints(env.BOT_TOKEN, supabase, chatId, userId, "admin_ref_pts"); return; }
    if (text === "🎁 Daily Bonus") { await handleAdminDailyBonus(env.BOT_TOKEN, supabase, chatId, userId, "admin_daily"); return; }
    if (text === "🔗 Mini App URL") { await handleAdminMiniApp(env.BOT_TOKEN, supabase, chatId, userId, "admin_miniapp"); return; }
    if (text === "🗑️ Remove Mini App URL") { await handleAdminRemoveMiniApp(env.BOT_TOKEN, supabase, chatId, "admin_rm_miniapp"); return; }
    if (text === "🗑️ Reset Data") { await handleAdminResetData(env.BOT_TOKEN, supabase, chatId, "admin_reset"); return; }
  }

  // ===== ADMIN TEXT INPUT =====
  if (adminIds.includes(String(userId)) && text && !text.startsWith("/")) {
    await handleAdminInput(env.BOT_TOKEN, supabase, chatId, userId, text);
    return;
  }

  // ===== ADMIN MESSAGE INPUT (for broadcast) =====
  if (adminIds.includes(String(userId))) {
    const { broadcastConfirmKeyboard } = await import("./keyboards");
    const { BROADCAST_PENDING } = await import("./handlers/admin");

    // Store the message reference (any type: text, photo, video, forwarded)
    BROADCAST_PENDING[userId] = {
      chatId: chatId,
      messageId: messageId,
    };

    // Copy message as preview (preserves ALL formatting)
    await copyMessage(env.BOT_TOKEN, chatId, chatId, messageId);

    // Send confirm buttons below preview
    await sendMessage(env.BOT_TOKEN, {
      chat_id: chatId,
      text: "📤 <b>Send this message to all users?</b>",
      reply_markup: broadcastConfirmKeyboard(),
    });

    return;
  }
}

async function handleCallbackQuery(
  callbackQuery: any,
  env: Env,
  supabase: any,
  adminIds: string[]
) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from.id;
  const messageId = callbackQuery.message?.message_id;
  const callbackQueryId = callbackQuery.id;

  const user = {
    id: userId,
    first_name: callbackQuery.from.first_name,
    username: callbackQuery.from.username,
  };

  // Welcome verify continue
  if (data === "verify_continue") {
    await handleVerifyContinue(env.BOT_TOKEN, supabase, chatId, userId, callbackQueryId, messageId);
    return;
  }

  // Wallet daily claim
  if (data === "claim_daily") {
    await handleDailyClaim(env.BOT_TOKEN, supabase, chatId, userId, callbackQueryId, messageId);
    return;
  }

  // Leaderboard load more
  if (data.startsWith("lb_page_")) {
    const page = parseInt(data.replace("lb_page_", "")) || 1;
    await handleLeaderboard(env.BOT_TOKEN, supabase, chatId, userId, messageId, page);
    return;
  }

  // Withdraw claim coming soon
  if (data === "claim_coming_soon") {
    await handleClaimComingSoon(env.BOT_TOKEN, chatId, callbackQueryId);
    return;
  }

  // Admin remove channel confirm
  if (data.startsWith("admin_rm_ch_")) {
    if (isAdmin(userId, adminIds)) {
      await handleAdminRemoveChannelConfirm(env.BOT_TOKEN, supabase, chatId, data.replace("admin_rm_ch_", ""), callbackQueryId);
    }
    return;
  }

  // Admin remove Mini App URL confirm
  if (data === "admin_rm_miniapp_yes") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminRemoveMiniAppYes(env.BOT_TOKEN, supabase, chatId, callbackQueryId);
    }
    return;
  }

  // Admin broadcast yes
  if (data === "admin_broadcast_yes") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminBroadcastYes(env.BOT_TOKEN, supabase, chatId, callbackQueryId);
    }
    return;
  }

  // Admin broadcast send
  if (data === "broadcast_send") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminBroadcastSend(env.BOT_TOKEN, supabase, chatId, userId, callbackQueryId);
    }
    return;
  }

  // Admin reset data yes
  if (data === "admin_reset_yes") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminResetDataYes(env.BOT_TOKEN, supabase, chatId, callbackQueryId);
    }
    return;
  }

  // Admin panel back
  if (data === "admin") {
    if (isAdmin(userId, adminIds)) {
      await handleAdmin(env.BOT_TOKEN, supabase, chatId, userId, messageId);
    }
    return;
  }

  // Noop
  if (data === "noop") {
    await answerCallbackQuery(env.BOT_TOKEN, { callback_query_id: callbackQueryId });
    return;
  }
}
