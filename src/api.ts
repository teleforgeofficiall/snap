import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { creditReferrerCommission, getSetting, setSetting } from "./utils";

// Verify Telegram WebApp initData
export function verifyTelegramInit(initData: string, botToken: string): any {
  try {
    const data = new URLSearchParams(initData);
    const hash = data.get("hash");
    data.delete("hash");

    const dataCheckString = Array.from(data.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash !== hash) {
      return null;
    }

    const userStr = data.get("user");
    if (userStr) {
      return JSON.parse(userStr);
    }
    return null;
  } catch {
    return null;
  }
}

// Get user from initData
export async function getUserFromInitData(
  supabase: SupabaseClient,
  initData: string,
  botToken: string
) {
  const tgUser = verifyTelegramInit(initData, botToken);
  if (!tgUser || !tgUser.id) {
    return null;
  }

  const { data: user, error } = await supabase
    .from("users")
    .select("id, telegram_id, first_name, username, balance, gram, referral_code, referred_by, referral_count, daily_claim_date, is_admin, eligible, created_at")
    .eq("telegram_id", tgUser.id)
    .single();

  if (error || !user) return null;
  // Pass Telegram user data for client display
  user.photo_url = tgUser.photo_url || null;
  if (!user.first_name && tgUser.first_name) user.first_name = tgUser.first_name;
  if (!user.username && tgUser.username) user.username = tgUser.username;
  return user;
}

// Handle API routes
export async function handleApi(
  req: any,
  res: any,
  supabase: SupabaseClient,
  botToken: string
) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return true;
  }

  // Auth middleware - get user from initData
  const authHeader = req.headers.authorization;
  const initData = authHeader?.replace("Bearer ", "") || "";

  // Public routes (no auth needed)
  if (path === "/api/health") {
    json(res, 200, { status: "ok", timestamp: Date.now() });
    return true;
  }

  // Public: Upload image to Supabase Storage
  if (path === "/api/upload/image" && method === "POST") {
    const body = await readBody(req);
    const { image, filename } = body;
    if (!image) return json(res, 400, { error: "No image data" });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const ext = filename?.split(".").pop() || "png";
    const safeName = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const uploadRes = await fetch(
      `https://xqixkprkyfgpqaqmxmab.supabase.co/storage/v1/object/task-images/${safeName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": `image/${ext === "jpg" ? "jpeg" : ext}`,
          "Authorization": `Bearer ${process.env.SUPABASE_KEY || ""}`,
          "apikey": process.env.SUPABASE_KEY || "",
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return json(res, 500, { error: "Upload failed: " + errText });
    }

    const publicUrl = `https://xqixkprkyfgpqaqmxmab.supabase.co/storage/v1/object/public/task-images/${safeName}`;
    json(res, 200, { url: publicUrl });
    return true;
  }

  // Public: Checkin rewards config
  if (path === "/api/checkin/rewards" && method === "GET") {
    const days: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const val = await getSetting(supabase, `checkin_day_${i}`);
      days.push(parseInt(val || "10"));
    }
    json(res, 200, { days });
    return true;
  }

  // Public: Ads config (for Mini App to know AdsGram zone)
  if (path === "/api/ads/config" && method === "GET") {
    const blockId = await getSetting(supabase, "adsgram_block_id");
    json(res, 200, { block_id: blockId || "" });
    return true;
  }

  // ============ ADMIN API ROUTES (password auth, no TG init needed) ============
  if (path?.startsWith("/api/admin")) {
    return await handleAdminApi(req, res, supabase, path, method);
  }

  // All other routes need auth
  if (!initData || initData.length < 10) {
    json(res, 401, { error: "No initData provided" });
    return true;
  }

  const user = await getUserFromInitData(supabase, initData, botToken);
  if (!user) {
    json(res, 401, { error: "Unauthorized - user not found or invalid initData" });
    return true;
  }

  // ============ USER ROUTES ============
  if (path === "/api/user/me" && method === "GET") {
    // Calculate rank
    const { count: higherCount } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .gt("balance", user.balance || 0);

    json(res, 200, {
      id: user.id,
      telegram_id: user.telegram_id,
      first_name: user.first_name,
      username: user.username,
      balance: user.balance || 0,
      gram: user.gram || 0,
      referral_code: user.referral_code,
      referral_count: user.referral_count || 0,
      eligible: user.eligible || false,
      created_at: user.created_at,
      rank: (higherCount || 0) + 1,
      photo_url: user.photo_url || null,
    });
    return true;
  }

  // ============ BALANCE ROUTES ============
  if (path === "/api/balance" && method === "GET") {
    json(res, 200, {
      snap: user.balance || 0,
      gram: user.gram || 0,
    });
    return true;
  }

  // ============ CHECKIN ROUTES ============
  if (path === "/api/checkin/status" && method === "GET") {
    const { data: lastCheckin } = await supabase
      .from("checkins")
      .select("created_at, streak")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const { count: totalCheckins } = await supabase
      .from("checkins")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    // Calculate 24h cooldown
    let next_claim_at = null;
    let checked_today = false;
    if (lastCheckin) {
      const lastTime = new Date(lastCheckin.created_at).getTime();
      const nextTime = lastTime + 24 * 60 * 60 * 1000;
      if (Date.now() < nextTime) {
        next_claim_at = new Date(nextTime).toISOString();
        checked_today = true;
      }
    }

    json(res, 200, {
      checked_today,
      total_checkins: totalCheckins || 0,
      streak: lastCheckin?.streak || 0,
      next_claim_at,
    });
    return true;
  }

  if (path === "/api/checkin/claim" && method === "POST") {
    // 24-hour cooldown check
    const { data: lastCheckin } = await supabase
      .from("checkins")
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (lastCheckin) {
      const lastTime = new Date(lastCheckin.created_at).getTime();
      const nextTime = lastTime + 24 * 60 * 60 * 1000;
      if (Date.now() < nextTime) {
        const nextClaim = new Date(nextTime);
        const hours = Math.floor((nextTime - Date.now()) / (1000 * 60 * 60));
        const mins = Math.floor(((nextTime - Date.now()) % (1000 * 60 * 60)) / (1000 * 60));
        json(res, 400, { error: `Next claim in ${hours}h ${mins}m`, next_claim_at: nextClaim.toISOString() });
        return true;
      }
    }

    const today = new Date().toISOString().split("T")[0];

    const { count: totalCheckins } = await supabase
      .from("checkins")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const streak = (totalCheckins || 0) + 1;
    const dayIdx = Math.min(streak, 7);
    const rewardStr = await getSetting(supabase, `checkin_day_${dayIdx}`);
    const reward = parseInt(rewardStr || "10");

    await supabase.from("checkins").insert({
      user_id: user.id,
      checkin_date: today,
      streak,
      reward_earned: reward,
    });

    await supabase
      .from("users")
      .update({ balance: (user.balance || 0) + reward })
      .eq("id", user.id);

    await supabase.from("transactions").insert({
      user_id: user.id,
      type: "daily_checkin",
      amount: reward,
      token: "SNAP",
      description: `Day ${streak} check-in`,
    });

    const nextClaimAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    json(res, 200, {
      success: true,
      reward,
      streak,
      new_balance: (user.balance || 0) + reward,
      next_claim_at: nextClaimAt,
    });
    return true;
  }

  // ============ TASK ROUTES ============
  if (path === "/api/tasks" && method === "GET") {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    const { data: completions } = await supabase
      .from("task_completions")
      .select("task_id, status")
      .eq("user_id", user.id);

    const { data: submissions } = await supabase
      .from("task_submissions")
      .select("task_id, status")
      .eq("user_id", user.id);

    const completionMap: Record<string, string> = {};
    completions?.forEach((c: any) => { completionMap[c.task_id] = c.status; });

    const submissionMap: Record<string, string> = {};
    submissions?.forEach((s: any) => { submissionMap[s.task_id] = s.status; });

    const tasksWithStatus = tasks?.map((t: any) => ({
      ...t,
      user_status: completionMap[t.id] || submissionMap[t.id] || "not_started",
    })) || [];

    json(res, 200, { tasks: tasksWithStatus });
    return true;
  }

  if (path?.startsWith("/api/tasks/") && path?.endsWith("/complete") && method === "POST") {
    const taskId = path.split("/")[3];

    const { data: existing } = await supabase
      .from("task_completions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("task_id", taskId)
      .single();

    if (existing && existing.status === "completed") {
      json(res, 400, { error: "Task already completed" });
      return true;
    }

    const { data: existingSub } = await supabase
      .from("task_submissions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("task_id", taskId)
      .single();

    if (existingSub) {
      json(res, 400, { error: "Task already submitted" });
      return true;
    }

    const { data: task } = await supabase
      .from("tasks")
      .select("reward_amount, reward_token")
      .eq("id", taskId)
      .single();

    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    await supabase.from("task_completions").upsert({
      user_id: user.id,
      task_id: taskId,
      status: "completed",
      completed_at: new Date().toISOString(),
      reward_earned: task.reward_amount,
    });

    if (task.reward_token === "SNAP") {
      await supabase
        .from("users")
        .update({ balance: (user.balance || 0) + task.reward_amount })
        .eq("id", user.id);

      await supabase.from("transactions").insert({
        user_id: user.id,
        type: "task_reward",
        amount: task.reward_amount,
        token: "SNAP",
        description: `Task completed`,
      });

      creditReferrerCommission(supabase, user.id, task.reward_amount, "snap");
    } else {
      await supabase
        .from("users")
        .update({ gram: (user.gram || 0) + task.reward_amount })
        .eq("id", user.id);

      await supabase.from("transactions").insert({
        user_id: user.id,
        type: "task_reward",
        amount: task.reward_amount,
        token: "GRAM",
        description: `Task completed`,
      });

      creditReferrerCommission(supabase, user.id, task.reward_amount, "gram");
    }

    // Auto-pause ad task if target reached
    {
      const { data: fullTask } = await supabase.from("tasks").select("target_completions, current_completions, ad_status").eq("id", taskId).single();
      if (fullTask && fullTask.target_completions > 0) {
        const newCount = (fullTask.current_completions || 0) + 1;
        await supabase.from("tasks").update({ current_completions: newCount }).eq("id", taskId);
        if (newCount >= fullTask.target_completions && fullTask.ad_status === "active") {
          await supabase.from("tasks").update({ is_active: false, ad_status: "paused" }).eq("id", taskId);
        }
      }
    }

    json(res, 200, {
      success: true,
      reward: task.reward_amount,
      token: task.reward_token,
    });
    return true;
  }

  // --- Task submission (screenshots / fill info) ---
  const submitMatch = path?.match(/^\/api\/tasks\/([a-f0-9-]+)\/submit$/);
  if (submitMatch && method === "POST") {
    const taskId = submitMatch[1];
    const body = await readBody(req);
    const { data: existing } = await supabase.from("task_submissions").select("id, status").eq("user_id", user.id).eq("task_id", taskId).single();
    if (existing && (existing.status === "pending" || existing.status === "approved")) {
      json(res, 400, { error: "Already submitted" });
      return true;
    }
    const { data: task } = await supabase.from("tasks").select("id, task_type").eq("id", taskId).single();
    if (!task) { json(res, 404, { error: "Task not found" }); return true; }

    const { data: sub, error: subErr } = await supabase.from("task_submissions").upsert({
      task_id: taskId, user_id: user.id, status: "pending",
      submitted_data: body.submitted_data || null,
    }, { onConflict: "task_id,user_id" }).select("id").single();

    if (subErr) { json(res, 400, { error: subErr.message }); return true; }

    // Save submitted images
    if (body.images && Array.isArray(body.images) && sub) {
      const imageRows = body.images.map((url: string, i: number) => ({
        submission_id: sub.id, image_url: url, image_type: "screenshot", sort_order: i,
      }));
      await supabase.from("task_submission_images").insert(imageRows);
    }

    json(res, 200, { success: true, status: "pending" });
    return true;
  }

  // --- Get user's submission status for a task ---
  const subStatusMatch = path?.match(/^\/api\/tasks\/([a-f0-9-]+)\/submission$/);
  if (subStatusMatch && method === "GET") {
    const taskId = subStatusMatch[1];
    const { data: sub } = await supabase.from("task_submissions").select("id, status, admin_note, reviewed_at").eq("user_id", user.id).eq("task_id", taskId).single();
    json(res, 200, { submission: sub || null });
    return true;
  }

  // --- Verify Telegram Channel Join ---
  const verifyJoinMatch = path?.match(/^\/api\/tasks\/([a-f0-9-]+)\/verify-join$/);
  if (verifyJoinMatch && method === "POST") {
    const taskId = verifyJoinMatch[1];

    const { data: task } = await supabase
      .from("tasks")
      .select("id, task_type, channel_username, reward_amount, reward_token")
      .eq("id", taskId)
      .single();

    if (!task) return json(res, 404, { error: "Task not found" });
    if (task.task_type !== "join_channel") return json(res, 400, { error: "Not a channel task" });
    if (!task.channel_username) return json(res, 400, { error: "No channel configured" });

    // Check if already completed
    const { data: existing } = await supabase
      .from("task_completions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("task_id", taskId)
      .single();
    if (existing && existing.status === "completed") {
      return json(res, 400, { error: "Already completed" });
    }

    // Check membership via Telegram API
    const channel = task.channel_username.replace("@", "").replace("https://t.me/", "").replace("http://t.me/", "").replace("t.me/", "");
    const memberRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: "@" + channel, user_id: user.telegram_id }),
      }
    );
    const memberData = await memberRes.json();

    if (!memberData.ok) {
      return json(res, 400, { error: "Cannot verify membership. Make sure the bot is admin in the channel." });
    }

    const status = memberData.result?.status;
    const isMember = ["member", "administrator", "creator"].includes(status);

    if (!isMember) {
      return json(res, 400, { error: "You have not joined this channel yet. Please join and try again." });
    }

    // Credit reward
    await supabase.from("task_completions").upsert({
      user_id: user.id,
      task_id: taskId,
      status: "completed",
      completed_at: new Date().toISOString(),
      reward_earned: task.reward_amount,
    }, { onConflict: "user_id,task_id" });

    if (task.reward_token === "SNAP") {
      await supabase.from("users").update({ balance: (user.balance || 0) + task.reward_amount }).eq("id", user.id);
    } else {
      await supabase.from("users").update({ gram: (user.gram || 0) + task.reward_amount }).eq("id", user.id);
    }

    await supabase.from("transactions").insert({
      user_id: user.id,
      type: "task_reward",
      amount: task.reward_amount,
      token: task.reward_token,
      description: `Channel join verified`,
    });

    // Auto-pause ad task if target reached
    {
      const { data: fullTask } = await supabase.from("tasks").select("target_completions, current_completions, ad_status").eq("id", taskId).single();
      if (fullTask && fullTask.target_completions > 0) {
        const newCount = (fullTask.current_completions || 0) + 1;
        await supabase.from("tasks").update({ current_completions: newCount }).eq("id", taskId);
        if (newCount >= fullTask.target_completions && fullTask.ad_status === "active") {
          await supabase.from("tasks").update({ is_active: false, ad_status: "paused" }).eq("id", taskId);
        }
      }
    }

    json(res, 200, { success: true, reward: task.reward_amount, token: task.reward_token });
    return true;
  }

  // ============ CAMPAIGN ROUTES ============
  if (path === "/api/campaigns" && method === "GET") {
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("*, campaign_tasks(*)")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    const { data: participations } = await supabase
      .from("campaign_participants")
      .select("campaign_id, status")
      .eq("user_id", user.id);

    const participationMap: Record<string, string> = {};
    participations?.forEach((p: any) => {
      participationMap[p.campaign_id] = p.status;
    });

    const campaignsWithStatus = campaigns?.map((c: any) => ({
      ...c,
      user_status: participationMap[c.id] || "not_joined",
    })) || [];

    // Get real participant counts
    for (const c of campaignsWithStatus) {
      const { count } = await supabase
        .from("campaign_participants")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", c.id);
      c.participant_count = count || 0;
    }

    json(res, 200, { campaigns: campaignsWithStatus });
    return true;
  }

  if (path?.startsWith("/api/campaigns/") && path?.endsWith("/join") && method === "POST") {
    const campaignId = path.split("/")[3];

    const { data: existing } = await supabase
      .from("campaign_participants")
      .select("id")
      .eq("user_id", user.id)
      .eq("campaign_id", campaignId)
      .single();

    if (existing) {
      json(res, 400, { error: "Already joined this campaign" });
      return true;
    }

    await supabase.from("campaign_participants").insert({
      user_id: user.id,
      campaign_id: campaignId,
    });

    json(res, 200, { success: true });
    return true;
  }

  // Get campaign details with tasks
  if (path?.startsWith("/api/campaigns/") && !path?.endsWith("/join") && method === "GET") {
    const campaignId = path.split("/")[3];

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("*, campaign_tasks(*)")
      .eq("id", campaignId)
      .single();

    if (!campaign) {
      json(res, 404, { error: "Campaign not found" });
      return true;
    }

    const { data: participation } = await supabase
      .from("campaign_participants")
      .select("status")
      .eq("user_id", user.id)
      .eq("campaign_id", campaignId)
      .single();

    const { data: completions } = await supabase
      .from("campaign_task_completions")
      .select("task_id, status")
      .eq("user_id", user.id)
      .eq("campaign_id", campaignId);

    const completionMap: Record<string, string> = {};
    completions?.forEach((c: any) => {
      completionMap[c.task_id] = c.status;
    });

    const tasksWithStatus = campaign.campaign_tasks?.map((t: any) => ({
      id: t.id,
      title: t.title,
      task_type: t.task_type,
      task_url: t.task_url,
      reward_amount: t.reward_amount,
      user_status: completionMap[t.id] || "not_started",
    })) || [];

    json(res, 200, {
      campaign: {
        ...campaign,
        campaign_tasks: tasksWithStatus,
        user_status: participation?.status || "not_joined",
      },
    });
    return true;
  }

  // Complete a campaign task
  if (path?.match(/^\/api\/campaigns\/[^/]+\/tasks\/[^/]+\/complete$/) && method === "POST") {
    const parts = path.split("/");
    const campaignId = parts[3];
    const taskId = parts[5];

    // Check if user joined the campaign
    const { data: participation } = await supabase
      .from("campaign_participants")
      .select("id")
      .eq("user_id", user.id)
      .eq("campaign_id", campaignId)
      .single();

    if (!participation) {
      json(res, 400, { error: "Join the campaign first" });
      return true;
    }

    // Check if task already completed
    const { data: existing } = await supabase
      .from("campaign_task_completions")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("task_id", taskId)
      .single();

    if (existing && existing.status === "completed") {
      json(res, 400, { error: "Task already completed" });
      return true;
    }

    // Get task details
    const { data: task } = await supabase
      .from("campaign_tasks")
      .select("id, reward_amount, reward_token")
      .eq("id", taskId)
      .single();

    if (!task) {
      json(res, 404, { error: "Task not found" });
      return true;
    }

    // Mark task completed
    await supabase.from("campaign_task_completions").upsert({
      user_id: user.id,
      task_id: taskId,
      campaign_id: campaignId,
      status: "completed",
      completed_at: new Date().toISOString(),
      reward_earned: task.reward_amount,
    });

    // Credit reward
    const rewardToken = task.reward_token || "GRAM";
    if (rewardToken === "SNAP") {
      await supabase
        .from("users")
        .update({ balance: (user.balance || 0) + task.reward_amount })
        .eq("id", user.id);
      creditReferrerCommission(supabase, user.id, task.reward_amount, "snap");
    } else {
      await supabase
        .from("users")
        .update({ gram: (user.gram || 0) + task.reward_amount })
        .eq("id", user.id);
      creditReferrerCommission(supabase, user.id, task.reward_amount, "gram");
    }

    await supabase.from("transactions").insert({
      user_id: user.id,
      type: "campaign_task_reward",
      amount: task.reward_amount,
      token: rewardToken,
      description: `Campaign task completed`,
    });

    json(res, 200, {
      success: true,
      reward: task.reward_amount,
      token: rewardToken,
    });
    return true;
  }

  // ============ SPIN ROUTES ============
  if (path === "/api/spin/settings" && method === "GET") {
    const { data: settings } = await supabase
      .from("spin_settings")
      .select("*")
      .eq("id", 1)
      .single();
    json(res, 200, settings || { max_spins_per_day: 3, slot_1: 250, slot_2: 500, slot_3: 1000, slot_4: 250, slot_5: 100, slot_6: 50 });
    return true;
  }

  if (path === "/api/spin/info" && method === "GET") {
    const today = new Date().toISOString().split("T")[0];

    const { data: settings } = await supabase
      .from("spin_settings")
      .select("max_spins_per_day, slot_1, slot_2, slot_3, slot_4, slot_5, slot_6")
      .eq("id", 1)
      .single();

    const maxSpins = settings?.max_spins_per_day || 3;
    const rewards = [
      settings?.slot_1 || 250, settings?.slot_2 || 500, settings?.slot_3 || 1000,
      settings?.slot_4 || 250, settings?.slot_5 || 100, settings?.slot_6 || 50
    ];

    const { count: spinsToday } = await supabase
      .from("spins")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("spin_date", today);

    const remaining = Math.max(0, maxSpins - (spinsToday || 0));

    json(res, 200, {
      remaining,
      max_spins: maxSpins,
      rewards,
    });
    return true;
  }

  if (path === "/api/spin/execute" && method === "POST") {
    const today = new Date().toISOString().split("T")[0];

    const { data: settings } = await supabase
      .from("spin_settings")
      .select("max_spins_per_day, slot_1, slot_2, slot_3, slot_4, slot_5, slot_6")
      .eq("id", 1)
      .single();

    const maxSpins = settings?.max_spins_per_day || 3;
    const rewards = [
      settings?.slot_1 || 250, settings?.slot_2 || 500, settings?.slot_3 || 1000,
      settings?.slot_4 || 250, settings?.slot_5 || 100, settings?.slot_6 || 50
    ];

    const { count: spinsToday } = await supabase
      .from("spins")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("spin_date", today);

    if ((spinsToday || 0) >= maxSpins) {
      json(res, 400, { error: "No spins remaining today" });
      return true;
    }

    const reward = rewards[Math.floor(Math.random() * rewards.length)];

    await supabase.from("spins").insert({
      user_id: user.id,
      spin_date: today,
      reward_earned: reward,
    });

    await supabase
      .from("users")
      .update({ balance: (user.balance || 0) + reward })
      .eq("id", user.id);

    await supabase.from("transactions").insert({
      user_id: user.id,
      type: "spin_reward",
      amount: reward,
      token: "SNAP",
      description: "Lucky Spin",
    });

    creditReferrerCommission(supabase, user.id, reward, "snap");

    const newSpinsToday = (spinsToday || 0) + 1;

    json(res, 200, {
      success: true,
      reward,
      remaining: Math.max(0, maxSpins - newSpinsToday),
      new_balance: (user.balance || 0) + reward,
    });
    return true;
  }

  if (path === "/api/spin/history" && method === "GET") {
    const { data: spins } = await supabase
      .from("spins")
      .select("reward_earned, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    const history = (spins || []).map(s => ({
      name: "You",
      amount: s.reward_earned,
      time: timeAgo(s.created_at),
    }));
    json(res, 200, { history });
    return true;
  }

  // ============ RAFFLE ROUTES ============
  if (path === "/api/raffle/current" && method === "GET") {
    const { data: raffle } = await supabase
      .from("raffles")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!raffle) {
      json(res, 200, { raffle: null });
      return true;
    }

    const { data: entry } = await supabase
      .from("raffle_entries")
      .select("*, raffle_box_numbers(box_number, number_value)")
      .eq("user_id", user.id)
      .eq("raffle_id", raffle.id)
      .single();

    const { count: totalEntries } = await supabase
      .from("raffle_entries")
      .select("*", { count: "exact", head: true })
      .eq("raffle_id", raffle.id);

    const boxNumbers = entry?.raffle_box_numbers || [];
    const userBoxes = boxNumbers.map((b: any) => b.box_number);

    json(res, 200, {
      raffle: {
        id: raffle.id,
        title: raffle.title,
        description: raffle.description,
        total_boxes: raffle.total_boxes || 8,
        reward_per_box: raffle.reward_per_box || 5,
        reward_token: raffle.reward_token || "SNAP",
        prize_pool: raffle.prize_pool,
        end_date: raffle.end_date,
        user_boxes_opened: userBoxes,
        user_box_numbers: boxNumbers.reduce((acc: any, b: any) => { acc[b.box_number] = b.number_value; return acc; }, {}),
        user_luck: entry?.total_luck || 0,
        total_participants: totalEntries || 0,
      },
    });
    return true;
  }

  if (path === "/api/raffle/unlock" && method === "POST") {
    const body = await readBody(req);
    const { raffle_id, box_number } = body;

    if (!raffle_id || box_number === undefined) {
      json(res, 400, { error: "Missing raffle_id or box_number" });
      return true;
    }
    if (box_number < 1 || box_number > 8) {
      json(res, 400, { error: "Box number must be 1-8" });
      return true;
    }

    const { data: raffle } = await supabase
      .from("raffles")
      .select("*")
      .eq("id", raffle_id)
      .eq("status", "active")
      .single();

    if (!raffle) {
      json(res, 404, { error: "Active raffle not found" });
      return true;
    }

    if (raffle.end_date && new Date(raffle.end_date) < new Date()) {
      json(res, 400, { error: "Raffle has ended" });
      return true;
    }

    const { data: existing } = await supabase
      .from("raffle_box_numbers")
      .select("id")
      .eq("raffle_id", raffle_id)
      .eq("user_id", user.id)
      .eq("box_number", box_number)
      .single();

    if (existing) {
      json(res, 400, { error: "Box already unlocked" });
      return true;
    }

    const numberValue = Math.floor(Math.random() * 100);

    await supabase.from("raffle_box_numbers").insert({
      raffle_id,
      user_id: user.id,
      box_number,
      number_value: numberValue,
    });

    const { data: allBoxes } = await supabase
      .from("raffle_box_numbers")
      .select("box_number")
      .eq("raffle_id", raffle_id)
      .eq("user_id", user.id);

    const totalBoxes = raffle.total_boxes || 8;
    const boxesOpened = (allBoxes || []).map((b: any) => b.box_number);
    const luck = (boxesOpened.length / totalBoxes) * 100;

    let { data: entry } = await supabase
      .from("raffle_entries")
      .select("id")
      .eq("user_id", user.id)
      .eq("raffle_id", raffle_id)
      .single();

    if (!entry) {
      await supabase.from("raffle_entries").insert({
        user_id: user.id,
        raffle_id,
        boxes_opened: boxesOpened,
        total_luck: luck,
      });
    } else {
      await supabase
        .from("raffle_entries")
        .update({ boxes_opened: boxesOpened, total_luck: luck })
        .eq("id", entry.id);
    }

    const rewardPerBox = raffle.reward_per_box || 5;
    const rewardToken = raffle.reward_token || "SNAP";
    if (rewardPerBox > 0) {
      if (rewardToken === "SNAP") {
        await supabase
          .from("users")
          .update({ balance: (user.balance || 0) + rewardPerBox })
          .eq("id", user.id);
        creditReferrerCommission(supabase, user.id, rewardPerBox, "snap");
      } else {
        await supabase
          .from("users")
          .update({ gram: (user.gram || 0) + rewardPerBox })
          .eq("id", user.id);
        creditReferrerCommission(supabase, user.id, rewardPerBox, "gram");
      }
      try {
        await supabase.from("transactions").insert({
          user_id: user.id,
          type: "raffle_reward",
          amount: rewardPerBox,
          token: rewardToken,
          description: "Raffle box unlocked",
        });
      } catch (e) {}
    }

    json(res, 200, {
      success: true,
      number: numberValue,
      reward: rewardPerBox,
      token: rewardToken,
      boxes_opened: boxesOpened.length,
      total_boxes: totalBoxes,
      luck,
    });
    return true;
  }

  // ============ LEADERBOARD ROUTES ============
  if (path === "/api/leaderboard" && method === "GET") {
    const { data: users } = await supabase
      .from("users")
      .select("telegram_id, first_name, username, balance")
      .order("balance", { ascending: false })
      .limit(50);

    const ranked = users?.map((u: any, i: number) => ({
      rank: i + 1,
      telegram_id: u.telegram_id,
      first_name: u.first_name,
      username: u.username,
      balance: u.balance || 0,
      is_me: u.telegram_id === user.telegram_id,
    })) || [];

    json(res, 200, { leaderboard: ranked });
    return true;
  }

  // ============ REFERRAL ROUTES ============
  if (path === "/api/referrals" && method === "GET") {
    const { data: referrals } = await supabase
      .from("referrals")
      .select("*, referred:referred_id(first_name, username, created_at)")
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false });

    const totalSnapEarned = (referrals || []).reduce(
      (sum: number, r: any) => sum + (r.snap_earned || 0), 0
    );
    const totalSpinsEarned = (referrals || []).reduce(
      (sum: number, r: any) => sum + (r.spins_granted || 0), 0
    );

    const spinsPerRefer = parseInt(await getSetting(supabase, "ref_spins_per_refer") || "5");
    const commissionPercent = parseFloat(await getSetting(supabase, "ref_commission_percent") || "10");

    json(res, 200, {
      referral_code: user.referral_code,
      referral_link: `https://t.me/SnapbucksAirdrop_Bot?start=${user.referral_code}`,
      total_referrals: user.referral_count || 0,
      total_snap_earned: totalSnapEarned,
      total_spins_earned: totalSpinsEarned,
      referrals: referrals || [],
      settings: {
        spins_per_refer: spinsPerRefer,
        commission_percent: commissionPercent,
      },
    });
    return true;
  }

  // Public referral settings for Mini App display
  if (path === "/api/referral-settings" && method === "GET") {
    const spinsPerRefer = parseInt(await getSetting(supabase, "ref_spins_per_refer") || "5");
    const commissionPercent = parseFloat(await getSetting(supabase, "ref_commission_percent") || "10");
    json(res, 200, { spins_per_refer: spinsPerRefer, commission_percent: commissionPercent });
    return true;
  }

  // ============ SOCIAL LINKS (public) ============
  if (path === "/api/social-links" && method === "GET") {
    const twitter = await getSetting(supabase, "social_twitter");
    const discord = await getSetting(supabase, "social_discord");
    const instagram = await getSetting(supabase, "social_instagram");
    const support = await getSetting(supabase, "support_url");
    json(res, 200, {
      twitter: twitter || "",
      discord: discord || "",
      instagram: instagram || "",
      support_url: support || "",
    });
    return true;
  }

  // ============ TRANSACTIONS ROUTES ============
  if (path === "/api/transactions" && method === "GET") {
    const { data: txs } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    json(res, 200, { transactions: txs || [] });
    return true;
  }

  // ============ WALLET — WITHDRAW ============
  if (path === "/api/wallet/withdraw" && method === "POST") {
    const body = await readBody(req);
    const { amount, address } = body;

    if (!amount || amount < 50) return json(res, 400, { error: "Minimum withdrawal is 50 Gram" });
    if (!address || address.length < 10) return json(res, 400, { error: "Invalid Gram address" });
    if ((user.gram || 0) < amount) return json(res, 400, { error: "Insufficient Gram balance" });

    const { data: pending } = await supabase
      .from("wallet_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .limit(1);

    if (pending && pending.length > 0) {
      return json(res, 400, { error: "You already have a pending request" });
    }

    const newGram = (user.gram || 0) - amount;
    await supabase.from("users").update({ gram: newGram }).eq("id", user.id);

    const { data: wr, error } = await supabase
      .from("wallet_requests")
      .insert({
        user_id: user.id,
        amount,
        token: "gram",
        address,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      await supabase.from("users").update({ gram: user.gram || 0 }).eq("id", user.id);
      return json(res, 500, { error: "Failed to create request" });
    }

    await supabase.from("transactions").insert({
      user_id: user.id,
      type: "withdraw_request",
      amount: -amount,
      token: "gram",
      description: `Withdraw ${amount} Gram to ${address.slice(0, 10)}...`,
    });

    json(res, 200, { success: true, request: wr });
    return true;
  }

  // ============ WALLET — MY REQUESTS ============
  if (path === "/api/wallet/requests" && method === "GET") {
    const { data: requests } = await supabase
      .from("wallet_requests")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    json(res, 200, { requests: requests || [] });
    return true;
  }

  // ============ ADVERTISE ROUTES ============

  // GET /api/advertise/tasks — List user's ad tasks
  if (path === "/api/advertise/tasks" && method === "GET") {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("advertiser_id", user.id)
      .order("created_at", { ascending: false });

    const pricePer1k = parseFloat(await getSetting(supabase, "ad_price_per_1k") || "50");
    json(res, 200, { tasks: tasks || [], price_per_1k: pricePer1k });
    return true;
  }

  // POST /api/advertise/tasks — Create ad task
  if (path === "/api/advertise/tasks" && method === "POST") {
    const body = await readBody(req);
    const { title, description, task_type, reward_amount, target_completions, task_url, channel_username, custom_fields, required_screenshots, reference_image_url, instructions, task_logo_url } = body;

    if (!title || !task_type) return json(res, 400, { error: "Title and task type required" });
    if (!target_completions || target_completions < 1000) return json(res, 400, { error: "Minimum 1000 target completions" });

    const pricePer1k = parseFloat(await getSetting(supabase, "ad_price_per_1k") || "50");
    const adFee = Math.ceil((target_completions / 1000) * pricePer1k);
    const rewardCost = (reward_amount || 0) * target_completions;
    const totalDeposit = adFee + rewardCost;

    const { data: task, error } = await supabase.from("tasks").insert({
      title, description, instructions, task_type,
      reward_amount: reward_amount || 0, reward_token: "SNAP",
      task_url, reference_image_url, required_screenshots: required_screenshots || 1,
      channel_username, custom_fields,
      task_logo_url: task_logo_url || null,
      is_active: false,
      advertiser_id: user.id,
      target_completions,
      ad_fee: adFee,
      total_budget: totalDeposit,
      ad_status: "pending_deposit",
    }).select().single();

    if (error) return json(res, 400, { error: error.message });
    json(res, 200, { success: true, task, total_deposit: totalDeposit, ad_fee: adFee, reward_cost: rewardCost });
    return true;
  }

  // PUT /api/advertise/tasks/:id — Edit ad task (only draft/pending_deposit)
  if (path?.match(/^\/api\/advertise\/tasks\/[a-f0-9-]+$/) && method === "PUT") {
    const taskId = path.split("/")[4];
    const body = await readBody(req);

    const { data: existing } = await supabase.from("tasks").select("advertiser_id, ad_status").eq("id", taskId).single();
    if (!existing || existing.advertiser_id !== user.id) return json(res, 404, { error: "Not found" });
    if (!["draft", "pending_deposit"].includes(existing.ad_status)) return json(res, 400, { error: "Cannot edit this task" });

    const { title, description, task_type, reward_amount, target_completions, task_url, channel_username, custom_fields, required_screenshots, reference_image_url, instructions } = body;
    const pricePer1k = parseFloat(await getSetting(supabase, "ad_price_per_1k") || "50");
    const adFee = Math.ceil(((target_completions || 1000) / 1000) * pricePer1k);
    const rewardCost = (reward_amount || 0) * (target_completions || 1000);
    const totalDeposit = adFee + rewardCost;

    const { error } = await supabase.from("tasks").update({
      title, description, instructions, task_type,
      reward_amount: reward_amount || 0, reward_token: "SNAP",
      task_url, reference_image_url, required_screenshots: required_screenshots || 1,
      channel_username, custom_fields,
      target_completions: target_completions || 1000,
      ad_fee: adFee, total_budget: totalDeposit,
    }).eq("id", taskId);

    if (error) return json(res, 400, { error: error.message });
    json(res, 200, { success: true, total_deposit: totalDeposit });
    return true;
  }

  // DELETE /api/advertise/tasks/:id — Delete ad task
  if (path?.match(/^\/api\/advertise\/tasks\/[a-f0-9-]+$/) && method === "DELETE") {
    const taskId = path.split("/")[4];
    const { data: existing } = await supabase.from("tasks").select("advertiser_id, ad_status").eq("id", taskId).single();
    if (!existing || existing.advertiser_id !== user.id) return json(res, 404, { error: "Not found" });
    if (!["draft", "pending_deposit"].includes(existing.ad_status)) return json(res, 400, { error: "Cannot delete this task" });

    await supabase.from("tasks").update({ is_active: false, ad_status: "deleted" }).eq("id", taskId);
    json(res, 200, { success: true });
    return true;
  }

  // POST /api/advertise/deposit — Submit deposit request
  if (path === "/api/advertise/deposit" && method === "POST") {
    const body = await readBody(req);
    const { task_id, amount, address } = body;

    if (!task_id || !amount || !address) return json(res, 400, { error: "Missing fields" });
    if (amount <= 0) return json(res, 400, { error: "Invalid amount" });

    const { data: task } = await supabase.from("tasks").select("id, advertiser_id, ad_status, total_budget").eq("id", task_id).single();
    if (!task || task.advertiser_id !== user.id) return json(res, 404, { error: "Task not found" });

    const { data: pending } = await supabase.from("ad_deposits").select("id").eq("user_id", user.id).eq("status", "pending").limit(1);
    if (pending && pending.length > 0) return json(res, 400, { error: "You already have a pending deposit" });

    const { data: deposit, error } = await supabase.from("ad_deposits").insert({
      user_id: user.id, task_id, amount, address, status: "pending",
    }).select().single();

    if (error) return json(res, 500, { error: error.message });
    json(res, 200, { success: true, deposit });
    return true;
  }

  // GET /api/advertise/deposits — List user's deposit history
  if (path === "/api/advertise/deposits" && method === "GET") {
    const { data: deposits } = await supabase
      .from("ad_deposits")
      .select("*, tasks(title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    json(res, 200, { deposits: deposits || [] });
    return true;
  }

  // POST /api/advertise/tasks/:id/resume — Resume paused task by depositing more
  if (path?.match(/^\/api\/advertise\/tasks\/[a-f0-9-]+\/resume$/) && method === "POST") {
    const taskId = path.split("/")[4];
    const body = await readBody(req);
    const { amount, address } = body;

    const { data: task } = await supabase.from("tasks").select("advertiser_id, ad_status").eq("id", taskId).single();
    if (!task || task.advertiser_id !== user.id) return json(res, 404, { error: "Not found" });
    if (task.ad_status !== "paused") return json(res, 400, { error: "Task is not paused" });

    const { data: pending } = await supabase.from("ad_deposits").select("id").eq("user_id", user.id).eq("status", "pending").limit(1);
    if (pending && pending.length > 0) return json(res, 400, { error: "You already have a pending deposit" });

    const { data: deposit, error } = await supabase.from("ad_deposits").insert({
      user_id: user.id, task_id: taskId, amount, address, status: "pending",
    }).select().single();

    if (error) return json(res, 500, { error: error.message });
    json(res, 200, { success: true, deposit });
    return true;
  }

  // 404
  json(res, 404, { error: "Not found" });
  return true;
}

// ============ ADMIN API HANDLER ============
const ADMIN_PASSWORD = "snapbucks2026";
const adminSessions = new Set<string>();

async function handleAdminApi(
  req: any, res: any, supabase: SupabaseClient, path: string, method: string
): Promise<boolean> {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") { res.writeHead(200); res.end(); return true; }

  // Login (no auth needed)
  if (path === "/api/admin/login" && method === "POST") {
    const body = await readBody(req);
    if (body.password === ADMIN_PASSWORD) {
      const token = crypto.randomBytes(32).toString("hex");
      adminSessions.add(token);
      json(res, 200, { success: true, token });
    } else {
      json(res, 401, { error: "Invalid password" });
    }
    return true;
  }

  const body = await readBody(req);

  // --- Tasks CRUD ---
  if (path === "/api/admin/tasks" && method === "GET") {
    const { data: tasks } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    json(res, 200, { tasks: tasks || [] });
    return true;
  }

  if (path === "/api/admin/tasks" && method === "POST") {
    const { error } = await supabase.from("tasks").insert({
      title: body.title, description: body.description, instructions: body.instructions,
      task_type: body.task_type, reward_amount: body.reward_amount, reward_token: body.reward_token,
      task_url: body.task_url, reference_image_url: body.reference_image_url,
      required_screenshots: body.required_screenshots || 1, channel_username: body.channel_username,
      custom_fields: body.custom_fields, is_active: body.is_active !== false,
      task_logo_url: body.task_logo_url || null,
    });
    if (error) { json(res, 400, { error: error.message }); } else { json(res, 200, { success: true }); }
    return true;
  }

  const taskMatch = path?.match(/^\/api\/admin\/tasks\/([a-f0-9-]+)$/);
  if (taskMatch) {
    const taskId = taskMatch[1];
    if (method === "PUT") {
      const { error } = await supabase.from("tasks").update({
        title: body.title, description: body.description, instructions: body.instructions,
        task_type: body.task_type, reward_amount: body.reward_amount, reward_token: body.reward_token,
        task_url: body.task_url, reference_image_url: body.reference_image_url,
        required_screenshots: body.required_screenshots, channel_username: body.channel_username,
        custom_fields: body.custom_fields, is_active: body.is_active,
        task_logo_url: body.task_logo_url || null,
      }).eq("id", taskId);
      if (error) { json(res, 400, { error: error.message }); } else { json(res, 200, { success: true }); }
      return true;
    }
    if (method === "DELETE") {
      await supabase.from("tasks").delete().eq("id", taskId);
      json(res, 200, { success: true });
      return true;
    }
  }

  // --- Submissions ---
  if (path === "/api/admin/submissions" && method === "GET") {
    const statusFilter = new URL(req.url, "http://x").searchParams.get("status");
    let query = supabase.from("task_submissions").select("*, tasks(title, task_type, reward_amount, reward_token), users(telegram_id, first_name, username)").order("created_at", { ascending: false });
    if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter);
    const { data: subs } = await query;
    // fetch images for each submission
    const subIds = (subs || []).map((s: any) => s.id);
    const { data: images } = await supabase.from("task_submission_images").select("*").in("submission_id", subIds);
    const imageMap: Record<string, any[]> = {};
    (images || []).forEach((img: any) => {
      if (!imageMap[img.submission_id]) imageMap[img.submission_id] = [];
      imageMap[img.submission_id].push(img);
    });
    const result = (subs || []).map((s: any) => ({ ...s, images: imageMap[s.id] || [] }));
    json(res, 200, { submissions: result });
    return true;
  }

  const subMatch = path?.match(/^\/api\/admin\/submissions\/([a-f0-9-]+)$/);
  if (subMatch && method === "PUT") {
    const subId = subMatch[1];
    const { status, admin_note } = body;
    await supabase.from("task_submissions").update({ status, admin_note, reviewed_at: new Date().toISOString() }).eq("id", subId);
    // If approved, credit reward + create task_completion
    if (status === "approved") {
      const { data: sub } = await supabase.from("task_submissions").select("task_id, user_id").eq("id", subId).single();
      if (sub) {
        const { data: task } = await supabase.from("tasks").select("reward_amount, reward_token").eq("id", sub.task_id).single();
        if (task) {
          await supabase.from("task_completions").upsert({ user_id: sub.user_id, task_id: sub.task_id, status: "completed", completed_at: new Date().toISOString(), reward_earned: task.reward_amount });
          if (task.reward_token === "SNAP") {
            const { data: u } = await supabase.from("users").select("balance").eq("id", sub.user_id).single();
            await supabase.from("users").update({ balance: (u?.balance || 0) + task.reward_amount }).eq("id", sub.user_id);
            await supabase.from("transactions").insert({ user_id: sub.user_id, type: "task_reward", amount: task.reward_amount, token: "SNAP", description: `Task approved` });
            creditReferrerCommission(supabase, sub.user_id, task.reward_amount, "snap");
          } else {
            const { data: u } = await supabase.from("users").select("gram").eq("id", sub.user_id).single();
            await supabase.from("users").update({ gram: (u?.gram || 0) + task.reward_amount }).eq("id", sub.user_id);
            await supabase.from("transactions").insert({ user_id: sub.user_id, type: "task_reward", amount: task.reward_amount, token: "GRAM", description: `Task approved` });
            creditReferrerCommission(supabase, sub.user_id, task.reward_amount, "gram");
          }

          // Auto-pause ad task if target reached
          {
            const { data: fullTask } = await supabase.from("tasks").select("target_completions, current_completions, ad_status").eq("id", sub.task_id).single();
            if (fullTask && fullTask.target_completions > 0) {
              const newCount = (fullTask.current_completions || 0) + 1;
              await supabase.from("tasks").update({ current_completions: newCount }).eq("id", sub.task_id);
              if (newCount >= fullTask.target_completions && fullTask.ad_status === "active") {
                await supabase.from("tasks").update({ is_active: false, ad_status: "paused" }).eq("id", sub.task_id);
              }
            }
          }
        }
      }
    }
    json(res, 200, { success: true });
    return true;
  }

  // --- Stats ---
  if (path === "/api/admin/stats" && method === "GET") {
    const [{ count: totalTasks }, { count: pendingSubs }, { count: totalUsers }, { count: approvedToday }] = await Promise.all([
      supabase.from("tasks").select("*", { count: "exact", head: true }),
      supabase.from("task_submissions").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("users").select("*", { count: "exact", head: true }),
      supabase.from("task_submissions").select("*", { count: "exact", head: true }).eq("status", "approved").gte("reviewed_at", new Date().toISOString().split("T")[0]),
    ]);
    json(res, 200, { totalTasks: totalTasks || 0, pendingSubs: pendingSubs || 0, totalUsers: totalUsers || 0, approvedToday: approvedToday || 0 });
    return true;
  }

  // ============ ADMIN SPIN SETTINGS ============
  if (path === "/api/admin/spin-settings" && method === "GET") {
    const { data: settings } = await supabase.from("spin_settings").select("*").eq("id", 1).single();
    json(res, 200, settings || {});
    return true;
  }

  if (path === "/api/admin/spin-settings" && method === "POST") {
    const maxSpins = parseInt(body.max_spins_per_day);
    const settings = {
      id: 1,
      max_spins_per_day: isNaN(maxSpins) ? 3 : maxSpins,
      slot_1: parseInt(body.slot_1) || 250,
      slot_2: parseInt(body.slot_2) || 500,
      slot_3: parseInt(body.slot_3) || 1000,
      slot_4: parseInt(body.slot_4) || 250,
      slot_5: parseInt(body.slot_5) || 100,
      slot_6: parseInt(body.slot_6) || 50,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("spin_settings")
      .upsert(settings)
      .select();
    if (error) {
      json(res, 500, { error: error.message });
      return true;
    }
    json(res, 200, { success: true, saved: settings });
    return true;
  }

  // ============ ADMIN REFERRAL SETTINGS ============
  if (path === "/api/admin/referral-settings" && method === "GET") {
    const spinsPerRefer = parseInt(await getSetting(supabase, "ref_spins_per_refer") || "5");
    const commissionPercent = parseFloat(await getSetting(supabase, "ref_commission_percent") || "10");
    const snapPerRefer = parseInt(await getSetting(supabase, "snap_per_refer") || "100");
    json(res, 200, {
      spins_per_refer: spinsPerRefer,
      commission_percent: commissionPercent,
      snap_per_refer: snapPerRefer,
    });
    return true;
  }

  if (path === "/api/admin/referral-settings" && method === "POST") {
    const spinsPerRefer = parseInt(body.spins_per_refer);
    const commissionPercent = parseFloat(body.commission_percent);
    const snapPerRefer = parseInt(body.snap_per_refer);

    if (isNaN(spinsPerRefer) || spinsPerRefer < 0) {
      json(res, 400, { error: "Spins per refer must be a non-negative number" });
      return true;
    }
    if (isNaN(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      json(res, 400, { error: "Commission percent must be 0-100" });
      return true;
    }

    const safeSnap = isNaN(snapPerRefer) ? 100 : snapPerRefer;

    await setSetting(supabase, "ref_spins_per_refer", String(spinsPerRefer));
    await setSetting(supabase, "ref_commission_percent", String(commissionPercent));
    await setSetting(supabase, "snap_per_refer", String(safeSnap));

    json(res, 200, {
      success: true,
      saved: {
        spins_per_refer: spinsPerRefer,
        commission_percent: commissionPercent,
        snap_per_refer: snapPerRefer,
      },
    });
    return true;
  }

  // ============ ADMIN SOCIAL LINKS ============
  if (path === "/api/admin/social-links" && method === "GET") {
    const twitter = await getSetting(supabase, "social_twitter");
    const discord = await getSetting(supabase, "social_discord");
    const instagram = await getSetting(supabase, "social_instagram");
    const support = await getSetting(supabase, "support_url");
    json(res, 200, {
      twitter: twitter || "",
      discord: discord || "",
      instagram: instagram || "",
      support_url: support || "",
    });
    return true;
  }

  if (path === "/api/admin/social-links" && method === "POST") {
    if (body.twitter !== undefined) await setSetting(supabase, "social_twitter", String(body.twitter));
    if (body.discord !== undefined) await setSetting(supabase, "social_discord", String(body.discord));
    if (body.instagram !== undefined) await setSetting(supabase, "social_instagram", String(body.instagram));
    if (body.support_url !== undefined) await setSetting(supabase, "support_url", String(body.support_url));
    json(res, 200, { success: true });
    return true;
  }

  // --- Checkin Settings ---
  if (path === "/api/admin/checkin-settings" && method === "GET") {
    const days: Record<string, string> = {};
    for (let i = 1; i <= 7; i++) {
      days[`checkin_day_${i}`] = await getSetting(supabase, `checkin_day_${i}`) || "10";
    }
    json(res, 200, { days });
    return true;
  }

  if (path === "/api/admin/checkin-settings" && method === "POST") {
    for (let i = 1; i <= 7; i++) {
      const key = `checkin_day_${i}`;
      if (body[key] !== undefined) {
        const val = parseInt(body[key]);
        if (!isNaN(val) && val >= 0) {
          await setSetting(supabase, key, String(val));
        }
      }
    }
    json(res, 200, { success: true });
    return true;
  }

  // --- Raffle Config ---
  if (path === "/api/admin/raffle-config" && method === "GET") {
    const { data: raffle } = await supabase
      .from("raffles")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const adsZone = await getSetting(supabase, "adsgram_block_id");
    json(res, 200, {
      raffle: raffle || null,
      ads_zone_id: adsZone || "",
    });
    return true;
  }

  if (path === "/api/admin/raffle-config" && method === "POST") {
    const { title, description, prize_pool, reward_per_box, winner_prize, reward_token, ad_zone_id, end_date, draw_frequency, create_new } = body;

    if (ad_zone_id !== undefined) await setSetting(supabase, "adsgram_block_id", String(ad_zone_id));

    if (create_new) {
      const { data: newRaffle } = await supabase
        .from("raffles")
        .insert({
          title: title || "Lucky Raffle",
          description: description || "",
          total_boxes: 8,
          prize_pool: prize_pool || 0,
          reward_token: reward_token || "SNAP",
          reward_per_box: reward_per_box || 5,
          winner_prize: winner_prize || 0,
          draw_frequency: draw_frequency || "one-time",
          ad_zone_id: ad_zone_id || "",
          status: "active",
          start_date: new Date().toISOString(),
          end_date: end_date || null,
        })
        .select()
        .single();

      json(res, 200, { success: true, raffle: newRaffle });
      return true;
    }

    const { data: existing } = await supabase
      .from("raffles")
      .select("id")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      const updateData: any = {};
      if (title) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (prize_pool !== undefined) updateData.prize_pool = prize_pool;
      if (reward_per_box !== undefined) updateData.reward_per_box = reward_per_box;
      if (winner_prize !== undefined) updateData.winner_prize = winner_prize;
      if (draw_frequency) updateData.draw_frequency = draw_frequency;
      if (reward_token) updateData.reward_token = reward_token;
      if (ad_zone_id) updateData.ad_zone_id = ad_zone_id;
      if (end_date) updateData.end_date = end_date;
      await supabase.from("raffles").update(updateData).eq("id", existing.id);
    }

    json(res, 200, { success: true });
    return true;
  }

  // --- Raffle Draw (pick winner) ---
  if (path === "/api/admin/raffle-draw" && method === "POST") {
    const { data: raffle } = await supabase
      .from("raffles")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!raffle) {
      json(res, 400, { error: "No active raffle" });
      return true;
    }

    const totalBoxes = raffle.total_boxes || 8;

    const { data: allEntries } = await supabase
      .from("raffle_entries")
      .select("*, users(telegram_id, first_name, balance)")
      .eq("raffle_id", raffle.id);

    if (!allEntries || allEntries.length === 0) {
      json(res, 400, { error: "No participants" });
      return true;
    }

    const fullBoxEntries = allEntries.filter((e: any) => {
      const opened = Array.isArray(e.boxes_opened) ? e.boxes_opened.length : 0;
      return opened >= totalBoxes;
    });

    let winner;
    if (fullBoxEntries.length > 0) {
      fullBoxEntries.sort((a: any, b: any) => (b.total_luck || 0) - (a.total_luck || 0));
      winner = fullBoxEntries[0];
    } else {
      allEntries.sort((a: any, b: any) => {
        const aOpened = Array.isArray(a.boxes_opened) ? a.boxes_opened.length : 0;
        const bOpened = Array.isArray(b.boxes_opened) ? b.boxes_opened.length : 0;
        if (bOpened !== aOpened) return bOpened - aOpened;
        return (b.total_luck || 0) - (a.total_luck || 0);
      });
      winner = allEntries[0];
    }

    // Credit winner prize
    const winnerPrize = raffle.winner_prize || 0;
    const winnerData = winner?.users as any;
    if (winnerPrize > 0 && winner?.user_id) {
      const currentBalance = winnerData?.balance || 0;
      await supabase
        .from("users")
        .update({ balance: currentBalance + winnerPrize })
        .eq("id", winner.user_id);
      try {
        await supabase.from("transactions").insert({
          user_id: winner.user_id,
          type: "raffle_prize",
          amount: winnerPrize,
          token: "SNAP",
          description: `Won ${raffle.title}`,
        });
      } catch (e) {}
      creditReferrerCommission(supabase, winner.user_id, winnerPrize, "snap");
    }

    await supabase
      .from("raffles")
      .update({ status: "completed" })
      .eq("id", raffle.id);

    // Send winner message
    if (winnerData?.telegram_id) {
      try {
        const tgBotToken = process.env.BOT_TOKEN || "";
        const miniAppUrl = await getSetting(supabase, "mini_app_url");
        const buttons: any[][] = [];
        if (miniAppUrl) {
          buttons.push([{ text: "🎉 Open Mini App", web_app: { url: miniAppUrl } }]);
        }
        await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: winnerData.telegram_id,
            text: `🎉 Congratulations, ${winnerData.first_name || "User"}!\n\nYou won the ${raffle.title}!\n\nPrize: ${winnerPrize} SNAP\nBoxes opened: ${totalBoxes}/${totalBoxes}\nLuck: ${winner.total_luck || 100}%\n\nYour reward has been credited to your balance!`,
            reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
          }),
        });
      } catch (e) {}
    }

    // Send loser messages
    for (const entry of allEntries) {
      if (entry.user_id === winner?.user_id) continue;
      const entryUser = entry.users as any;
      if (entryUser?.telegram_id) {
        try {
          const tgBotToken = process.env.BOT_TOKEN || "";
          await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: entryUser.telegram_id,
              text: `Better luck next time! 🍀\n\nThe ${raffle.title} draw has ended.\nYour luck was ${entry.total_luck || 0}%\n\nNext raffle starts soon — keep unlocking boxes!`,
            }),
          });
        } catch (e) {}
      }
    }

    // Auto-create next raffle if weekly
    if (raffle.draw_frequency === "weekly") {
      const nextEnd = new Date();
      nextEnd.setDate(nextEnd.getDate() + 7);
      await supabase.from("raffles").insert({
        title: raffle.title,
        description: raffle.description,
        total_boxes: 8,
        prize_pool: raffle.prize_pool,
        reward_token: raffle.reward_token,
        reward_per_box: raffle.reward_per_box,
        winner_prize: raffle.winner_prize,
        draw_frequency: "weekly",
        ad_zone_id: raffle.ad_zone_id,
        status: "active",
        start_date: new Date().toISOString(),
        end_date: nextEnd.toISOString(),
      });
    }

    json(res, 200, {
      success: true,
      winner: {
        user_id: winner?.user_id,
        name: winnerData?.first_name || "Unknown",
        luck: winner?.total_luck || 0,
        prize: winnerPrize,
      },
      total_participants: allEntries.length,
    });
    return true;
  }

  // ============ ADMIN — WALLET REQUESTS LIST ============
  if (path === "/api/admin/wallet-requests" && method === "GET") {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const status = url.searchParams.get("status") || "pending";

    const { data: requests } = await supabase
      .from("wallet_requests")
      .select("*, users(telegram_id, first_name, username)")
      .eq("status", status)
      .order("created_at", { ascending: false });

    json(res, 200, { requests: requests || [] });
    return true;
  }

  // ============ ADMIN — WALLET REQUEST REVIEW ============
  if (path.startsWith("/api/admin/wallet-requests/") && path.endsWith("/review") && method === "POST") {
    const requestId = path.split("/")[4];
    const body = await readBody(req);
    const { action, note } = body;

    if (!["approved", "rejected"].includes(action)) {
      return json(res, 400, { error: "Invalid action" });
    }

    const { data: wr, error: fetchErr } = await supabase
      .from("wallet_requests")
      .select("*, users(id, gram, telegram_id, first_name)")
      .eq("id", requestId)
      .single();

    if (fetchErr || !wr) return json(res, 404, { error: "Request not found" });
    if (wr.status !== "pending") return json(res, 400, { error: "Request already reviewed" });

    await supabase
      .from("wallet_requests")
      .update({ status: action, admin_note: note || null, reviewed_at: new Date().toISOString() })
      .eq("id", requestId);

    if (action === "rejected") {
      const newGram = (wr.users.gram || 0) + wr.amount;
      await supabase.from("users").update({ gram: newGram }).eq("id", wr.user_id);

      await supabase.from("transactions").insert({
        user_id: wr.user_id,
        type: "withdraw_refund",
        amount: wr.amount,
        token: "gram",
        description: `Withdrawal rejected — ${wr.amount} Gram refunded`,
      });
    }

    try {
      const msg = action === "approved"
        ? `✅ Your withdrawal of ${wr.amount} Gram has been approved!`
        : `❌ Your withdrawal of ${wr.amount} Gram has been rejected.${note ? `\nReason: ${note}` : ""}`;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: wr.users.telegram_id, text: msg }),
      });
    } catch (e) { /* non-blocking */ }

    json(res, 200, { success: true });
    return true;
  }

  // ============ ADMIN AD ROUTES ============

  // GET /api/admin/ad-deposits — List all ad deposits
  if (path === "/api/admin/ad-deposits" && method === "GET") {
    const urlObj = new URL(req.url || "", `http://${req.headers.host}`);
    const status = urlObj.searchParams.get("status") || "pending";
    const { data: deposits } = await supabase
      .from("ad_deposits")
      .select("*, users(telegram_id, first_name, username), tasks(title)")
      .eq("status", status)
      .order("created_at", { ascending: false });
    json(res, 200, { deposits: deposits || [] });
    return true;
  }

  // POST /api/admin/ad-deposits/:id/review — Approve/reject deposit
  if (path?.match(/^\/api\/admin\/ad-deposits\/[a-f0-9-]+\/review$/) && method === "POST") {
    const depositId = path.split("/")[4];
    const body = await readBody(req);
    const { action, admin_note } = body;

    const { data: deposit } = await supabase.from("ad_deposits").select("*, users(telegram_id, first_name), tasks(id)").eq("id", depositId).single();
    if (!deposit) return json(res, 404, { error: "Deposit not found" });

    await supabase.from("ad_deposits").update({
      status: action, admin_note, reviewed_at: new Date().toISOString(),
    }).eq("id", depositId);

    if (action === "approved" && deposit.task_id) {
      await supabase.from("tasks").update({
        is_active: true, ad_status: "active",
      }).eq("id", deposit.task_id);
    }

    try {
      const msg = action === "approved"
        ? `✅ Your ad deposit of ${deposit.amount} Gram has been approved! Your task is now live.`
        : `❌ Your ad deposit of ${deposit.amount} Gram has been rejected.${admin_note ? `\nReason: ${admin_note}` : ""}`;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: deposit.users.telegram_id, text: msg }),
      });
    } catch (e) { /* non-blocking */ }

    json(res, 200, { success: true });
    return true;
  }

  // GET /api/admin/ad-settings — Get ad settings
  if (path === "/api/admin/ad-settings" && method === "GET") {
    const pricePer1k = await getSetting(supabase, "ad_price_per_1k");
    json(res, 200, { price_per_1k: parseFloat(pricePer1k || "50") });
    return true;
  }

  // PUT /api/admin/ad-settings — Update ad settings
  if (path === "/api/admin/ad-settings" && method === "PUT") {
    const body = await readBody(req);
    if (body.price_per_1k !== undefined) await setSetting(supabase, "ad_price_per_1k", String(body.price_per_1k));
    json(res, 200, { success: true });
    return true;
  }

  // GET /api/admin/ad-stats — Get advertise stats
  if (path === "/api/admin/ad-stats" && method === "GET") {
    const [{ count: pendingDeposits }, { count: totalAdTasks }] = await Promise.all([
      supabase.from("ad_deposits").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("tasks").select("*", { count: "exact", head: true }).not("advertiser_id", "is", null),
    ]);
    json(res, 200, { pendingDeposits: pendingDeposits || 0, totalAdTasks: totalAdTasks || 0 });
    return true;
  }

  json(res, 404, { error: "Not found" });
  return true;
}

// Helper: Send JSON response
function json(res: any, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Helper: Read request body
function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: any) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}
