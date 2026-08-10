import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, copyMessage, deleteMessage, answerCallbackQuery } from "../telegram";
import {
  adminPanelKeyboard,
  backToAdminInline,
  launchMessageText,
  launchMessageKeyboard,
  confirmRemoveMiniAppKeyboard,
  confirmBroadcastKeyboard,
  confirmResetDataKeyboard,
  broadcastConfirmKeyboard,
  broadcastSuccessKeyboard,
} from "../keyboards";
import { getSetting, setSetting } from "../utils";

const ADMIN_STATE: Record<number, { action: string; extra?: any }> = {};

export interface BroadcastPending {
  chatId: number;
  messageId: number;
}

export const BROADCAST_PENDING: Record<number, BroadcastPending> = {};

export function isAdmin(userId: number, adminIds: string[]): boolean {
  return adminIds.includes(String(userId));
}

export async function handleAdmin(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  messageId?: number
) {
  if (messageId) {
    await deleteMessage(token, chatId, messageId);
  }

  await sendMessage(token, {
    chat_id: chatId,
    text: "⚙️ <b>Admin Panel</b>\n\nChoose an option:",
    reply_markup: adminPanelKeyboard(),
  });
}

export async function handleAdminStats(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  const { count: totalUsers } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });

  const today = new Date().toISOString().split("T")[0];
  const { count: newToday } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .gte("created_at", today);

  const { data: allUsers } = await supabase
    .from("users")
    .select("balance");

  const totalSnap = allUsers?.reduce((sum, u) => sum + (u.balance || 0), 0) || 0;

  const { count: eligible } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .gte("referral_count", 5);

  await sendMessage(token, {
    chat_id: chatId,
    text: `📊 <b>Bot Statistics</b>

👥 Total Users: <b>${totalUsers || 0}</b>
📅 New Today: <b>${newToday || 0}</b>
🪙 Total SNAP: <b>${totalSnap}</b>
✅ Eligible Users: <b>${eligible || 0}</b>`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminAddChannel(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  ADMIN_STATE[userId] = { action: "add_channel" };

  await sendMessage(token, {
    chat_id: chatId,
    text: `📢 <b>Add Channel</b>

Send channel details in this format:
<code>channel_id channel_username</code>

Example: <code>-1001234567890 mychannel</code>

Get channel_id by adding @RawDataBot to your channel.`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminRemoveChannel(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  const { data: channels } = await supabase
    .from("channels")
    .select("id, channel_username, channel_id")
    .eq("is_active", true);

  if (!channels || channels.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "📋 No channels configured yet.",
      reply_markup: backToAdminInline(),
    });
    return;
  }

  let text = "🗑️ <b>Remove Channel</b>\n\nSelect a channel to remove:\n\n";
  const buttons: any[] = [];

  for (const ch of channels) {
    text += `• @${ch.channel_username} (ID: ${ch.channel_id})\n`;
    buttons.push([
      {
        text: `🗑️ Remove @${ch.channel_username}`,
        callback_data: `admin_rm_ch_${ch.id}`,
      },
    ]);
  }

  buttons.push([{ text: "⬅️ Back to Admin", callback_data: "admin" }]);

  await sendMessage(token, {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleAdminRemoveChannelConfirm(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  channelId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "✅ Channel removed!",
  });

  await supabase.from("channels").delete().eq("id", channelId);

  await sendMessage(token, {
    chat_id: chatId,
    text: "✅ Channel removed successfully!",
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminListChannels(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  const { data: channels } = await supabase
    .from("channels")
    .select("channel_username, channel_id, channel_title")
    .eq("is_active", true);

  let text = "📋 <b>Active Channels</b>\n\n";

  if (!channels || channels.length === 0) {
    text += "No channels configured yet.";
  } else {
    for (const ch of channels) {
      text += `• @${ch.channel_username}`;
      if (ch.channel_title) text += ` (${ch.channel_title})`;
      text += ` [ID: ${ch.channel_id}]\n`;
    }
  }

  await sendMessage(token, {
    chat_id: chatId,
    text,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminClaimMsg(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  ADMIN_STATE[userId] = { action: "claim_msg" };

  const current = await getSetting(supabase, "claim_message");

  await sendMessage(token, {
    chat_id: chatId,
    text: `📝 <b>Change Claim Message</b>

Current message:
<i>${current || "Not set"}</i>

Send the new claim message:`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminBroadcast(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  ADMIN_STATE[userId] = { action: "broadcast" };

  await sendMessage(token, {
    chat_id: chatId,
    text: "📢 <b>Broadcast Message</b>\n\nSend me the message to broadcast.\n\n<b>Supported formats:</b>\n• Text (bold, italic, quote, code)\n• Photo with caption\n• Video with caption\n• Forwarded message\n\n<i>Send /cancel to cancel.</i>",
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminUserInfo(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  ADMIN_STATE[userId] = { action: "user_info" };

  await sendMessage(token, {
    chat_id: chatId,
    text: "🔍 <b>User Details</b>\n\nSend the Telegram User ID to look up:",
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminRefPoints(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  ADMIN_STATE[userId] = { action: "ref_points" };

  const current = await getSetting(supabase, "per_referral_points");

  await sendMessage(token, {
    chat_id: chatId,
    text: `💰 <b>Change Referral Points</b>

Current: <b>${current || "100"}</b> SNAP per referral

Send the new value:`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminDailyBonus(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  ADMIN_STATE[userId] = { action: "daily_bonus" };

  const current = await getSetting(supabase, "daily_bonus");

  await sendMessage(token, {
    chat_id: chatId,
    text: `🎁 <b>Change Daily Bonus</b>

Current: <b>${current || "10"}</b> SNAP daily

Send the new value:`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminMiniApp(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  ADMIN_STATE[userId] = { action: "mini_app_url" };

  const current = await getSetting(supabase, "mini_app_url");

  await sendMessage(token, {
    chat_id: chatId,
    text: `🔗 <b>Set Mini App URL</b>

Current: ${current || "Not set"}

Send the Mini App URL:`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminRemoveMiniApp(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  const current = await getSetting(supabase, "mini_app_url");

  if (!current) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "ℹ️ No Mini App URL is set currently.",
      reply_markup: backToAdminInline(),
    });
    return;
  }

  await sendMessage(token, {
    chat_id: chatId,
    text: `⚠️ <b>Remove Mini App URL?</b>\n\nCurrent URL: <code>${current}</code>\n\nYe action normal bot flow wapas kar dega.`,
    reply_markup: confirmRemoveMiniAppKeyboard(),
  });
}

export async function handleAdminRemoveMiniAppYes(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "✅ Mini App URL removed!",
  });

  await supabase.from("settings").delete().eq("key", "mini_app_url");

  await sendMessage(token, {
    chat_id: chatId,
    text: "✅ Mini App URL removed!\n\nBot will now show normal menu flow.",
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminResetData(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  await sendMessage(token, {
    chat_id: chatId,
    text: `⚠️ <b>Are you sure? Ye sab data delete kar dega:</b>\n\n• Users\n• Referrals\n• Channels\n\n<b>Settings safe rahenge!</b>\n<b>Ye action UNDO nahi hoga!</b>`,
    reply_markup: confirmResetDataKeyboard(),
  });
}

export async function handleAdminResetDataYes(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "✅ All data reset!",
  });

  await supabase.from("users").delete().neq("telegram_id", 0);
  await supabase.from("referrals").delete().neq("referrer_id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("channels").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  await sendMessage(token, {
    chat_id: chatId,
    text: "✅ <b>All data has been reset!</b>\n\n• Users: Deleted\n• Referrals: Deleted\n• Channels: Deleted\n• Settings: Kept ✅",
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminBroadcastYes(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "📢 Broadcasting...",
  });

  const url = await getSetting(supabase, "mini_app_url");

  if (!url) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ No Mini App URL found. Set it first.",
      reply_markup: backToAdminInline(),
    });
    return;
  }

  const { data: users } = await supabase
    .from("users")
    .select("telegram_id");

  let sent = 0;
  let failed = 0;

  for (const u of users || []) {
    try {
      const res = await sendMessage(token, {
        chat_id: u.telegram_id,
        text: launchMessageText(),
        reply_markup: launchMessageKeyboard(url),
      });
      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }

  await sendMessage(token, {
    chat_id: chatId,
    text: `📢 <b>Broadcast Complete!</b>\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminBroadcastSend(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  const pending = BROADCAST_PENDING[userId];
  if (!pending) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "❌ No pending broadcast found.",
      show_alert: true,
    });
    return;
  }

  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "📤 Broadcasting...",
  });

  const { data: users } = await supabase
    .from("users")
    .select("telegram_id");

  if (!users || users.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ No users to broadcast to.",
      reply_markup: backToAdminInline(),
    });
    delete BROADCAST_PENDING[userId];
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const u of users) {
    try {
      const res = await copyMessage(token, u.telegram_id, pending.chatId, pending.messageId);
      if (res && res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }

  delete BROADCAST_PENDING[userId];

  await sendMessage(token, {
    chat_id: chatId,
    text: `📢 <b>Broadcast Complete!</b>\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`,
    reply_markup: broadcastSuccessKeyboard(),
  });
}

// ============ CAMPAIGN MANAGEMENT ============

export async function handleAdminCreateCampaign(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId?: string
) {
  if (callbackQueryId) await answerCallbackQuery(token, { callback_query_id: callbackQueryId });
  ADMIN_STATE[userId] = { action: "create_campaign_title" };
  await sendMessage(token, {
    chat_id: chatId,
    text: "📢 <b>Create Campaign</b>\n\nSend the campaign title:",
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminListCampaigns(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId?: string
) {
  if (callbackQueryId) await answerCallbackQuery(token, { callback_query_id: callbackQueryId });

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, title, project_name, status, rewards_per_user, start_date, end_date")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!campaigns || campaigns.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "📋 No campaigns yet.",
      reply_markup: backToAdminInline(),
    });
    return;
  }

  let text = "📋 <b>Active Campaigns</b>\n\n";
  for (const c of campaigns) {
    const status = c.status === "active" ? "🟢" : c.status === "paused" ? "⏸️" : "🔴";
    text += `${status} <b>${c.title}</b>\n`;
    text += `   Project: ${c.project_name}\n`;
    text += `   Reward: ${c.rewards_per_user} GRAM/user\n`;
    text += `   ID: <code>${c.id.slice(0, 8)}</code>\n\n`;
  }

  await sendMessage(token, {
    chat_id: chatId,
    text,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminAddTask(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId?: string
) {
  if (callbackQueryId) await answerCallbackQuery(token, { callback_query_id: callbackQueryId });
  ADMIN_STATE[userId] = { action: "add_task_campaign_id" };
  await sendMessage(token, {
    chat_id: chatId,
    text: "➕ <b>Add Task to Campaign</b>\n\nSend the campaign ID (first 8 chars):",
    reply_markup: backToAdminInline(),
  });
}

// Handle admin text inputs
export async function handleAdminInput(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  text: string
): Promise<boolean> {
  const state = ADMIN_STATE[userId];
  if (!state) return false;

  delete ADMIN_STATE[userId];

  switch (state.action) {
    case "add_channel": {
      const parts = text.trim().split(/\s+/);
      if (parts.length < 2) {
        await sendMessage(token, {
          chat_id: chatId,
          text: "❌ Invalid format. Use: channel_id channel_username",
        });
        return true;
      }

      const channelId = parseInt(parts[0]);
      const channelUsername = parts[1].replace("@", "");

      if (isNaN(channelId)) {
        await sendMessage(token, {
          chat_id: chatId,
          text: "❌ Invalid channel ID.",
        });
        return true;
      }

      const { error } = await supabase.from("channels").insert({
        channel_id: channelId,
        channel_username: channelUsername,
        is_active: true,
      });

      if (error) {
        await sendMessage(token, {
          chat_id: chatId,
          text: `❌ Error: ${error.message}`,
        });
      } else {
        await sendMessage(token, {
          chat_id: chatId,
          text: `✅ Channel @${channelUsername} added successfully!`,
          reply_markup: backToAdminInline(),
        });
      }
      return true;
    }

    case "claim_msg": {
      await setSetting(supabase, "claim_message", text);
      await sendMessage(token, {
        chat_id: chatId,
        text: "✅ Claim message updated!",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "user_info": {
      const targetId = parseInt(text.trim());
      if (isNaN(targetId)) {
        await sendMessage(token, {
          chat_id: chatId,
          text: "❌ Invalid user ID.",
        });
        return true;
      }

      const { data: targetUser } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_id", targetId)
        .single();

      if (!targetUser) {
        await sendMessage(token, {
          chat_id: chatId,
          text: "❌ User not found.",
        });
        return true;
      }

      await sendMessage(token, {
        chat_id: chatId,
        text: `🔍 <b>User Details</b>

👤 Name: ${targetUser.first_name}
🆔 User ID: <code>${targetUser.telegram_id}</code>
📛 Username: ${targetUser.username ? "@" + targetUser.username : "N/A"}
🪙 Balance: ${targetUser.balance} SNAP
👥 Referrals: ${targetUser.referral_count}
🎟️ Ref Code: <code>${targetUser.referral_code}</code>
✅ Eligible: ${targetUser.eligible ? "Yes" : "No"}
📅 Joined: ${new Date(targetUser.created_at).toLocaleDateString()}`,
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "ref_points": {
      const val = parseInt(text.trim());
      if (isNaN(val) || val < 0) {
        await sendMessage(token, {
          chat_id: chatId,
          text: "❌ Invalid number.",
        });
        return true;
      }

      await setSetting(supabase, "per_referral_points", String(val));
      await sendMessage(token, {
        chat_id: chatId,
        text: `✅ Referral points updated to ${val} SNAP!`,
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "daily_bonus": {
      const val = parseInt(text.trim());
      if (isNaN(val) || val < 0) {
        await sendMessage(token, {
          chat_id: chatId,
          text: "❌ Invalid number.",
        });
        return true;
      }

      await setSetting(supabase, "daily_bonus", String(val));
      await sendMessage(token, {
        chat_id: chatId,
        text: `✅ Daily bonus updated to ${val} SNAP!`,
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "mini_app_url": {
      const url = text.trim();
      if (!url.startsWith("http")) {
        await sendMessage(token, {
          chat_id: chatId,
          text: "❌ Invalid URL.",
        });
        return true;
      }

      await setSetting(supabase, "mini_app_url", url);

      const { count } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true });

      await sendMessage(token, {
        chat_id: chatId,
        text: `✅ <b>Mini App URL Updated!</b>\n\n🔗 <code>${url}</code>\n\n👥 Total Users: <b>${count || 0}</b>\n\nKya aap ye message broadcast karna chahte hain sabhi users ko?`,
        reply_markup: confirmBroadcastKeyboard(),
      });
      return true;
    }

    // ============ CAMPAIGN CREATION FLOW ============
    case "create_campaign_title": {
      ADMIN_STATE[userId] = { action: "create_campaign_project", extra: { title: text.trim() } };
      await sendMessage(token, {
        chat_id: chatId,
        text: "📝 Send the project name (e.g., Hamster Kombat):",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "create_campaign_project": {
      const prev = (state as any).extra || {};
      ADMIN_STATE[userId] = { action: "create_campaign_desc", extra: { ...prev, project: text.trim() } };
      await sendMessage(token, {
        chat_id: chatId,
        text: "📝 Send the campaign description:",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "create_campaign_desc": {
      const prev = (state as any).extra || {};
      ADMIN_STATE[userId] = { action: "create_campaign_reward", extra: { ...prev, description: text.trim() } };
      await sendMessage(token, {
        chat_id: chatId,
        text: "💰 Send reward per user (in GRAM):",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "create_campaign_reward": {
      const prev = (state as any).extra || {};
      const reward = parseInt(text.trim());
      if (isNaN(reward) || reward <= 0) {
        await sendMessage(token, { chat_id: chatId, text: "❌ Invalid number." });
        ADMIN_STATE[userId] = { action: "create_campaign_reward", extra: prev };
        return true;
      }
      ADMIN_STATE[userId] = { action: "create_campaign_duration", extra: { ...prev, reward } };
      await sendMessage(token, {
        chat_id: chatId,
        text: "📅 Send duration in days (e.g., 30):",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "create_campaign_duration": {
      const prev = (state as any).extra || {};
      const duration = parseInt(text.trim());
      if (isNaN(duration) || duration <= 0) {
        await sendMessage(token, { chat_id: chatId, text: "❌ Invalid number." });
        ADMIN_STATE[userId] = { action: "create_campaign_duration", extra: prev };
        return true;
      }

      const { title, project, description, reward } = prev;
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + duration);

      const { data: campaign, error } = await supabase
        .from("campaigns")
        .insert({
          title,
          project_name: project,
          description,
          reward_token: "GRAM",
          rewards_per_user: reward,
          total_budget: reward * 1000,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          status: "active",
        })
        .select()
        .single();

      delete ADMIN_STATE[userId];

      if (error) {
        await sendMessage(token, { chat_id: chatId, text: `❌ Error: ${error.message}` });
      } else {
        await sendMessage(token, {
          chat_id: chatId,
          text: `✅ <b>Campaign Created!</b>\n\n📌 ${title}\n🏢 ${project}\n💰 ${reward} GRAM/user\n📅 ${duration} days\n🆔 <code>${campaign.id.slice(0, 8)}</code>\n\nNow add tasks using "➕ Add Task" button.`,
          reply_markup: backToAdminInline(),
        });
      }
      return true;
    }

    case "add_task_campaign_id": {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("id, title")
        .like("id", text.trim() + "%")
        .single();

      if (!campaign) {
        await sendMessage(token, { chat_id: chatId, text: "❌ Campaign not found." });
        return true;
      }

      ADMIN_STATE[userId] = { action: "add_task_title", extra: { campaignId: campaign.id } };
      await sendMessage(token, {
        chat_id: chatId,
        text: `📋 Adding task to: <b>${campaign.title}</b>\n\nSend the task title:`,
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "add_task_title": {
      const prev = (state as any).extra || {};
      ADMIN_STATE[userId] = { action: "add_task_type", extra: { ...prev, title: text.trim() } };
      await sendMessage(token, {
        chat_id: chatId,
        text: "📝 Send task type:\n• <code>join_channel</code>\n• <code>follow_x</code>\n• <code>refer_friends</code>\n• <code>visit_link</code>\n• <code>custom</code>",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "add_task_type": {
      const validTypes = ["join_channel", "follow_x", "refer_friends", "visit_link", "custom"];
      if (!validTypes.includes(text.trim())) {
        await sendMessage(token, { chat_id: chatId, text: "❌ Invalid type. Use: join_channel, follow_x, refer_friends, visit_link, or custom" });
        return true;
      }
      const prev = (state as any).extra || {};
      ADMIN_STATE[userId] = { action: "add_task_url", extra: { ...prev, type: text.trim() } };
      await sendMessage(token, {
        chat_id: chatId,
        text: "🔗 Send task URL (or channel username):",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "add_task_url": {
      const prev = (state as any).extra || {};
      ADMIN_STATE[userId] = { action: "add_task_reward", extra: { ...prev, url: text.trim() } };
      await sendMessage(token, {
        chat_id: chatId,
        text: "💰 Send task reward (GRAM):",
        reply_markup: backToAdminInline(),
      });
      return true;
    }

    case "add_task_reward": {
      const prev = (state as any).extra || {};
      const reward = parseInt(text.trim());
      if (isNaN(reward) || reward <= 0) {
        await sendMessage(token, { chat_id: chatId, text: "❌ Invalid number." });
        return true;
      }

      const { error } = await supabase.from("campaign_tasks").insert({
        campaign_id: prev.campaignId,
        title: prev.title,
        task_type: prev.type,
        task_url: prev.url,
        reward_amount: reward,
      });

      delete ADMIN_STATE[userId];

      if (error) {
        await sendMessage(token, { chat_id: chatId, text: `❌ Error: ${error.message}` });
      } else {
        await sendMessage(token, {
          chat_id: chatId,
          text: `✅ Task added!\n\n📌 ${prev.title}\n📝 ${prev.type}\n🔗 ${prev.url}\n💰 ${reward} GRAM`,
          reply_markup: backToAdminInline(),
        });
      }
      return true;
    }

    default:
      return false;
  }
}
