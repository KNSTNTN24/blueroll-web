-- Baseline schema, recovered from supabase_migrations.schema_migrations (version 001) on 2026-10-11.
-- Applied in prod before migrations were kept in this repo. Kept so the local history matches prod.

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA extensions;

-- ============================================
-- BUSINESSES
-- ============================================
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  registration_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- PROFILES (extends auth.users)
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'chef', 'kitchen_staff', 'front_of_house')),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_business ON profiles(business_id);

CREATE INDEX idx_profiles_role ON profiles(role);

-- ============================================
-- INVITES
-- ============================================
CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'chef', 'kitchen_staff', 'front_of_house')),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id),
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invites_token ON invites(token);

CREATE INDEX idx_invites_email ON invites(email);

-- ============================================
-- CHECKLIST TEMPLATES
-- ============================================
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'four_weekly', 'custom')),
  assigned_roles TEXT[] NOT NULL DEFAULT '{}',
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sfbb_section TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checklist_templates_business ON checklist_templates(business_id);

-- ============================================
-- CHECKLIST TEMPLATE ITEMS
-- ============================================
CREATE TABLE checklist_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  item_type TEXT NOT NULL CHECK (item_type IN ('tick', 'temperature', 'text', 'yes_no')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  sfbb_reference TEXT,
  min_value NUMERIC,
  max_value NUMERIC,
  unit TEXT
);

CREATE INDEX idx_checklist_items_template ON checklist_template_items(template_id);

-- ============================================
-- CHECKLIST COMPLETIONS
-- ============================================
CREATE TABLE checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  completed_by UUID NOT NULL REFERENCES profiles(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_off_by UUID REFERENCES profiles(id),
  notes TEXT,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_completions_template ON checklist_completions(template_id);

CREATE INDEX idx_completions_business_date ON checklist_completions(business_id, completed_at);

-- ============================================
-- CHECKLIST RESPONSES
-- ============================================
CREATE TABLE checklist_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id UUID NOT NULL REFERENCES checklist_completions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES checklist_template_items(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  notes TEXT,
  flagged BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_responses_completion ON checklist_responses(completion_id);

-- ============================================
-- INGREDIENTS
-- ============================================
CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  allergens TEXT[] NOT NULL DEFAULT '{}',
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_ingredients_business ON ingredients(business_id);

CREATE INDEX idx_ingredients_name ON ingredients(name);

-- ============================================
-- RECIPES
-- ============================================
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('starter', 'main', 'dessert', 'side', 'sauce', 'drink', 'other')),
  instructions TEXT NOT NULL DEFAULT '',
  cooking_method TEXT,
  cooking_temp NUMERIC,
  cooking_time NUMERIC,
  cooking_time_unit TEXT CHECK (cooking_time_unit IN ('minutes', 'hours')),
  sfbb_check_method TEXT,
  extra_care_flags TEXT[] NOT NULL DEFAULT '{}',
  reheating_instructions TEXT,
  hot_holding_required BOOLEAN NOT NULL DEFAULT FALSE,
  chilling_method TEXT,
  photo_url TEXT,
  source_video_url TEXT,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipes_business ON recipes(business_id);

CREATE INDEX idx_recipes_category ON recipes(category);

-- ============================================
-- RECIPE INGREDIENTS (junction)
-- ============================================
CREATE TABLE recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity TEXT,
  unit TEXT,
  notes TEXT
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

-- ============================================
-- MENU ITEMS
-- ============================================
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_menu_items_business ON menu_items(business_id);

-- ============================================
-- DIARY ENTRIES
-- ============================================
CREATE TABLE diary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  signed_by UUID REFERENCES profiles(id),
  notes TEXT,
  opening_done BOOLEAN NOT NULL DEFAULT FALSE,
  closing_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(date, business_id)
);

CREATE INDEX idx_diary_business_date ON diary_entries(business_id, date);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read);

-- ============================================
-- NOTIFICATION RULES
-- ============================================
CREATE TABLE notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}',
  recipient_roles TEXT[] NOT NULL DEFAULT '{}',
  channels TEXT[] NOT NULL DEFAULT '{in_app}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- SUPPLIERS
-- ============================================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  address TEXT,
  goods_supplied TEXT,
  delivery_days TEXT[] NOT NULL DEFAULT '{}',
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_business ON suppliers(business_id);

-- ============================================
-- INCIDENTS
-- ============================================
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('complaint', 'incident')),
  description TEXT NOT NULL,
  action_taken TEXT,
  follow_up TEXT,
  reported_by UUID NOT NULL REFERENCES profiles(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incidents_business ON incidents(business_id, date);

-- ============================================
-- STAFF TRAINING RECORDS
-- ============================================
CREATE TABLE training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  safe_method TEXT NOT NULL,
  trained_at DATE NOT NULL DEFAULT CURRENT_DATE,
  trained_by UUID REFERENCES profiles(id),
  notes TEXT,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX idx_training_profile ON training_records(profile_id);

-- ============================================
-- FOUR WEEKLY REVIEWS
-- ============================================
CREATE TABLE four_weekly_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary TEXT,
  action_items JSONB NOT NULL DEFAULT '[]',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;

ALTER TABLE checklist_responses ENABLE ROW LEVEL SECURITY;

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

ALTER TABLE training_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE four_weekly_reviews ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Businesses: users can see their own business
CREATE POLICY "Users can view own business" ON businesses
  FOR SELECT USING (
    id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

-- Profiles: users can see profiles in their business
CREATE POLICY "Users can view business profiles" ON profiles
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Invites: managers+ can manage invites
CREATE POLICY "Managers can manage invites" ON invites
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- Checklist templates: business members can view, managers+ can modify
CREATE POLICY "Business members can view templates" ON checklist_templates
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Managers can manage templates" ON checklist_templates
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- Checklist template items: same as templates
CREATE POLICY "Business members can view items" ON checklist_template_items
  FOR SELECT USING (
    template_id IN (
      SELECT id FROM checklist_templates WHERE business_id IN (
        SELECT business_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Managers can manage items" ON checklist_template_items
  FOR ALL USING (
    template_id IN (
      SELECT id FROM checklist_templates WHERE business_id IN (
        SELECT business_id FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'manager')
      )
    )
  );

-- Checklist completions: business members can view and create
CREATE POLICY "Business members can view completions" ON checklist_completions
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Business members can create completions" ON checklist_completions
  FOR INSERT WITH CHECK (
    completed_by = auth.uid() AND
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

-- Checklist responses: same access as completions
CREATE POLICY "Business members can view responses" ON checklist_responses
  FOR SELECT USING (
    completion_id IN (
      SELECT id FROM checklist_completions WHERE business_id IN (
        SELECT business_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Business members can create responses" ON checklist_responses
  FOR INSERT WITH CHECK (
    completion_id IN (
      SELECT id FROM checklist_completions WHERE completed_by = auth.uid()
    )
  );

-- Ingredients: business members can view, chefs+ can manage
CREATE POLICY "Business members can view ingredients" ON ingredients
  FOR SELECT USING (
    business_id IS NULL OR
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Chefs can manage ingredients" ON ingredients
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager', 'chef')
    )
  );

-- Recipes: business members can view, chefs+ can manage
CREATE POLICY "Business members can view recipes" ON recipes
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Chefs can manage recipes" ON recipes
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager', 'chef')
    )
  );

-- Recipe ingredients
CREATE POLICY "Business members can view recipe ingredients" ON recipe_ingredients
  FOR SELECT USING (
    recipe_id IN (
      SELECT id FROM recipes WHERE business_id IN (
        SELECT business_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Chefs can manage recipe ingredients" ON recipe_ingredients
  FOR ALL USING (
    recipe_id IN (
      SELECT id FROM recipes WHERE business_id IN (
        SELECT business_id FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'manager', 'chef')
      )
    )
  );

-- Menu items: all can view, managers+ can manage
CREATE POLICY "Business members can view menu" ON menu_items
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Managers can manage menu" ON menu_items
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager', 'chef')
    )
  );

-- Diary entries
CREATE POLICY "Business members can view diary" ON diary_entries
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Business members can manage diary" ON diary_entries
  FOR ALL USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

-- Notifications: users can see own
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- Notification rules
CREATE POLICY "Business members can view rules" ON notification_rules
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Managers can manage rules" ON notification_rules
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- Suppliers
CREATE POLICY "Business members can view suppliers" ON suppliers
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Managers can manage suppliers" ON suppliers
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- Incidents
CREATE POLICY "Business members can view incidents" ON incidents
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Business members can create incidents" ON incidents
  FOR INSERT WITH CHECK (
    reported_by = auth.uid() AND
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

-- Training records
CREATE POLICY "Business members can view training" ON training_records
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Managers can manage training" ON training_records
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- Four weekly reviews
CREATE POLICY "Business members can view reviews" ON four_weekly_reviews
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Managers can manage reviews" ON four_weekly_reviews
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_checklist_templates_updated_at
  BEFORE UPDATE ON checklist_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
