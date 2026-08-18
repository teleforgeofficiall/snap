import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";

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
    const rewards = [10, 15, 20, 25, 30, 35, 50];
    const reward = rewards[Math.min(streak - 1, rewards.length - 1)];

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
    } else {
      await supabase
        .from("users")
        .update({ gram: (user.gram || 0) + task.reward_amount })
        .eq("id", user.id);
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
      .select("*")
      .eq("user_id", user.id)
      .eq("raffle_id", raffle.id)
      .single();

    const { count: totalEntries } = await supabase
      .from("raffle_entries")
      .select("*", { count: "exact", head: true })
      .eq("raffle_id", raffle.id);

    json(res, 200, {
      raffle: {
        ...raffle,
        user_boxes_unlocked: entry?.boxes_unlocked || 0,
        user_win_rate: entry?.win_rate || 0,
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

    const { data: box } = await supabase
      .from("raffle_boxes")
      .select("*")
      .eq("raffle_id", raffle_id)
      .eq("box_number", box_number)
      .single();

    if (!box) {
      json(res, 404, { error: "Box not found" });
      return true;
    }

    if (box.is_unlocked) {
      json(res, 400, { error: "Box already unlocked" });
      return true;
    }

    await supabase
      .from("raffle_boxes")
      .update({
        is_unlocked: true,
        unlocked_by: user.id,
        unlocked_at: new Date().toISOString(),
      })
      .eq("id", box.id);

    let { data: entry } = await supabase
      .from("raffle_entries")
      .select("*")
      .eq("user_id", user.id)
      .eq("raffle_id", raffle_id)
      .single();

    if (!entry) {
      const { data: newEntry } = await supabase
        .from("raffle_entries")
        .insert({
          user_id: user.id,
          raffle_id,
          boxes_unlocked: 1,
          win_rate: 5,
        })
        .select()
        .single();
      entry = newEntry;
    } else {
      const newUnlocked = (entry.boxes_unlocked || 0) + 1;
      const { data: raffle } = await supabase
        .from("raffles")
        .select("total_boxes")
        .eq("id", raffle_id)
        .single();
      const totalBoxes = raffle?.total_boxes || 20;
      const newWinRate = (newUnlocked / totalBoxes) * 100;

      await supabase
        .from("raffle_entries")
        .update({
          boxes_unlocked: newUnlocked,
          win_rate: newWinRate,
        })
        .eq("id", entry.id);

      entry.boxes_unlocked = newUnlocked;
      entry.win_rate = newWinRate;
    }

    // Credit reward to user balance
    const rewardToken = box.reward_token || "GRAM";
    if (rewardToken === "SNAP") {
      await supabase
        .from("users")
        .update({ balance: (user.balance || 0) + box.reward_amount })
        .eq("id", user.id);
    } else {
      await supabase
        .from("users")
        .update({ gram: (user.gram || 0) + box.reward_amount })
        .eq("id", user.id);
    }

    await supabase.from("transactions").insert({
      user_id: user.id,
      type: "raffle_reward",
      amount: box.reward_amount,
      token: rewardToken,
      description: "Raffle box unlocked",
    });

    json(res, 200, {
      success: true,
      reward: box.reward_amount,
      token: box.reward_token || "GRAM",
      boxes_unlocked: entry.boxes_unlocked,
      win_rate: entry.win_rate,
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

    json(res, 200, {
      referral_code: user.referral_code,
      referral_link: `https://t.me/SnapbucksAirdrop_Bot?start=${user.referral_code}`,
      total_referrals: user.referral_count || 0,
      referrals: referrals || [],
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
          } else {
            const { data: u } = await supabase.from("users").select("gram").eq("id", sub.user_id).single();
            await supabase.from("users").update({ gram: (u?.gram || 0) + task.reward_amount }).eq("id", sub.user_id);
            await supabase.from("transactions").insert({ user_id: sub.user_id, type: "task_reward", amount: task.reward_amount, token: "GRAM", description: `Task approved` });
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
