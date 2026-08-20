-- Snapbucks Telegram Bot Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  first_name TEXT,
  username TEXT,
  balance INTEGER DEFAULT 0,
  gram INTEGER DEFAULT 0,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by UUID REFERENCES users(id),
  referral_count INTEGER DEFAULT 0,
  daily_claim_date TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  eligible BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  referred_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Channels table (multi-channel support)
CREATE TABLE IF NOT EXISTS channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id BIGINT NOT NULL,
  channel_username TEXT NOT NULL,
  channel_title TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings table (configurable values)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('daily_bonus', '10'),
  ('per_referral_points', '100'),
  ('mini_app_url', ''),
  ('claim_message', '💸 Claim SNAP is available from September 1, 2026')
ON CONFLICT (key) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- =====================================================
-- PHASE 1: NEW TABLES FOR MINI APP INTEGRATION
-- =====================================================

-- Transaction history
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  token TEXT DEFAULT 'SNAP',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  task_type TEXT NOT NULL,
  reward_amount INTEGER DEFAULT 0,
  reward_token TEXT DEFAULT 'SNAP',
  task_url TEXT,
  reference_image_url TEXT,
  required_screenshots INTEGER DEFAULT 1,
  channel_username TEXT,
  custom_fields JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task submissions (user proof/data)
CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  submitted_data JSONB,
  admin_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);

-- Task submission images
CREATE TABLE IF NOT EXISTS task_submission_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID REFERENCES task_submissions(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type TEXT DEFAULT 'screenshot',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task completions
CREATE TABLE IF NOT EXISTS task_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  reward_earned INTEGER DEFAULT 0,
  UNIQUE(user_id, task_id)
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  project_name TEXT NOT NULL,
  project_logo_url TEXT,
  reward_token TEXT DEFAULT 'GRAM',
  total_budget INTEGER DEFAULT 0,
  rewards_per_user INTEGER DEFAULT 0,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign tasks
CREATE TABLE IF NOT EXISTS campaign_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  task_type TEXT NOT NULL,
  task_url TEXT,
  reward_amount INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign participants
CREATE TABLE IF NOT EXISTS campaign_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, campaign_id)
);

-- Campaign task completions
CREATE TABLE IF NOT EXISTS campaign_task_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES campaign_tasks(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'completed',
  reward_earned INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, task_id)
);

-- Daily check-in tracking
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,
  streak INTEGER DEFAULT 1,
  reward_earned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, checkin_date)
);

-- Spin tracking
CREATE TABLE IF NOT EXISTS spins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  spin_date TEXT NOT NULL,
  reward_earned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raffles
CREATE TABLE IF NOT EXISTS raffles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  total_boxes INTEGER DEFAULT 20,
  prize_pool INTEGER DEFAULT 0,
  reward_token TEXT DEFAULT 'SNAP',
  status TEXT DEFAULT 'active',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raffle boxes
CREATE TABLE IF NOT EXISTS raffle_boxes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  raffle_id UUID REFERENCES raffles(id) ON DELETE CASCADE,
  box_number INTEGER NOT NULL,
  reward_amount INTEGER DEFAULT 0,
  is_unlocked BOOLEAN DEFAULT FALSE,
  unlocked_by UUID REFERENCES users(id),
  unlocked_at TIMESTAMPTZ
);

-- Raffle entries
CREATE TABLE IF NOT EXISTS raffle_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  raffle_id UUID REFERENCES raffles(id) ON DELETE CASCADE,
  boxes_unlocked INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, raffle_id)
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(is_active);
CREATE INDEX IF NOT EXISTS idx_task_completions_user ON task_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_participants_user ON campaign_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(checkin_date);
CREATE INDEX IF NOT EXISTS idx_spins_user ON spins(user_id);
CREATE INDEX IF NOT EXISTS idx_spins_date ON spins(spin_date);
CREATE INDEX IF NOT EXISTS idx_raffles_status ON raffles(status);
CREATE INDEX IF NOT EXISTS idx_raffle_boxes_raffle ON raffle_boxes(raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_entries_user ON raffle_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_user ON task_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_status ON task_submissions(status);
CREATE INDEX IF NOT EXISTS idx_task_submission_images_submission ON task_submission_images(submission_id);

-- Storage bucket for task images
INSERT INTO storage.buckets (id, name, public) VALUES ('task-images', 'task-images', true) ON CONFLICT (id) DO NOTHING;

-- Wallet Withdraw Requests
CREATE TABLE IF NOT EXISTS wallet_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  token TEXT NOT NULL DEFAULT 'gram',
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_requests_user ON wallet_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_requests_status ON wallet_requests(status);
