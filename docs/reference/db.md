# Database reference (generated)

> Generated from the live Supabase project `rszrggreuarvodcqeqrj` on 2026-10-16. **Do not edit by hand** —
> run `SUPABASE_ACCESS_TOKEN=… npx tsx scripts/gen-db-reference.ts`. Structure only: no row data, function bodies or
> cron commands. What things *mean* is in [`docs/domain/`](../domain/README.md).

Tables: 71 · Functions: 74 · Cron jobs: 7 · Storage buckets: 2

## Tables

[`ai_usage_log`](#ai_usage_log) · [`businesses`](#businesses) · [`capability_catalog`](#capability_catalog) · [`channel_delivery_errors`](#channel_delivery_errors) · [`channel_flows`](#channel_flows) · [`channel_form_tokens`](#channel_form_tokens) · [`channel_group_checklists`](#channel_group_checklists) · [`channel_group_events`](#channel_group_events) · [`channel_group_link_codes`](#channel_group_link_codes) · [`channel_group_members`](#channel_group_members) · [`channel_group_reminders_sent`](#channel_group_reminders_sent) · [`channel_group_takes`](#channel_group_takes) · [`channel_groups`](#channel_groups) · [`channel_identities`](#channel_identities) · [`channel_link_codes`](#channel_link_codes) · [`channel_live_lists`](#channel_live_lists) · [`channel_messages_log`](#channel_messages_log) · [`channel_reminders_sent`](#channel_reminders_sent) · [`checklist_completions`](#checklist_completions) · [`checklist_drafts`](#checklist_drafts) · [`checklist_instances`](#checklist_instances) · [`checklist_responses`](#checklist_responses) · [`checklist_template_items`](#checklist_template_items) · [`checklist_templates`](#checklist_templates) · [`deliveries`](#deliveries) · [`delivery_photos`](#delivery_photos) · [`demo_force_exit`](#demo_force_exit) · [`diary_entries`](#diary_entries) · [`dinesafe_cache`](#dinesafe_cache) · [`dinesafe_refresh_meta`](#dinesafe_refresh_meta) · [`document_access`](#document_access) · [`documents`](#documents) · [`feedback_requests`](#feedback_requests) · [`four_weekly_reviews`](#four_weekly_reviews) · [`google_connections`](#google_connections) · [`google_locations`](#google_locations) · [`google_oauth_states`](#google_oauth_states) · [`haccp_pack_data`](#haccp_pack_data) · [`haccp_plan_shares`](#haccp_plan_shares) · [`haccp_setup_sessions`](#haccp_setup_sessions) · [`haccp_signoffs`](#haccp_signoffs) · [`incidents`](#incidents) · [`ingredients`](#ingredients) · [`invites`](#invites) · [`member_capability_overrides`](#member_capability_overrides) · [`member_sites`](#member_sites) · [`menu_categories`](#menu_categories) · [`menu_items`](#menu_items) · [`notification_rules`](#notification_rules) · [`notifications`](#notifications) · [`profiles`](#profiles) · [`recipe_ingredients`](#recipe_ingredients) · [`recipe_sites`](#recipe_sites) · [`recipe_tags`](#recipe_tags) · [`recipes`](#recipes) · [`review_audit`](#review_audit) · [`review_cards`](#review_cards) · [`review_drafts`](#review_drafts) · [`review_edit_prompts`](#review_edit_prompts) · [`review_routes`](#review_routes) · [`review_settings`](#review_settings) · [`reviews`](#reviews) · [`roles`](#roles) · [`sites`](#sites) · [`staff_checkins`](#staff_checkins) · [`suppliers`](#suppliers) · [`tags`](#tags) · [`template_email_log`](#template_email_log) · [`template_leads`](#template_leads) · [`training_records`](#training_records) · [`trial_grants`](#trial_grants)

### `ai_usage_log`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | bigint | no | nextval('ai_usage_log_id_seq'::regclass) |  |
| `business_id` | uuid | no |  |  |
| `fn` | text | no |  |  |
| `input_tokens` | integer | no | 0 |  |
| `output_tokens` | integer | no | 0 |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `ai_usage_log_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `ai_usage_log_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `ai_usage_log_pkey`: CREATE UNIQUE INDEX ai_usage_log_pkey ON public.ai_usage_log USING btree (id)
- `idx_ai_usage_log_business`: CREATE INDEX idx_ai_usage_log_business ON public.ai_usage_log USING btree (business_id, created_at DESC)

**Policies**

_No policies._

### `businesses`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `name` | text | no |  |  |
| `address` | text | yes |  |  |
| `registration_number` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `fhrs_id` | integer | yes |  |  |
| `fsa_rating` | text | yes |  |  |
| `post_code` | text | yes |  |  |
| `stripe_customer_id` | text | yes |  |  |
| `subscription_status` | text | yes | 'none'::text |  |
| `trial_ends_at` | timestamp with time zone | yes |  |  |
| `subscription_id` | text | yes |  |  |
| `haccp_last_reviewed_at` | timestamp with time zone | yes |  |  |
| `haccp_auto_fill` | boolean | yes | true |  |
| `equipment` | text[] | yes | '{}'::text[] |  |
| `iap_provider` | text | yes |  |  |
| `iap_product_id` | text | yes |  |  |
| `iap_purchase_token` | text | yes |  |  |
| `iap_original_transaction_id` | text | yes |  |  |
| `iap_expires_at` | timestamp with time zone | yes |  |  |
| `manual_status` | text | yes |  |  |
| `manual_until` | timestamp with time zone | yes |  |  |
| `stripe_status` | text | yes |  |  |
| `stripe_until` | timestamp with time zone | yes |  |  |
| `iap_status` | text | yes |  |  |
| `notification_prefs` | jsonb | no | '{}'::jsonb |  |
| `deleted_at` | timestamp with time zone | yes |  |  |
| `signup_trial` | boolean | no | false | True when this business's entitlement is the automatic 14-day trial granted at signup, rather than a purchase or a manual grant. The app shows the paywall while this is the only live source. Rows predating 2026-08-03 stay false and are treated as manual grants, so existing users are untouched. |
| `whatsapp_enabled` | boolean | no | false |  |
| `telegram_enabled` | boolean | no | false |  |

**Constraints**

- `businesses_iap_provider_check` (check): CHECK ((iap_provider = ANY (ARRAY['apple'::text, 'google'::text])))
- `businesses_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `businesses_pkey`: CREATE UNIQUE INDEX businesses_pkey ON public.businesses USING btree (id)
- `idx_businesses_iap_original_transaction_id`: CREATE INDEX idx_businesses_iap_original_transaction_id ON public.businesses USING btree (iap_original_transaction_id) WHERE (iap_original_transaction_id IS NOT NULL)
- `idx_businesses_iap_purchase_token`: CREATE INDEX idx_businesses_iap_purchase_token ON public.businesses USING btree (iap_purchase_token) WHERE (iap_purchase_token IS NOT NULL)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (id = demo_business_id()) |  |
| `Users can update own business` | UPDATE | permissive | {public} | (id = get_my_business_id()) | (id = get_my_business_id()) |
| `Users can view own business` | SELECT | permissive | {public} | ((id = get_my_business_id()) AND (deleted_at IS NULL)) |  |

**Triggers**

- `trg_business_default_site` AFTER INSERT: EXECUTE FUNCTION create_default_site()
- `trg_guard_telegram_enabled` BEFORE UPDATE: EXECUTE FUNCTION guard_telegram_enabled()
- `trg_guard_whatsapp_enabled` BEFORE UPDATE: EXECUTE FUNCTION guard_whatsapp_enabled()
- `trg_ntfy_subscription_change` AFTER UPDATE: EXECUTE FUNCTION _on_subscription_status_change()
- `trg_protect_business_deleted_at` BEFORE UPDATE: EXECUTE FUNCTION protect_business_deleted_at()
- `trg_protect_business_entitlement` BEFORE UPDATE: EXECUTE FUNCTION protect_business_entitlement()
- `trg_seed_business_roles` AFTER INSERT: EXECUTE FUNCTION seed_business_roles()
- `trg_set_default_trial` BEFORE INSERT: EXECUTE FUNCTION set_default_trial()
- `trg_zz_subscription_arbiter` BEFORE INSERT/UPDATE: EXECUTE FUNCTION _subscription_arbiter()
- `update_businesses_updated_at` BEFORE UPDATE: EXECUTE FUNCTION update_updated_at()

### `capability_catalog`

RLS: **disabled**

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `cap` | text | no |  |  |

**Constraints**

- `capability_catalog_pkey` (primary key): PRIMARY KEY (cap)

**Indexes**

- `capability_catalog_pkey`: CREATE UNIQUE INDEX capability_catalog_pkey ON public.capability_catalog USING btree (cap)

**Policies**

_No policies._

### `channel_delivery_errors`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | bigint | no |  |  |
| `wa_message_id` | text | no |  |  |
| `error_code` | integer | yes |  |  |
| `error_title` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_delivery_errors_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `channel_delivery_errors_pkey`: CREATE UNIQUE INDEX channel_delivery_errors_pkey ON public.channel_delivery_errors USING btree (id)
- `channel_delivery_errors_wamid_idx`: CREATE INDEX channel_delivery_errors_wamid_idx ON public.channel_delivery_errors USING btree (wa_message_id)

**Policies**

_No policies._

### `channel_flows`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `template_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `channel` | text | no | 'whatsapp'::text |  |
| `flow_id` | text | yes |  |  |
| `items_hash` | text | no |  |  |
| `item_ids` | uuid[] | no |  |  |
| `status` | text | no |  |  |
| `error` | text | yes |  |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `prev_flow_id` | text | yes |  |  |
| `prev_replaced_at` | timestamp with time zone | yes |  |  |

**Constraints**

- `channel_flows_pkey` (primary key): PRIMARY KEY (template_id, site_id, channel)
- `channel_flows_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `channel_flows_status_check` (check): CHECK ((status = ANY (ARRAY['published'::text, 'error'::text, 'unsupported'::text])))
- `channel_flows_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `channel_flows_pkey`: CREATE UNIQUE INDEX channel_flows_pkey ON public.channel_flows USING btree (template_id, site_id, channel)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers read flows` | SELECT | permissive | {public} | (EXISTS ( SELECT 1 FROM checklist_templates t WHERE ((t.id = channel_flows.template_id) AND is_active_business_manager(t.business_id)))) |  |

### `channel_form_tokens`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `token` | text | no |  |  |
| `kind` | text | no |  |  |
| `business_id` | uuid | no |  |  |
| `profile_id` | uuid | yes |  |  |
| `site_id` | uuid | no |  |  |
| `template_id` | uuid | yes |  |  |
| `item_ids` | uuid[] | yes |  |  |
| `response_id` | uuid | yes |  |  |
| `expires_at` | timestamp with time zone | no | (now() + '24:00:00'::interval) |  |
| `used_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `group_id` | uuid | yes |  |  |
| `used_by_name` | text | yes |  |  |

**Constraints**

- `channel_form_tokens_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `channel_form_tokens_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `channel_form_tokens_group_kind_check` (check): CHECK ( CASE kind WHEN 'group_checklist'::text THEN ((group_id IS NOT NULL) AND (profile_id IS NULL)) WHEN 'checklist'::text THEN (profile_id IS NOT NULL) ELSE ((profile_id IS NOT NULL) AND (group_id IS NULL)) END)
- `channel_form_tokens_kind_check` (check): CHECK ((kind = ANY (ARRAY['checklist'::text, 'corrective'::text, 'group_checklist'::text])))
- `channel_form_tokens_owner_check` (check): CHECK (((profile_id IS NOT NULL) OR (group_id IS NOT NULL)))
- `channel_form_tokens_pkey` (primary key): PRIMARY KEY (token)
- `channel_form_tokens_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
- `channel_form_tokens_response_id_fkey` (foreign key): FOREIGN KEY (response_id) REFERENCES checklist_responses(id) ON DELETE CASCADE
- `channel_form_tokens_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `channel_form_tokens_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `channel_form_tokens_pkey`: CREATE UNIQUE INDEX channel_form_tokens_pkey ON public.channel_form_tokens USING btree (token)

**Policies**

_No policies._

### `channel_group_checklists`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `group_id` | uuid | no |  |  |
| `template_id` | uuid | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_group_checklists_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `channel_group_checklists_pkey` (primary key): PRIMARY KEY (group_id, template_id)
- `channel_group_checklists_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `channel_group_checklists_pkey`: CREATE UNIQUE INDEX channel_group_checklists_pkey ON public.channel_group_checklists USING btree (group_id, template_id)
- `idx_channel_group_checklists_template`: CREATE INDEX idx_channel_group_checklists_template ON public.channel_group_checklists USING btree (template_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers add group checklists` | INSERT | permissive | {public} |  | (EXISTS ( SELECT 1 FROM (channel_groups g JOIN checklist_templates t ON (((t.id = channel_group_checklists.template_id) AND (t.business_id = g.business_id)))) WHERE ((g.id = channel_group_checklists.group_id) AND (g.unlinked_at IS NULL) AND ((g.site_id IS NULL) OR (t.site_id IS NULL) OR (t.site_id = g.site_id)) AND is_active_business_manager(g.business_id)))) |
| `managers read group checklists` | SELECT | permissive | {public} | (EXISTS ( SELECT 1 FROM channel_groups g WHERE ((g.id = channel_group_checklists.group_id) AND is_active_business_manager(g.business_id)))) |  |
| `managers remove group checklists` | DELETE | permissive | {public} | (EXISTS ( SELECT 1 FROM channel_groups g WHERE ((g.id = channel_group_checklists.group_id) AND is_active_business_manager(g.business_id)))) |  |

### `channel_group_events`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `group_id` | uuid | no |  |  |
| `kind` | text | no |  |  |
| `key` | text | no |  |  |
| `sent_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_group_events_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `channel_group_events_pkey` (primary key): PRIMARY KEY (group_id, kind, key)

**Indexes**

- `channel_group_events_pkey`: CREATE UNIQUE INDEX channel_group_events_pkey ON public.channel_group_events USING btree (group_id, kind, key)

**Policies**

_No policies._

### `channel_group_link_codes`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `code` | text | no |  |  |
| `business_id` | uuid | no |  |  |
| `channel` | text | no | 'telegram'::text |  |
| `issued_by` | uuid | no | auth.uid() |  |
| `expires_at` | timestamp with time zone | no | (now() + '00:15:00'::interval) |  |
| `used_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_group_link_codes_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `channel_group_link_codes_channel_check` (check): CHECK ((channel = ANY (ARRAY['telegram'::text, 'whatsapp'::text, 'telegram_reviews'::text])))
- `channel_group_link_codes_code_check` (check): CHECK ((code ~ '^[0-9]{6}$'::text))
- `channel_group_link_codes_issued_by_fkey` (foreign key): FOREIGN KEY (issued_by) REFERENCES profiles(id) ON DELETE CASCADE
- `channel_group_link_codes_pkey` (primary key): PRIMARY KEY (code)

**Indexes**

- `channel_group_link_codes_pkey`: CREATE UNIQUE INDEX channel_group_link_codes_pkey ON public.channel_group_link_codes USING btree (code)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers read group link codes` | SELECT | permissive | {public} | is_active_business_manager(business_id) |  |
| `review managers read review link codes` | SELECT | permissive | {public} | ((channel = 'telegram_reviews'::text) AND can_manage_reviews(business_id)) |  |

### `channel_group_members`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `group_id` | uuid | no |  |  |
| `profile_id` | uuid | no |  |  |
| `phone` | text | no |  |  |
| `status` | text | no | 'invited'::text |  |
| `invited_by` | uuid | yes |  |  |
| `invited_at` | timestamp with time zone | no | now() |  |
| `joined_at` | timestamp with time zone | yes |  |  |
| `removed_at` | timestamp with time zone | yes |  |  |
| `last_invite_sent_at` | timestamp with time zone | yes |  |  |
| `unreachable_at` | timestamp with time zone | yes |  |  |

**Constraints**

- `channel_group_members_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `channel_group_members_group_id_profile_id_key` (unique): UNIQUE (group_id, profile_id)
- `channel_group_members_invited_by_fkey` (foreign key): FOREIGN KEY (invited_by) REFERENCES profiles(id) ON DELETE SET NULL
- `channel_group_members_phone_check` (check): CHECK ((phone ~ '^[0-9]{10,15}$'::text))
- `channel_group_members_pkey` (primary key): PRIMARY KEY (id)
- `channel_group_members_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
- `channel_group_members_status_check` (check): CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'removed'::text])))

**Indexes**

- `channel_group_members_group_id_profile_id_key`: CREATE UNIQUE INDEX channel_group_members_group_id_profile_id_key ON public.channel_group_members USING btree (group_id, profile_id)
- `channel_group_members_pkey`: CREATE UNIQUE INDEX channel_group_members_pkey ON public.channel_group_members USING btree (id)
- `idx_channel_group_members_phone`: CREATE INDEX idx_channel_group_members_phone ON public.channel_group_members USING btree (phone) WHERE (status <> 'removed'::text)
- `idx_channel_group_members_profile`: CREATE INDEX idx_channel_group_members_profile ON public.channel_group_members USING btree (profile_id) WHERE (status = 'active'::text)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers read team members` | SELECT | permissive | {public} | (EXISTS ( SELECT 1 FROM channel_groups g WHERE ((g.id = channel_group_members.group_id) AND is_active_business_manager(g.business_id)))) |  |
| `managers remove team members` | UPDATE | permissive | {public} | (EXISTS ( SELECT 1 FROM channel_groups g WHERE ((g.id = channel_group_members.group_id) AND is_active_business_manager(g.business_id)))) | (EXISTS ( SELECT 1 FROM channel_groups g WHERE ((g.id = channel_group_members.group_id) AND is_active_business_manager(g.business_id)))) |

**Triggers**

- `trg_guard_channel_group_members_update` BEFORE UPDATE: EXECUTE FUNCTION guard_channel_group_members_update()

### `channel_group_reminders_sent`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `group_id` | uuid | no |  |  |
| `template_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `period_key` | text | no |  |  |
| `sent_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_group_reminders_sent_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `channel_group_reminders_sent_pkey` (primary key): PRIMARY KEY (group_id, template_id, site_id, period_key)
- `channel_group_reminders_sent_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `channel_group_reminders_sent_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `channel_group_reminders_sent_pkey`: CREATE UNIQUE INDEX channel_group_reminders_sent_pkey ON public.channel_group_reminders_sent USING btree (group_id, template_id, site_id, period_key)

**Policies**

_No policies._

### `channel_group_takes`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `group_id` | uuid | no |  |  |
| `template_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `period_key` | text | no |  |  |
| `profile_id` | uuid | yes |  |  |
| `taken_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_group_takes_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `channel_group_takes_pkey` (primary key): PRIMARY KEY (group_id, template_id, site_id, period_key)
- `channel_group_takes_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
- `channel_group_takes_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `channel_group_takes_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `channel_group_takes_pkey`: CREATE UNIQUE INDEX channel_group_takes_pkey ON public.channel_group_takes USING btree (group_id, template_id, site_id, period_key)

**Policies**

_No policies._

### `channel_groups`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `channel` | text | no | 'telegram'::text |  |
| `chat_id` | text | yes |  |  |
| `title` | text | no | ''::text |  |
| `alerts` | boolean | no | false |  |
| `linked_by` | uuid | yes |  |  |
| `linked_at` | timestamp with time zone | no | now() |  |
| `last_permission_check_at` | timestamp with time zone | yes |  |  |
| `last_permission_warning_at` | timestamp with time zone | yes |  |  |
| `unlinked_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `site_id` | uuid | yes |  |  |

**Constraints**

- `channel_groups_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `channel_groups_channel_chat_id_key` (unique): UNIQUE (channel, chat_id)
- `channel_groups_channel_check` (check): CHECK ((channel = ANY (ARRAY['telegram'::text, 'whatsapp'::text, 'telegram_reviews'::text])))
- `channel_groups_chat_check` (check): CHECK (((channel <> ALL (ARRAY['telegram'::text, 'telegram_reviews'::text])) OR (chat_id IS NOT NULL)))
- `channel_groups_linked_by_fkey` (foreign key): FOREIGN KEY (linked_by) REFERENCES profiles(id) ON DELETE SET NULL
- `channel_groups_pkey` (primary key): PRIMARY KEY (id)
- `channel_groups_site_check` (check): CHECK (((channel <> 'whatsapp'::text) OR (site_id IS NOT NULL)))
- `channel_groups_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `channel_groups_title_check` (check): CHECK (((channel <> 'whatsapp'::text) OR (length(btrim(title)) > 0)))

**Indexes**

- `channel_groups_channel_chat_id_key`: CREATE UNIQUE INDEX channel_groups_channel_chat_id_key ON public.channel_groups USING btree (channel, chat_id)
- `channel_groups_pkey`: CREATE UNIQUE INDEX channel_groups_pkey ON public.channel_groups USING btree (id)
- `idx_channel_groups_business`: CREATE INDEX idx_channel_groups_business ON public.channel_groups USING btree (business_id) WHERE (unlinked_at IS NULL)
- `idx_channel_groups_site`: CREATE INDEX idx_channel_groups_site ON public.channel_groups USING btree (site_id) WHERE (unlinked_at IS NULL)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers create whatsapp teams` | INSERT | permissive | {public} |  | ((channel = 'whatsapp'::text) AND (chat_id IS NULL) AND is_active_business_manager(business_id) AND (EXISTS ( SELECT 1 FROM sites s WHERE ((s.id = channel_groups.site_id) AND (s.business_id = channel_groups.business_id) AND (s.removed_at IS NULL))))) |
| `managers read telegram groups` | SELECT | permissive | {public} | is_active_business_manager(business_id) |  |
| `managers update telegram groups` | UPDATE | permissive | {public} | is_active_business_manager(business_id) | is_active_business_manager(business_id) |
| `review managers read review groups` | SELECT | permissive | {public} | ((channel = 'telegram_reviews'::text) AND can_manage_reviews(business_id)) |  |
| `review managers update review groups` | UPDATE | permissive | {public} | ((channel = 'telegram_reviews'::text) AND can_manage_reviews(business_id)) | ((channel = 'telegram_reviews'::text) AND can_manage_reviews(business_id)) |

**Triggers**

- `trg_guard_channel_groups_update` BEFORE INSERT/UPDATE: EXECUTE FUNCTION guard_channel_groups_update()

### `channel_identities`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `profile_id` | uuid | no |  |  |
| `channel` | text | no |  |  |
| `external_id` | text | no |  |  |
| `consent_at` | timestamp with time zone | no | now() |  |
| `consent_source` | text | no | 'qr_code'::text |  |
| `consent_text_version` | integer | no | 1 |  |
| `linked_by` | uuid | yes |  |  |
| `last_inbound_at` | timestamp with time zone | yes |  |  |
| `revoked_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_identities_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `channel_identities_channel_check` (check): CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'telegram'::text])))
- `channel_identities_linked_by_fkey` (foreign key): FOREIGN KEY (linked_by) REFERENCES profiles(id) ON DELETE SET NULL
- `channel_identities_pkey` (primary key): PRIMARY KEY (id)
- `channel_identities_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE

**Indexes**

- `channel_identities_pkey`: CREATE UNIQUE INDEX channel_identities_pkey ON public.channel_identities USING btree (id)
- `idx_channel_identity_external`: CREATE INDEX idx_channel_identity_external ON public.channel_identities USING btree (channel, external_id) WHERE (revoked_at IS NULL)
- `uq_channel_identity_active`: CREATE UNIQUE INDEX uq_channel_identity_active ON public.channel_identities USING btree (business_id, channel, external_id) WHERE (revoked_at IS NULL)
- `uq_channel_identity_profile`: CREATE UNIQUE INDEX uq_channel_identity_profile ON public.channel_identities USING btree (profile_id, channel) WHERE (revoked_at IS NULL)
- `uq_channel_identity_whatsapp_active`: CREATE UNIQUE INDEX uq_channel_identity_whatsapp_active ON public.channel_identities USING btree (channel, external_id) WHERE ((channel = 'whatsapp'::text) AND (revoked_at IS NULL))

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers read channel identities` | SELECT | permissive | {public} | (is_active_business_manager(business_id) OR (profile_id = auth.uid())) |  |

### `channel_link_codes`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `code` | text | no |  |  |
| `business_id` | uuid | no |  |  |
| `profile_id` | uuid | no |  |  |
| `site_id` | uuid | yes |  |  |
| `issued_by` | uuid | no | auth.uid() |  |
| `expires_at` | timestamp with time zone | no | (now() + '00:15:00'::interval) |  |
| `used_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_link_codes_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `channel_link_codes_code_check` (check): CHECK ((code ~ '^[0-9]{6}$'::text))
- `channel_link_codes_issued_by_fkey` (foreign key): FOREIGN KEY (issued_by) REFERENCES profiles(id) ON DELETE CASCADE
- `channel_link_codes_pkey` (primary key): PRIMARY KEY (code)
- `channel_link_codes_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
- `channel_link_codes_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `channel_link_codes_pkey`: CREATE UNIQUE INDEX channel_link_codes_pkey ON public.channel_link_codes USING btree (code)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers read link codes` | SELECT | permissive | {public} | is_active_business_manager(business_id) |  |

### `channel_live_lists`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `group_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `list_date` | date | no |  |  |
| `message_id` | text | no |  |  |
| `tokens` | jsonb | no | '{}'::jsonb |  |
| `rendered_hash` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_live_lists_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `channel_live_lists_group_id_site_id_key` (unique): UNIQUE (group_id, site_id)
- `channel_live_lists_pkey` (primary key): PRIMARY KEY (id)
- `channel_live_lists_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `channel_live_lists_group_id_site_id_key`: CREATE UNIQUE INDEX channel_live_lists_group_id_site_id_key ON public.channel_live_lists USING btree (group_id, site_id)
- `channel_live_lists_pkey`: CREATE UNIQUE INDEX channel_live_lists_pkey ON public.channel_live_lists USING btree (id)

**Policies**

_No policies._

### `channel_messages_log`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | bigint | no | nextval('channel_messages_log_id_seq'::regclass) |  |
| `business_id` | uuid | yes |  |  |
| `site_id` | uuid | yes |  |  |
| `profile_id` | uuid | yes |  |  |
| `channel` | text | no |  |  |
| `direction` | text | no |  |  |
| `kind` | text | no |  |  |
| `template_name` | text | yes |  |  |
| `billable` | boolean | no | false |  |
| `ref_id` | text | yes |  |  |
| `wa_message_id` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_messages_log_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `channel_messages_log_direction_check` (check): CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text])))
- `channel_messages_log_pkey` (primary key): PRIMARY KEY (id)
- `channel_messages_log_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
- `channel_messages_log_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL

**Indexes**

- `channel_messages_log_pkey`: CREATE UNIQUE INDEX channel_messages_log_pkey ON public.channel_messages_log USING btree (id)
- `idx_channel_messages_log_biz`: CREATE INDEX idx_channel_messages_log_biz ON public.channel_messages_log USING btree (business_id, created_at DESC)
- `idx_channel_messages_log_ref`: CREATE INDEX idx_channel_messages_log_ref ON public.channel_messages_log USING btree (kind, ref_id)
- `uq_channel_inbound_msg`: CREATE UNIQUE INDEX uq_channel_inbound_msg ON public.channel_messages_log USING btree (channel, wa_message_id) WHERE ((direction = 'in'::text) AND (wa_message_id IS NOT NULL))
- `uq_channel_messages_claim`: CREATE UNIQUE INDEX uq_channel_messages_claim ON public.channel_messages_log USING btree (ref_id, kind) WHERE (kind = ANY (ARRAY['corrective_nudge'::text, 'alert_no_action'::text]))

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers read message log` | SELECT | permissive | {public} | is_active_business_manager(business_id) |  |

### `channel_reminders_sent`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `profile_id` | uuid | no |  |  |
| `template_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `period_key` | text | no |  |  |
| `sent_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `channel_reminders_sent_pkey` (primary key): PRIMARY KEY (profile_id, template_id, site_id, period_key)
- `channel_reminders_sent_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
- `channel_reminders_sent_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `channel_reminders_sent_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `channel_reminders_sent_pkey`: CREATE UNIQUE INDEX channel_reminders_sent_pkey ON public.channel_reminders_sent USING btree (profile_id, template_id, site_id, period_key)

**Policies**

_No policies._

### `checklist_completions`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `template_id` | uuid | no |  |  |
| `completed_by` | uuid | no |  |  |
| `completed_at` | timestamp with time zone | no | now() |  |
| `signed_off_by` | uuid | yes |  |  |
| `notes` | text | yes |  |  |
| `business_id` | uuid | no |  |  |
| `signed_off_at` | timestamp with time zone | yes |  |  |
| `site_id` | uuid | yes |  |  |
| `source` | text | no | 'app'::text |  |

**Constraints**

- `checklist_completions_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `checklist_completions_completed_by_fkey` (foreign key): FOREIGN KEY (completed_by) REFERENCES profiles(id)
- `checklist_completions_pkey` (primary key): PRIMARY KEY (id)
- `checklist_completions_signed_off_by_fkey` (foreign key): FOREIGN KEY (signed_off_by) REFERENCES profiles(id)
- `checklist_completions_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `checklist_completions_source_check` (check): CHECK ((source = ANY (ARRAY['app'::text, 'whatsapp'::text, 'telegram'::text])))
- `checklist_completions_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `checklist_completions_pkey`: CREATE UNIQUE INDEX checklist_completions_pkey ON public.checklist_completions USING btree (id)
- `idx_checklist_completions_site`: CREATE INDEX idx_checklist_completions_site ON public.checklist_completions USING btree (site_id)
- `idx_completions_business_date`: CREATE INDEX idx_completions_business_date ON public.checklist_completions USING btree (business_id, completed_at)
- `idx_completions_template`: CREATE INDEX idx_completions_template ON public.checklist_completions USING btree (template_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can create completions` | INSERT | permissive | {public} |  | ((completed_by = auth.uid()) AND (business_id = get_my_business_id()) AND can_see_site_row(site_id)) |
| `Business members can view completions` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `Delete own or managed completions` | DELETE | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id) AND ((completed_by = auth.uid()) OR has_capability('sign_off'::text))) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Users can sign off completions` | UPDATE | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |

**Triggers**

- `trg_link_completion_instance` AFTER INSERT: EXECUTE FUNCTION _link_completion_instance()
- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `checklist_drafts`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `template_id` | uuid | no |  |  |
| `business_id` | uuid | no |  |  |
| `created_by` | uuid | no |  |  |
| `responses` | jsonb | no | '{}'::jsonb |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `checklist_drafts_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `checklist_drafts_created_by_fkey` (foreign key): FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE
- `checklist_drafts_pkey` (primary key): PRIMARY KEY (id)
- `checklist_drafts_template_id_created_by_key` (unique): UNIQUE (template_id, created_by)
- `checklist_drafts_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `checklist_drafts_pkey`: CREATE UNIQUE INDEX checklist_drafts_pkey ON public.checklist_drafts USING btree (id)
- `checklist_drafts_template_id_created_by_key`: CREATE UNIQUE INDEX checklist_drafts_template_id_created_by_key ON public.checklist_drafts USING btree (template_id, created_by)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Own drafts` | ALL | permissive | {public} | (created_by = auth.uid()) | ((created_by = auth.uid()) AND (business_id = get_my_business_id()) AND (template_id IN ( SELECT checklist_templates.id FROM checklist_templates WHERE (checklist_templates.business_id = get_my_business_id())))) |

### `checklist_instances`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `template_id` | uuid | no |  |  |
| `site_id` | uuid | yes |  |  |
| `due_date` | date | no |  |  |
| `period_end` | date | no |  |  |
| `completion_id` | uuid | yes |  |  |
| `status` | text | no | 'pending'::text |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `checklist_instances_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `checklist_instances_completion_id_fkey` (foreign key): FOREIGN KEY (completion_id) REFERENCES checklist_completions(id) ON DELETE SET NULL
- `checklist_instances_pkey` (primary key): PRIMARY KEY (id)
- `checklist_instances_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `checklist_instances_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `checklist_instances_pkey`: CREATE UNIQUE INDEX checklist_instances_pkey ON public.checklist_instances USING btree (id)
- `idx_ci_business_due`: CREATE INDEX idx_ci_business_due ON public.checklist_instances USING btree (business_id, due_date)
- `uq_checklist_instance`: CREATE UNIQUE INDEX uq_checklist_instance ON public.checklist_instances USING btree (template_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), due_date)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `ci_select` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `checklist_responses`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `completion_id` | uuid | no |  |  |
| `item_id` | uuid | no |  |  |
| `value` | text | no |  |  |
| `notes` | text | yes |  |  |
| `flagged` | boolean | no | false |  |
| `corrective_status` | text | yes |  |  |

**Constraints**

- `checklist_responses_completion_id_fkey` (foreign key): FOREIGN KEY (completion_id) REFERENCES checklist_completions(id) ON DELETE CASCADE
- `checklist_responses_corrective_status_check` (check): CHECK (((corrective_status IS NULL) OR (corrective_status = ANY (ARRAY['needed'::text, 'done'::text]))))
- `checklist_responses_item_id_fkey` (foreign key): FOREIGN KEY (item_id) REFERENCES checklist_template_items(id) ON DELETE CASCADE
- `checklist_responses_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `checklist_responses_pkey`: CREATE UNIQUE INDEX checklist_responses_pkey ON public.checklist_responses USING btree (id)
- `idx_responses_completion`: CREATE INDEX idx_responses_completion ON public.checklist_responses USING btree (completion_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can create responses` | INSERT | permissive | {public} |  | (completion_id IN ( SELECT checklist_completions.id FROM checklist_completions WHERE (checklist_completions.completed_by = auth.uid()))) |
| `Business members can view responses` | SELECT | permissive | {public} | (completion_id IN ( SELECT checklist_completions.id FROM checklist_completions WHERE (checklist_completions.business_id = get_my_business_id()))) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (completion_id IN ( SELECT checklist_completions.id FROM checklist_completions WHERE (checklist_completions.business_id = demo_business_id()))) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(( SELECT c.business_id FROM checklist_completions c WHERE (c.id = checklist_responses.completion_id))) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(( SELECT c.business_id FROM checklist_completions c WHERE (c.id = checklist_responses.completion_id))) | is_business_entitled(( SELECT c.business_id FROM checklist_completions c WHERE (c.id = checklist_responses.completion_id))) |

### `checklist_template_items`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `template_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `description` | text | yes |  |  |
| `item_type` | text | no |  |  |
| `required` | boolean | no | true |  |
| `sort_order` | integer | no | 0 |  |
| `sfbb_reference` | text | yes |  |  |
| `min_value` | numeric | yes |  |  |
| `max_value` | numeric | yes |  |  |
| `unit` | text | yes |  |  |

**Constraints**

- `checklist_template_items_item_type_check` (check): CHECK ((item_type = ANY (ARRAY['tick'::text, 'temperature'::text, 'text'::text, 'yes_no'::text, 'photo'::text, 'initials'::text])))
- `checklist_template_items_pkey` (primary key): PRIMARY KEY (id)
- `checklist_template_items_template_id_fkey` (foreign key): FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE CASCADE

**Indexes**

- `checklist_template_items_pkey`: CREATE UNIQUE INDEX checklist_template_items_pkey ON public.checklist_template_items USING btree (id)
- `idx_checklist_items_template`: CREATE INDEX idx_checklist_items_template ON public.checklist_template_items USING btree (template_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view items` | SELECT | permissive | {public} | (template_id IN ( SELECT checklist_templates.id FROM checklist_templates WHERE (checklist_templates.business_id = get_my_business_id()))) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (template_id IN ( SELECT checklist_templates.id FROM checklist_templates WHERE (checklist_templates.business_id = demo_business_id()))) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(( SELECT t.business_id FROM checklist_templates t WHERE (t.id = checklist_template_items.template_id))) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(( SELECT t.business_id FROM checklist_templates t WHERE (t.id = checklist_template_items.template_id))) | is_business_entitled(( SELECT t.business_id FROM checklist_templates t WHERE (t.id = checklist_template_items.template_id))) |
| `Managers can manage items` | ALL | permissive | {public} | ((template_id IN ( SELECT checklist_templates.id FROM checklist_templates WHERE (checklist_templates.business_id = get_my_business_id()))) AND has_capability('manage_checklists'::text)) |  |

### `checklist_templates`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `name` | text | no |  |  |
| `description` | text | yes |  |  |
| `frequency` | text | no |  |  |
| `assigned_roles` | text[] | no | '{}'::text[] |  |
| `business_id` | uuid | no |  |  |
| `sfbb_section` | text | yes |  |  |
| `is_default` | boolean | no | false |  |
| `active` | boolean | no | true |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `supervisor_role` | text | yes |  |  |
| `deadline_time` | text | yes |  |  |
| `multi_per_day` | boolean | no | false |  |
| `min_per_day` | integer | no | 1 |  |
| `site_id` | uuid | yes |  |  |
| `assigned_role_ids` | uuid[] | no | '{}'::uuid[] |  |
| `library_key` | text | yes |  |  |

**Constraints**

- `checklist_templates_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `checklist_templates_frequency_check` (check): CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'four_weekly'::text, 'custom'::text])))
- `checklist_templates_min_per_day_check` (check): CHECK ((min_per_day >= 0))
- `checklist_templates_pkey` (primary key): PRIMARY KEY (id)
- `checklist_templates_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `checklist_templates_pkey`: CREATE UNIQUE INDEX checklist_templates_pkey ON public.checklist_templates USING btree (id)
- `idx_checklist_templates_business`: CREATE INDEX idx_checklist_templates_business ON public.checklist_templates USING btree (business_id)
- `idx_checklist_templates_role_ids`: CREATE INDEX idx_checklist_templates_role_ids ON public.checklist_templates USING gin (assigned_role_ids)
- `idx_checklist_templates_site`: CREATE INDEX idx_checklist_templates_site ON public.checklist_templates USING btree (site_id)
- `uq_checklist_templates_library_key`: CREATE UNIQUE INDEX uq_checklist_templates_library_key ON public.checklist_templates USING btree (business_id, site_id, library_key) WHERE (library_key IS NOT NULL)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view templates` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Managers can manage templates` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_checklists'::text) AND can_see_site_row(site_id)) | ((business_id = get_my_business_id()) AND has_capability('manage_checklists'::text) AND can_see_site_row(site_id)) |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()
- `update_checklist_templates_updated_at` BEFORE UPDATE: EXECUTE FUNCTION update_updated_at()

### `deliveries`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `supplier_id` | uuid | yes |  |  |
| `received_by` | uuid | yes |  |  |
| `received_at` | timestamp with time zone | yes | now() |  |
| `product_temperature` | numeric | yes |  |  |
| `notes` | text | yes |  |  |
| `business_id` | uuid | no |  |  |
| `created_at` | timestamp with time zone | yes | now() |  |
| `site_id` | uuid | yes |  |  |

**Constraints**

- `deliveries_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `deliveries_pkey` (primary key): PRIMARY KEY (id)
- `deliveries_received_by_fkey` (foreign key): FOREIGN KEY (received_by) REFERENCES profiles(id) ON DELETE SET NULL
- `deliveries_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `deliveries_supplier_id_fkey` (foreign key): FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL

**Indexes**

- `deliveries_pkey`: CREATE UNIQUE INDEX deliveries_pkey ON public.deliveries USING btree (id)
- `idx_deliveries_business`: CREATE INDEX idx_deliveries_business ON public.deliveries USING btree (business_id)
- `idx_deliveries_received_at`: CREATE INDEX idx_deliveries_received_at ON public.deliveries USING btree (received_at)
- `idx_deliveries_site`: CREATE INDEX idx_deliveries_site ON public.deliveries USING btree (site_id)
- `idx_deliveries_supplier`: CREATE INDEX idx_deliveries_supplier ON public.deliveries USING btree (supplier_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Users can delete deliveries in their business` | DELETE | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `Users can insert deliveries in their business` | INSERT | permissive | {public} |  | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |
| `Users can update deliveries in their business` | UPDATE | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `Users can view deliveries in their business` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `delivery_photos`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `delivery_id` | uuid | no |  |  |
| `photo_url` | text | no |  |  |
| `file_name` | text | yes |  |  |
| `created_at` | timestamp with time zone | yes | now() |  |

**Constraints**

- `delivery_photos_delivery_id_fkey` (foreign key): FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
- `delivery_photos_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `delivery_photos_pkey`: CREATE UNIQUE INDEX delivery_photos_pkey ON public.delivery_photos USING btree (id)
- `idx_delivery_photos_delivery`: CREATE INDEX idx_delivery_photos_delivery ON public.delivery_photos USING btree (delivery_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (delivery_id IN ( SELECT deliveries.id FROM deliveries WHERE (deliveries.business_id = demo_business_id()))) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(( SELECT d.business_id FROM deliveries d WHERE (d.id = delivery_photos.delivery_id))) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(( SELECT d.business_id FROM deliveries d WHERE (d.id = delivery_photos.delivery_id))) | is_business_entitled(( SELECT d.business_id FROM deliveries d WHERE (d.id = delivery_photos.delivery_id))) |
| `Users can delete delivery photos` | DELETE | permissive | {public} | (delivery_id IN ( SELECT deliveries.id FROM deliveries WHERE (deliveries.business_id IN ( SELECT profiles.business_id FROM profiles WHERE (profiles.id = auth.uid()))))) |  |
| `Users can insert delivery photos` | INSERT | permissive | {public} |  | (delivery_id IN ( SELECT deliveries.id FROM deliveries WHERE (deliveries.business_id IN ( SELECT profiles.business_id FROM profiles WHERE (profiles.id = auth.uid()))))) |
| `Users can view delivery photos` | SELECT | permissive | {public} | (delivery_id IN ( SELECT deliveries.id FROM deliveries WHERE (deliveries.business_id IN ( SELECT profiles.business_id FROM profiles WHERE (profiles.id = auth.uid()))))) |  |

### `demo_force_exit`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `user_id` | uuid | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `demo_force_exit_pkey` (primary key): PRIMARY KEY (user_id)

**Indexes**

- `demo_force_exit_pkey`: CREATE UNIQUE INDEX demo_force_exit_pkey ON public.demo_force_exit USING btree (user_id)

**Policies**

_No policies._

### `diary_entries`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `date` | date | no |  |  |
| `business_id` | uuid | no |  |  |
| `signed_by` | uuid | yes |  |  |
| `notes` | text | yes |  |  |
| `opening_done` | boolean | no | false |  |
| `closing_done` | boolean | no | false |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `site_id` | uuid | yes |  |  |

**Constraints**

- `diary_entries_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `diary_entries_date_business_id_key` (unique): UNIQUE (date, business_id)
- `diary_entries_pkey` (primary key): PRIMARY KEY (id)
- `diary_entries_signed_by_fkey` (foreign key): FOREIGN KEY (signed_by) REFERENCES profiles(id)
- `diary_entries_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `diary_entries_date_business_id_key`: CREATE UNIQUE INDEX diary_entries_date_business_id_key ON public.diary_entries USING btree (date, business_id)
- `diary_entries_pkey`: CREATE UNIQUE INDEX diary_entries_pkey ON public.diary_entries USING btree (id)
- `idx_diary_business_date`: CREATE INDEX idx_diary_business_date ON public.diary_entries USING btree (business_id, date)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can manage diary` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |
| `Business members can view diary` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `dinesafe_cache`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `establishment_id` | bigint | no |  |  |
| `name` | text | no |  |  |
| `establishment_type` | text | yes |  |  |
| `address` | text | yes |  |  |
| `status` | text | yes |  |  |
| `last_inspection` | date | yes |  |  |
| `inspections_count` | integer | no | 0 |  |
| `violations_count` | integer | no | 0 |  |
| `latitude` | double precision | yes |  |  |
| `longitude` | double precision | yes |  |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `dinesafe_cache_pkey` (primary key): PRIMARY KEY (establishment_id)

**Indexes**

- `dinesafe_cache_name_trgm`: CREATE INDEX dinesafe_cache_name_trgm ON public.dinesafe_cache USING gin (name gin_trgm_ops)
- `dinesafe_cache_pkey`: CREATE UNIQUE INDEX dinesafe_cache_pkey ON public.dinesafe_cache USING btree (establishment_id)

**Policies**

_No policies._

### `dinesafe_refresh_meta`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | integer | no | 1 |  |
| `last_refreshed_at` | timestamp with time zone | yes |  |  |
| `row_count` | integer | yes |  |  |
| `status` | text | yes |  |  |
| `error` | text | yes |  |  |

**Constraints**

- `dinesafe_refresh_meta_pkey` (primary key): PRIMARY KEY (id)
- `dinesafe_refresh_meta_singleton` (check): CHECK ((id = 1))

**Indexes**

- `dinesafe_refresh_meta_pkey`: CREATE UNIQUE INDEX dinesafe_refresh_meta_pkey ON public.dinesafe_refresh_meta USING btree (id)

**Policies**

_No policies._

### `document_access`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `document_id` | uuid | no |  |  |
| `profile_id` | uuid | no |  |  |
| `granted_by` | uuid | no |  |  |
| `created_at` | timestamp with time zone | yes | now() |  |

**Constraints**

- `document_access_document_id_fkey` (foreign key): FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
- `document_access_document_id_profile_id_key` (unique): UNIQUE (document_id, profile_id)
- `document_access_granted_by_fkey` (foreign key): FOREIGN KEY (granted_by) REFERENCES profiles(id)
- `document_access_pkey` (primary key): PRIMARY KEY (id)
- `document_access_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE

**Indexes**

- `document_access_document_id_profile_id_key`: CREATE UNIQUE INDEX document_access_document_id_profile_id_key ON public.document_access USING btree (document_id, profile_id)
- `document_access_pkey`: CREATE UNIQUE INDEX document_access_pkey ON public.document_access USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (profile_id IN ( SELECT profiles.id FROM profiles WHERE (profiles.business_id = demo_business_id()))) |  |
| `document_access_delete` | DELETE | permissive | {public} | has_capability('view_documents'::text) |  |
| `document_access_insert` | INSERT | permissive | {public} |  | has_capability('manage_documents'::text) |
| `document_access_select` | SELECT | permissive | {public} | true |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(( SELECT d.business_id FROM documents d WHERE (d.id = document_access.document_id))) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(( SELECT d.business_id FROM documents d WHERE (d.id = document_access.document_id))) | is_business_entitled(( SELECT d.business_id FROM documents d WHERE (d.id = document_access.document_id))) |

### `documents`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `title` | text | no |  |  |
| `description` | text | yes |  |  |
| `category` | text | no | 'other'::text |  |
| `file_url` | text | no |  |  |
| `file_name` | text | no |  |  |
| `file_size` | bigint | yes |  |  |
| `file_type` | text | yes |  |  |
| `uploaded_by` | uuid | no |  |  |
| `business_id` | uuid | no |  |  |
| `access_level` | text | no | 'all'::text |  |
| `expires_at` | date | yes |  |  |
| `created_at` | timestamp with time zone | yes | now() |  |
| `updated_at` | timestamp with time zone | yes | now() |  |
| `site_id` | uuid | yes |  |  |

**Constraints**

- `documents_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `documents_pkey` (primary key): PRIMARY KEY (id)
- `documents_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `documents_uploaded_by_fkey` (foreign key): FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE CASCADE

**Indexes**

- `documents_pkey`: CREATE UNIQUE INDEX documents_pkey ON public.documents USING btree (id)
- `idx_documents_business`: CREATE INDEX idx_documents_business ON public.documents USING btree (business_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `documents_delete` | DELETE | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('view_documents'::text)) |  |
| `documents_insert` | INSERT | permissive | {public} |  | ((business_id = get_my_business_id()) AND has_capability('manage_documents'::text)) |
| `documents_select` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND (has_capability('view_documents'::text) OR (access_level = 'all'::text) OR ((access_level = 'managers_only'::text) AND has_capability('manage_documents'::text)) OR ((access_level = 'owner_only'::text) AND has_capability('view_documents'::text)) OR ((access_level = 'custom'::text) AND (has_capability('view_documents'::text) OR (auth.uid() IN ( SELECT da.profile_id FROM document_access da WHERE (da.document_id = documents.id))))))) |  |
| `documents_update` | UPDATE | permissive | {public} | ((business_id = get_my_business_id()) AND (has_capability('view_documents'::text) OR (uploaded_by = auth.uid()))) |  |
| `documents_update_owner_manager` | UPDATE | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_documents'::text)) | (business_id = get_my_business_id()) |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |

### `feedback_requests`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `site_id` | uuid | yes |  |  |
| `created_by` | uuid | no |  |  |
| `kind` | text | no |  |  |
| `message` | text | no |  |  |
| `rating` | smallint | yes |  |  |
| `status` | text | no | 'new'::text |  |
| `response` | text | yes |  |  |
| `responded_at` | timestamp with time zone | yes |  |  |
| `page_url` | text | yes |  |  |
| `page_path` | text | yes |  |  |
| `metadata` | jsonb | no | '{}'::jsonb |  |
| `email_status` | text | no | 'pending'::text |  |
| `email_provider_id` | text | yes |  |  |
| `email_error` | text | yes |  |  |
| `emailed_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `feedback_requests_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `feedback_requests_created_by_fkey` (foreign key): FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE
- `feedback_requests_email_status_check` (check): CHECK ((email_status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
- `feedback_requests_kind_check` (check): CHECK ((kind = ANY (ARRAY['question'::text, 'feature'::text, 'bug'::text, 'feedback'::text])))
- `feedback_requests_message_check` (check): CHECK (((char_length(btrim(message)) >= 5) AND (char_length(btrim(message)) <= 4000)))
- `feedback_requests_pkey` (primary key): PRIMARY KEY (id)
- `feedback_requests_rating_check` (check): CHECK (((rating >= 1) AND (rating <= 5)))
- `feedback_requests_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
- `feedback_requests_status_check` (check): CHECK ((status = ANY (ARRAY['new'::text, 'open'::text, 'planned'::text, 'resolved'::text, 'closed'::text])))

**Indexes**

- `feedback_requests_pkey`: CREATE UNIQUE INDEX feedback_requests_pkey ON public.feedback_requests USING btree (id)
- `idx_feedback_requests_business_created`: CREATE INDEX idx_feedback_requests_business_created ON public.feedback_requests USING btree (business_id, created_at DESC)
- `idx_feedback_requests_creator_created`: CREATE INDEX idx_feedback_requests_creator_created ON public.feedback_requests USING btree (created_by, created_at DESC)
- `idx_feedback_requests_status_created`: CREATE INDEX idx_feedback_requests_status_created ON public.feedback_requests USING btree (status, created_at DESC)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `feedback_requests_insert_own` | INSERT | permissive | {authenticated} |  | ((created_by = auth.uid()) AND (business_id = get_my_business_id()) AND (status = 'new'::text) AND (response IS NULL) AND (responded_at IS NULL) AND ((site_id IS NULL) OR (EXISTS ( SELECT 1 FROM sites WHERE ((sites.id = feedback_requests.site_id) AND (sites.business_id = get_my_business_id())))))) |
| `feedback_requests_select_own` | SELECT | permissive | {authenticated} | ((created_by = auth.uid()) AND (business_id = get_my_business_id())) |  |

### `four_weekly_reviews`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `period_start` | date | no |  |  |
| `period_end` | date | no |  |  |
| `summary` | text | yes |  |  |
| `action_items` | jsonb | no | '[]'::jsonb |  |
| `reviewed_by` | uuid | yes |  |  |
| `reviewed_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `four_weekly_reviews_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `four_weekly_reviews_pkey` (primary key): PRIMARY KEY (id)
- `four_weekly_reviews_reviewed_by_fkey` (foreign key): FOREIGN KEY (reviewed_by) REFERENCES profiles(id)

**Indexes**

- `four_weekly_reviews_pkey`: CREATE UNIQUE INDEX four_weekly_reviews_pkey ON public.four_weekly_reviews USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view reviews` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Managers can manage reviews` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_checklists'::text)) |  |

### `google_connections`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `google_email` | text | no | ''::text |  |
| `vault_secret_id` | uuid | yes |  |  |
| `scopes` | text[] | no | '{}'::text[] |  |
| `status` | text | no | 'active'::text |  |
| `last_error` | text | yes |  |  |
| `connected_by` | uuid | yes |  |  |
| `connected_at` | timestamp with time zone | no | now() |  |
| `last_sync_at` | timestamp with time zone | yes |  |  |
| `revoked_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `google_connections_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `google_connections_connected_by_fkey` (foreign key): FOREIGN KEY (connected_by) REFERENCES profiles(id) ON DELETE SET NULL
- `google_connections_pkey` (primary key): PRIMARY KEY (id)
- `google_connections_status_check` (check): CHECK ((status = ANY (ARRAY['active'::text, 'error'::text, 'revoked'::text])))

**Indexes**

- `google_connections_pkey`: CREATE UNIQUE INDEX google_connections_pkey ON public.google_connections USING btree (id)
- `uq_google_connection_live`: CREATE UNIQUE INDEX uq_google_connection_live ON public.google_connections USING btree (business_id) WHERE (status <> 'revoked'::text)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `review managers read connections` | SELECT | permissive | {public} | can_manage_reviews(business_id) |  |

### `google_locations`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `connection_id` | uuid | no |  |  |
| `business_id` | uuid | no |  |  |
| `gbp_account` | text | no |  |  |
| `gbp_location` | text | no |  |  |
| `title` | text | no | ''::text |  |
| `address` | text | no | ''::text |  |
| `postcode` | text | no | ''::text |  |
| `maps_uri` | text | yes |  |  |
| `can_reply` | boolean | no | false |  |
| `site_id` | uuid | yes |  |  |
| `enabled` | boolean | no | false |  |
| `enabled_at` | timestamp with time zone | yes |  |  |
| `last_review_update_time` | timestamp with time zone | yes |  |  |
| `last_full_pass_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `google_locations_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `google_locations_connection_id_fkey` (foreign key): FOREIGN KEY (connection_id) REFERENCES google_connections(id) ON DELETE CASCADE
- `google_locations_connection_id_gbp_location_key` (unique): UNIQUE (connection_id, gbp_location)
- `google_locations_pkey` (primary key): PRIMARY KEY (id)
- `google_locations_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL

**Indexes**

- `google_locations_connection_id_gbp_location_key`: CREATE UNIQUE INDEX google_locations_connection_id_gbp_location_key ON public.google_locations USING btree (connection_id, gbp_location)
- `google_locations_pkey`: CREATE UNIQUE INDEX google_locations_pkey ON public.google_locations USING btree (id)
- `idx_google_locations_business`: CREATE INDEX idx_google_locations_business ON public.google_locations USING btree (business_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `entitlement_write_gate_upd` | UPDATE | restrictive | {public} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `review managers read locations` | SELECT | permissive | {public} | can_manage_reviews(business_id) |  |
| `review managers update locations` | UPDATE | permissive | {public} | can_manage_reviews(business_id) | can_manage_reviews(business_id) |

**Triggers**

- `trg_guard_google_locations_update` BEFORE UPDATE: EXECUTE FUNCTION guard_google_locations_update()

### `google_oauth_states`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `state` | text | no |  |  |
| `business_id` | uuid | no |  |  |
| `profile_id` | uuid | no |  |  |
| `code_verifier` | text | no |  |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `used_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `google_oauth_states_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `google_oauth_states_pkey` (primary key): PRIMARY KEY (state)
- `google_oauth_states_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE

**Indexes**

- `google_oauth_states_pkey`: CREATE UNIQUE INDEX google_oauth_states_pkey ON public.google_oauth_states USING btree (state)

**Policies**

_No policies._

### `haccp_pack_data`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `data` | jsonb | no | '{}'::jsonb |  |
| `updated_at` | timestamp with time zone | yes | now() |  |
| `site_id` | uuid | yes |  |  |

**Constraints**

- `haccp_pack_data_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `haccp_pack_data_pkey` (primary key): PRIMARY KEY (id)
- `haccp_pack_data_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `uq_haccp_pack_business_site` (unique): UNIQUE (business_id, site_id)

**Indexes**

- `haccp_pack_data_pkey`: CREATE UNIQUE INDEX haccp_pack_data_pkey ON public.haccp_pack_data USING btree (id)
- `uq_haccp_pack_business_site`: CREATE UNIQUE INDEX uq_haccp_pack_business_site ON public.haccp_pack_data USING btree (business_id, site_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Users can delete own business haccp data` | DELETE | permissive | {public} | (business_id IN ( SELECT profiles.business_id FROM profiles WHERE (profiles.id = auth.uid()))) |  |
| `Users can insert own business haccp data` | INSERT | permissive | {public} |  | (business_id IN ( SELECT profiles.business_id FROM profiles WHERE (profiles.id = auth.uid()))) |
| `Users can read own business haccp data` | SELECT | permissive | {public} | (business_id IN ( SELECT profiles.business_id FROM profiles WHERE (profiles.id = auth.uid()))) |  |
| `Users can update own business haccp data` | UPDATE | permissive | {public} | (business_id IN ( SELECT profiles.business_id FROM profiles WHERE (profiles.id = auth.uid()))) |  |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `haccp_plan_shares`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `site_id` | uuid | yes |  |  |
| `kind` | text | no |  |  |
| `token_hash` | text | no |  |  |
| `label` | text | yes |  |  |
| `created_by` | uuid | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `revoked_at` | timestamp with time zone | yes |  |  |
| `view_count` | integer | no | 0 |  |
| `last_viewed_at` | timestamp with time zone | yes |  |  |

**Constraints**

- `haccp_plan_shares_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `haccp_plan_shares_created_by_fkey` (foreign key): FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE
- `haccp_plan_shares_kind_check` (check): CHECK ((kind = ANY (ARRAY['inspector'::text, 'pdf'::text])))
- `haccp_plan_shares_label_check` (check): CHECK (((label IS NULL) OR (length(label) <= 80)))
- `haccp_plan_shares_pkey` (primary key): PRIMARY KEY (id)
- `haccp_plan_shares_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `haccp_plan_shares_token_hash_check` (check): CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
- `haccp_plan_shares_token_hash_key` (unique): UNIQUE (token_hash)

**Indexes**

- `haccp_plan_shares_pkey`: CREATE UNIQUE INDEX haccp_plan_shares_pkey ON public.haccp_plan_shares USING btree (id)
- `haccp_plan_shares_token_hash_key`: CREATE UNIQUE INDEX haccp_plan_shares_token_hash_key ON public.haccp_plan_shares USING btree (token_hash)
- `idx_haccp_plan_shares_business`: CREATE INDEX idx_haccp_plan_shares_business ON public.haccp_plan_shares USING btree (business_id, site_id, created_at DESC)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `haccp_plan_shares_insert` | INSERT | permissive | {public} |  | ((business_id = get_my_business_id()) AND (created_by = auth.uid()) AND (((site_id IS NOT NULL) AND can_see_site_row(site_id)) OR ((site_id IS NULL) AND (am_i_group_admin() OR (NOT (EXISTS ( SELECT 1 FROM member_sites ms WHERE (ms.profile_id = auth.uid()))))))) AND (revoked_at IS NULL) AND (view_count = 0) AND (((kind = 'pdf'::text) AND (expires_at <= (now() + '00:15:00'::interval))) OR ((kind = 'inspector'::text) AND is_active_business_manager(business_id) AND (expires_at <= (now() + '30 days'::interval))))) |
| `haccp_plan_shares_revoke` | UPDATE | permissive | {public} | ((business_id = get_my_business_id()) AND is_active_business_manager(business_id)) | (business_id = get_my_business_id()) |
| `haccp_plan_shares_select` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND ((site_id IS NULL) OR can_see_site_row(site_id))) |  |

**Triggers**

- `trg_haccp_plan_shares_guard` BEFORE UPDATE: EXECUTE FUNCTION haccp_plan_shares_guard()

### `haccp_setup_sessions`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `questionnaire_version` | integer | no |  |  |
| `answers` | jsonb | no | '{}'::jsonb |  |
| `status` | text | no | 'in_progress'::text |  |
| `applied_summary` | jsonb | yes |  |  |
| `created_by` | uuid | yes | auth.uid() |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `applied_at` | timestamp with time zone | yes |  |  |

**Constraints**

- `haccp_setup_sessions_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `haccp_setup_sessions_created_by_fkey` (foreign key): FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `haccp_setup_sessions_pkey` (primary key): PRIMARY KEY (id)
- `haccp_setup_sessions_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `haccp_setup_sessions_status_check` (check): CHECK ((status = ANY (ARRAY['in_progress'::text, 'applied'::text, 'abandoned'::text])))

**Indexes**

- `haccp_setup_sessions_pkey`: CREATE UNIQUE INDEX haccp_setup_sessions_pkey ON public.haccp_setup_sessions USING btree (id)
- `idx_haccp_setup_sessions_site`: CREATE INDEX idx_haccp_setup_sessions_site ON public.haccp_setup_sessions USING btree (business_id, site_id, created_at DESC)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `managers create setup sessions` | INSERT | permissive | {public} |  | (is_business_manager(business_id) AND (status = 'in_progress'::text) AND (EXISTS ( SELECT 1 FROM sites st WHERE ((st.id = haccp_setup_sessions.site_id) AND (st.business_id = haccp_setup_sessions.business_id))))) |
| `managers read setup sessions` | SELECT | permissive | {public} | is_business_manager(business_id) |  |
| `managers update setup sessions` | UPDATE | permissive | {public} | (is_business_manager(business_id) AND (status = 'in_progress'::text)) | (is_business_manager(business_id) AND (EXISTS ( SELECT 1 FROM sites st WHERE ((st.id = haccp_setup_sessions.site_id) AND (st.business_id = haccp_setup_sessions.business_id)))) AND ((status = ANY (ARRAY['in_progress'::text, 'abandoned'::text])) OR ((status = 'applied'::text) AND (applied_at IS NOT NULL)))) |

### `haccp_signoffs`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `signed_by` | uuid | yes |  |  |
| `signed_by_name` | text | yes |  |  |
| `signed_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `haccp_signoffs_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `haccp_signoffs_business_id_site_id_key` (unique): UNIQUE (business_id, site_id)
- `haccp_signoffs_pkey` (primary key): PRIMARY KEY (id)
- `haccp_signoffs_signed_by_fkey` (foreign key): FOREIGN KEY (signed_by) REFERENCES profiles(id) ON DELETE SET NULL
- `haccp_signoffs_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `haccp_signoffs_business_id_site_id_key`: CREATE UNIQUE INDEX haccp_signoffs_business_id_site_id_key ON public.haccp_signoffs USING btree (business_id, site_id)
- `haccp_signoffs_pkey`: CREATE UNIQUE INDEX haccp_signoffs_pkey ON public.haccp_signoffs USING btree (id)
- `idx_haccp_signoffs_business`: CREATE INDEX idx_haccp_signoffs_business ON public.haccp_signoffs USING btree (business_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `haccp_signoffs_manager_delete` | DELETE | restrictive | {public} | is_active_business_manager(business_id) |  |
| `haccp_signoffs_manager_insert` | INSERT | restrictive | {public} |  | is_active_business_manager(business_id) |
| `haccp_signoffs_manager_update` | UPDATE | restrictive | {public} | is_active_business_manager(business_id) | is_active_business_manager(business_id) |
| `haccp_signoffs_select` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `haccp_signoffs_write` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `incidents`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `type` | text | no |  |  |
| `description` | text | no |  |  |
| `action_taken` | text | yes |  |  |
| `follow_up` | text | yes |  |  |
| `reported_by` | uuid | no |  |  |
| `date` | date | no | CURRENT_DATE |  |
| `business_id` | uuid | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `status` | text | no | 'open'::text |  |
| `resolved_by` | uuid | yes |  |  |
| `resolved_at` | timestamp with time zone | yes |  |  |
| `resolved_notes` | text | yes |  |  |
| `updated_at` | timestamp with time zone | yes | now() |  |
| `site_id` | uuid | yes |  |  |
| `severity` | text | no | 'medium'::text |  |
| `category` | text | no | 'Other'::text |  |

**Constraints**

- `incidents_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `incidents_category_chk` (check): CHECK ((category = ANY (ARRAY['Injury'::text, 'Equipment'::text, 'Illness'::text, 'Complaint'::text, 'Other'::text])))
- `incidents_pkey` (primary key): PRIMARY KEY (id)
- `incidents_reported_by_fkey` (foreign key): FOREIGN KEY (reported_by) REFERENCES profiles(id)
- `incidents_resolved_by_fkey` (foreign key): FOREIGN KEY (resolved_by) REFERENCES profiles(id)
- `incidents_severity_chk` (check): CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
- `incidents_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `incidents_type_check` (check): CHECK ((type = ANY (ARRAY['complaint'::text, 'incident'::text])))

**Indexes**

- `idx_incidents_business`: CREATE INDEX idx_incidents_business ON public.incidents USING btree (business_id, date)
- `idx_incidents_site`: CREATE INDEX idx_incidents_site ON public.incidents USING btree (site_id)
- `incidents_pkey`: CREATE UNIQUE INDEX incidents_pkey ON public.incidents USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can create incidents` | INSERT | permissive | {public} |  | ((reported_by = auth.uid()) AND (business_id = get_my_business_id()) AND can_see_site_row(site_id)) |
| `Business members can view incidents` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `incidents_update` | UPDATE | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `ingredients`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `name` | text | no |  |  |
| `allergens` | text[] | no | '{}'::text[] |  |
| `business_id` | uuid | yes |  |  |

**Constraints**

- `ingredients_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `ingredients_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `idx_ingredients_business`: CREATE INDEX idx_ingredients_business ON public.ingredients USING btree (business_id)
- `idx_ingredients_name`: CREATE INDEX idx_ingredients_name ON public.ingredients USING btree (name)
- `ingredients_business_lower_name_uniq`: CREATE UNIQUE INDEX ingredients_business_lower_name_uniq ON public.ingredients USING btree (business_id, lower(name))
- `ingredients_pkey`: CREATE UNIQUE INDEX ingredients_pkey ON public.ingredients USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view ingredients` | SELECT | permissive | {public} | ((business_id IS NULL) OR (business_id = get_my_business_id())) |  |
| `Chefs can manage ingredients` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |

### `invites`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `email` | text | no |  |  |
| `role` | text | no |  |  |
| `business_id` | uuid | no |  |  |
| `invited_by` | uuid | no |  |  |
| `token` | text | no | encode(gen_random_bytes(32), 'hex'::text) |  |
| `expires_at` | timestamp with time zone | no | (now() + '7 days'::interval) |  |
| `used_at` | timestamp with time zone | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `site_id` | uuid | yes |  |  |
| `role_id` | uuid | yes |  |  |

**Constraints**

- `invites_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `invites_invited_by_fkey` (foreign key): FOREIGN KEY (invited_by) REFERENCES profiles(id)
- `invites_pkey` (primary key): PRIMARY KEY (id)
- `invites_role_check` (check): CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'chef'::text, 'kitchen_staff'::text, 'front_of_house'::text])))
- `invites_role_id_fkey` (foreign key): FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
- `invites_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
- `invites_token_key` (unique): UNIQUE (token)

**Indexes**

- `idx_invites_email`: CREATE INDEX idx_invites_email ON public.invites USING btree (email)
- `idx_invites_token`: CREATE INDEX idx_invites_token ON public.invites USING btree (token)
- `invites_pkey`: CREATE UNIQUE INDEX invites_pkey ON public.invites USING btree (id)
- `invites_token_key`: CREATE UNIQUE INDEX invites_token_key ON public.invites USING btree (token)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Managers can manage invites` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_team'::text)) |  |

### `member_capability_overrides`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `profile_id` | uuid | no |  |  |
| `capability` | text | no |  |  |
| `granted` | boolean | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `member_capability_overrides_pkey` (primary key): PRIMARY KEY (profile_id, capability)
- `member_capability_overrides_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE

**Indexes**

- `idx_mco_profile`: CREATE INDEX idx_mco_profile ON public.member_capability_overrides USING btree (profile_id)
- `member_capability_overrides_pkey`: CREATE UNIQUE INDEX member_capability_overrides_pkey ON public.member_capability_overrides USING btree (profile_id, capability)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (profile_id IN ( SELECT profiles.id FROM profiles WHERE (profiles.business_id = demo_business_id()))) |  |
| `member_capability_overrides_rw` | ALL | permissive | {authenticated} | ((profile_id IN ( SELECT profiles.id FROM profiles WHERE (profiles.business_id = get_my_business_id()))) AND has_capability('manage_roles'::text)) | ((profile_id IN ( SELECT profiles.id FROM profiles WHERE (profiles.business_id = get_my_business_id()))) AND has_capability('manage_roles'::text)) |

### `member_sites`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `profile_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `member_sites_pkey` (primary key): PRIMARY KEY (profile_id, site_id)
- `member_sites_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
- `member_sites_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `idx_member_sites_profile`: CREATE INDEX idx_member_sites_profile ON public.member_sites USING btree (profile_id)
- `idx_member_sites_site`: CREATE INDEX idx_member_sites_site ON public.member_sites USING btree (site_id)
- `member_sites_pkey`: CREATE UNIQUE INDEX member_sites_pkey ON public.member_sites USING btree (profile_id, site_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (site_id IN ( SELECT sites.id FROM sites WHERE (sites.business_id = demo_business_id()))) |  |
| `member_sites_select` | SELECT | permissive | {authenticated} | (EXISTS ( SELECT 1 FROM sites s WHERE ((s.id = member_sites.site_id) AND (s.business_id = get_my_business_id())))) |  |
| `member_sites_write` | ALL | permissive | {public} | ((EXISTS ( SELECT 1 FROM sites s WHERE ((s.id = member_sites.site_id) AND (s.business_id = get_my_business_id())))) AND (COALESCE(( SELECT profiles.is_group_admin FROM profiles WHERE (profiles.id = auth.uid())), false) OR (EXISTS ( SELECT 1 FROM (profiles p JOIN roles r ON ((r.id = p.role_id))) WHERE ((p.id = auth.uid()) AND (r.base_tier = 'owner'::text)))))) | ((EXISTS ( SELECT 1 FROM sites s WHERE ((s.id = member_sites.site_id) AND (s.business_id = get_my_business_id())))) AND (COALESCE(( SELECT profiles.is_group_admin FROM profiles WHERE (profiles.id = auth.uid())), false) OR (EXISTS ( SELECT 1 FROM (profiles p JOIN roles r ON ((r.id = p.role_id))) WHERE ((p.id = auth.uid()) AND (r.base_tier = 'owner'::text)))))) |

**Triggers**

- `trg_keep_primary_site` AFTER DELETE/INSERT: EXECUTE FUNCTION keep_primary_site()

### `menu_categories`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `sort_order` | integer | no | 0 |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `menu_categories_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `menu_categories_pkey` (primary key): PRIMARY KEY (id)
- `menu_categories_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `idx_menu_categories_site`: CREATE INDEX idx_menu_categories_site ON public.menu_categories USING btree (business_id, site_id, sort_order)
- `menu_categories_pkey`: CREATE UNIQUE INDEX menu_categories_pkey ON public.menu_categories USING btree (id)
- `ux_menu_categories_site_lower_name`: CREATE UNIQUE INDEX ux_menu_categories_site_lower_name ON public.menu_categories USING btree (site_id, lower(name))

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `Managers manage menu categories` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) |
| `Members read menu categories` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |

### `menu_items`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `recipe_id` | uuid | yes |  |  |
| `category` | text | no |  |  |
| `active` | boolean | no | true |  |
| `display_order` | integer | no | 0 |  |
| `business_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `allergen_source` | text | no | 'recipe'::text |  |
| `declared_allergens` | text[] | no | '{}'::text[] |  |
| `may_contain` | text[] | no | '{}'::text[] |  |
| `dietary` | text[] | no | '{}'::text[] |  |
| `attested_by` | uuid | yes |  |  |
| `attested_by_name` | text | yes |  |  |
| `attested_at` | timestamp with time zone | yes |  |  |
| `price` | numeric | yes |  |  |
| `site_ids` | uuid[] | no | '{}'::uuid[] |  |
| `site_categories` | jsonb | no | '{}'::jsonb |  |

**Constraints**

- `menu_items_allergen_source_check` (check): CHECK ((allergen_source = ANY (ARRAY['recipe'::text, 'manual'::text])))
- `menu_items_attestation_check` (check): CHECK (((allergen_source <> 'manual'::text) OR ((attested_by_name IS NOT NULL) AND (attested_at IS NOT NULL))))
- `menu_items_attested_by_fkey` (foreign key): FOREIGN KEY (attested_by) REFERENCES profiles(id) ON DELETE SET NULL
- `menu_items_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `menu_items_pkey` (primary key): PRIMARY KEY (id)
- `menu_items_recipe_id_fkey` (foreign key): FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE RESTRICT
- `menu_items_recipe_source_check` (check): CHECK (((allergen_source <> 'recipe'::text) OR (recipe_id IS NOT NULL)))

**Indexes**

- `idx_menu_items_business`: CREATE INDEX idx_menu_items_business ON public.menu_items USING btree (business_id)
- `idx_menu_items_business_source`: CREATE INDEX idx_menu_items_business_source ON public.menu_items USING btree (business_id, allergen_source)
- `idx_menu_items_recipe`: CREATE INDEX idx_menu_items_recipe ON public.menu_items USING btree (recipe_id)
- `menu_items_pkey`: CREATE UNIQUE INDEX menu_items_pkey ON public.menu_items USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view menu` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Managers can manage menu` | ALL | permissive | {authenticated} | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) |

### `notification_rules`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `trigger_type` | text | no |  |  |
| `trigger_config` | jsonb | no | '{}'::jsonb |  |
| `recipient_roles` | text[] | no | '{}'::text[] |  |
| `channels` | text[] | no | '{in_app}'::text[] |  |
| `active` | boolean | no | true |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `notification_rules_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `notification_rules_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `notification_rules_pkey`: CREATE UNIQUE INDEX notification_rules_pkey ON public.notification_rules USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view rules` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Managers can manage rules` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_checklists'::text)) |  |

### `notifications`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `user_id` | uuid | no |  |  |
| `type` | text | no |  |  |
| `title` | text | no |  |  |
| `message` | text | no |  |  |
| `read` | boolean | no | false |  |
| `link` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `notifications_pkey` (primary key): PRIMARY KEY (id)
- `notifications_user_id_fkey` (foreign key): FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE

**Indexes**

- `idx_notifications_user`: CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, read)
- `notifications_pkey`: CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Authenticated users can insert notifications` | INSERT | permissive | {authenticated} |  | true |
| `Users can update own notifications` | UPDATE | permissive | {public} | (user_id = auth.uid()) |  |
| `Users can view own notifications` | SELECT | permissive | {public} | (user_id = auth.uid()) |  |

**Triggers**

- `trg_resolve_checklist_notif_link` BEFORE INSERT: EXECUTE FUNCTION resolve_checklist_notif_link()

### `profiles`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no |  |  |
| `email` | text | no |  |  |
| `full_name` | text | yes |  |  |
| `role` | text | no |  |  |
| `business_id` | uuid | no |  |  |
| `avatar_url` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `site_id` | uuid | yes |  |  |
| `is_group_admin` | boolean | no | false |  |
| `certifications` | text[] | no | '{}'::text[] |  |
| `preferences` | jsonb | no | '{}'::jsonb |  |
| `role_id` | uuid | yes |  |  |
| `removed_at` | timestamp with time zone | yes |  |  |

**Constraints**

- `profiles_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `profiles_id_fkey` (foreign key): FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
- `profiles_pkey` (primary key): PRIMARY KEY (id)
- `profiles_role_check` (check): CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'chef'::text, 'kitchen_staff'::text, 'front_of_house'::text])))
- `profiles_role_id_fkey` (foreign key): FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
- `profiles_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL

**Indexes**

- `idx_profiles_business`: CREATE INDEX idx_profiles_business ON public.profiles USING btree (business_id)
- `idx_profiles_role`: CREATE INDEX idx_profiles_role ON public.profiles USING btree (role)
- `idx_profiles_role_id`: CREATE INDEX idx_profiles_role_id ON public.profiles USING btree (role_id)
- `profiles_pkey`: CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Admins can manage member profiles` | UPDATE | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_team'::text)) | (business_id = get_my_business_id()) |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Users can create own profile` | INSERT | permissive | {public} |  | (id = auth.uid()) |
| `Users can update own profile` | UPDATE | permissive | {public} | (id = auth.uid()) |  |
| `Users can view business profiles` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `Users can view own profile` | SELECT | permissive | {public} | (id = auth.uid()) |  |

**Triggers**

- `trg_profile_default_site_membership` AFTER INSERT/UPDATE: EXECUTE FUNCTION grant_default_site_membership()
- `trg_revoke_channel_identities` AFTER UPDATE: EXECUTE FUNCTION revoke_channel_identities_on_profile_change()
- `trg_sync_profile_role` BEFORE INSERT/UPDATE: EXECUTE FUNCTION sync_profile_role_text()
- `trg_zguard_group_admin` BEFORE INSERT/UPDATE: EXECUTE FUNCTION guard_group_admin_escalation()
- `trg_zguard_owner_role` BEFORE UPDATE: EXECUTE FUNCTION guard_owner_role_assignment()
- `update_profiles_updated_at` BEFORE UPDATE: EXECUTE FUNCTION update_updated_at()

### `recipe_ingredients`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `recipe_id` | uuid | no |  |  |
| `ingredient_id` | uuid | no |  |  |
| `quantity` | text | yes |  |  |
| `unit` | text | yes |  |  |
| `notes` | text | yes |  |  |

**Constraints**

- `recipe_ingredients_ingredient_id_fkey` (foreign key): FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
- `recipe_ingredients_pkey` (primary key): PRIMARY KEY (id)
- `recipe_ingredients_recipe_id_fkey` (foreign key): FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE

**Indexes**

- `idx_recipe_ingredients_ingredient`: CREATE INDEX idx_recipe_ingredients_ingredient ON public.recipe_ingredients USING btree (ingredient_id)
- `idx_recipe_ingredients_recipe`: CREATE INDEX idx_recipe_ingredients_recipe ON public.recipe_ingredients USING btree (recipe_id)
- `recipe_ingredients_pkey`: CREATE UNIQUE INDEX recipe_ingredients_pkey ON public.recipe_ingredients USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view recipe ingredients` | SELECT | permissive | {public} | (recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id()))) |  |
| `Chefs can manage recipe ingredients` | ALL | permissive | {public} | ((recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id()))) AND has_capability('manage_recipes'::text)) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = demo_business_id()))) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(( SELECT r.business_id FROM recipes r WHERE (r.id = recipe_ingredients.recipe_id))) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(( SELECT r.business_id FROM recipes r WHERE (r.id = recipe_ingredients.recipe_id))) | is_business_entitled(( SELECT r.business_id FROM recipes r WHERE (r.id = recipe_ingredients.recipe_id))) |

### `recipe_sites`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `recipe_id` | uuid | no |  |  |
| `site_id` | uuid | no |  |  |

**Constraints**

- `recipe_sites_pkey` (primary key): PRIMARY KEY (recipe_id, site_id)
- `recipe_sites_recipe_id_fkey` (foreign key): FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
- `recipe_sites_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `idx_recipe_sites_site`: CREATE INDEX idx_recipe_sites_site ON public.recipe_sites USING btree (site_id)
- `recipe_sites_pkey`: CREATE UNIQUE INDEX recipe_sites_pkey ON public.recipe_sites USING btree (recipe_id, site_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (site_id IN ( SELECT sites.id FROM sites WHERE (sites.business_id = demo_business_id()))) |  |
| `recipe_sites_select` | SELECT | permissive | {authenticated} | ((recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id()))) AND can_see_site_row(site_id)) |  |
| `recipe_sites_write` | ALL | permissive | {authenticated} | ((recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id()))) AND has_capability('manage_recipes'::text) AND can_see_site_row(site_id)) | ((recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id()))) AND has_capability('manage_recipes'::text) AND can_see_site_row(site_id)) |

### `recipe_tags`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `recipe_id` | uuid | no |  |  |
| `tag_id` | uuid | no |  |  |

**Constraints**

- `recipe_tags_pkey` (primary key): PRIMARY KEY (recipe_id, tag_id)
- `recipe_tags_recipe_id_fkey` (foreign key): FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
- `recipe_tags_tag_id_fkey` (foreign key): FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE

**Indexes**

- `idx_recipe_tags_tag`: CREATE INDEX idx_recipe_tags_tag ON public.recipe_tags USING btree (tag_id)
- `recipe_tags_pkey`: CREATE UNIQUE INDEX recipe_tags_pkey ON public.recipe_tags USING btree (recipe_id, tag_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (tag_id IN ( SELECT tags.id FROM tags WHERE (tags.business_id = demo_business_id()))) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(( SELECT r.business_id FROM recipes r WHERE (r.id = recipe_tags.recipe_id))) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(( SELECT r.business_id FROM recipes r WHERE (r.id = recipe_tags.recipe_id))) | is_business_entitled(( SELECT r.business_id FROM recipes r WHERE (r.id = recipe_tags.recipe_id))) |
| `Members read recipe_tags` | SELECT | permissive | {public} | (recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id()))) |  |
| `Recipe writers manage recipe_tags` | ALL | permissive | {public} | (has_capability('manage_recipes'::text) AND (recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id())))) | (has_capability('manage_recipes'::text) AND (recipe_id IN ( SELECT recipes.id FROM recipes WHERE (recipes.business_id = get_my_business_id()))) AND (tag_id IN ( SELECT tags.id FROM tags WHERE (tags.business_id = get_my_business_id())))) |

**Triggers**

- `trg_cleanup_orphan_tag` AFTER DELETE: EXECUTE FUNCTION cleanup_orphan_tag()

### `recipes`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `name` | text | no |  |  |
| `description` | text | yes |  |  |
| `category` | text | no | 'other'::text |  |
| `instructions` | text | no | ''::text |  |
| `cooking_method` | text | yes |  |  |
| `cooking_temp` | numeric | yes |  |  |
| `cooking_time` | numeric | yes |  |  |
| `cooking_time_unit` | text | yes |  |  |
| `sfbb_check_method` | text | yes |  |  |
| `extra_care_flags` | text[] | no | '{}'::text[] |  |
| `reheating_instructions` | text | yes |  |  |
| `hot_holding_required` | boolean | no | false |  |
| `chilling_method` | text | yes |  |  |
| `photo_url` | text | yes |  |  |
| `source_video_url` | text | yes |  |  |
| `business_id` | uuid | no |  |  |
| `created_by` | uuid | no |  |  |
| `active` | boolean | no | true |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `updated_at` | timestamp with time zone | no | now() |  |
| `freezing_instructions` | text | yes |  |  |
| `defrosting_instructions` | text | yes |  |  |
| `haccp_methods` | text[] | yes | '{}'::text[] |  |
| `vegan_override` | boolean | yes |  |  |
| `vegetarian_override` | boolean | yes |  |  |
| `gluten_free_override` | boolean | yes |  |  |
| `dairy_free_override` | boolean | yes |  |  |
| `site_id` | uuid | yes |  |  |

**Constraints**

- `recipes_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `recipes_category_check` (check): CHECK ((category = ANY (ARRAY['starter'::text, 'main'::text, 'dessert'::text, 'side'::text, 'sauce'::text, 'drink'::text, 'other'::text])))
- `recipes_cooking_time_unit_check` (check): CHECK ((cooking_time_unit = ANY (ARRAY['minutes'::text, 'hours'::text])))
- `recipes_created_by_fkey` (foreign key): FOREIGN KEY (created_by) REFERENCES profiles(id)
- `recipes_pkey` (primary key): PRIMARY KEY (id)
- `recipes_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `idx_recipes_business`: CREATE INDEX idx_recipes_business ON public.recipes USING btree (business_id)
- `idx_recipes_category`: CREATE INDEX idx_recipes_category ON public.recipes USING btree (category)
- `idx_recipes_site`: CREATE INDEX idx_recipes_site ON public.recipes USING btree (site_id)
- `recipes_pkey`: CREATE UNIQUE INDEX recipes_pkey ON public.recipes USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view recipes` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `Chefs can manage recipes` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |

**Triggers**

- `update_recipes_updated_at` BEFORE UPDATE: EXECUTE FUNCTION update_updated_at()

### `review_audit`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | bigint | no |  |  |
| `review_id` | uuid | no |  |  |
| `business_id` | uuid | no |  |  |
| `action` | text | no |  |  |
| `actor_profile` | uuid | yes |  |  |
| `actor_channel` | text | yes |  |  |
| `actor_external_id` | text | yes |  |  |
| `actor_name` | text | yes |  |  |
| `at` | timestamp with time zone | no | now() |  |
| `details` | jsonb | no | '{}'::jsonb |  |

**Constraints**

- `review_audit_action_check` (check): CHECK ((action = ANY (ARRAY['imported'::text, 'drafted'::text, 'regenerated'::text, 'edited'::text, 'published'::text, 'skipped'::text, 'publish_failed'::text, 'answered_elsewhere'::text, 'deleted'::text])))
- `review_audit_actor_profile_fkey` (foreign key): FOREIGN KEY (actor_profile) REFERENCES profiles(id) ON DELETE SET NULL
- `review_audit_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `review_audit_pkey` (primary key): PRIMARY KEY (id)
- `review_audit_review_id_fkey` (foreign key): FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE

**Indexes**

- `idx_review_audit_review`: CREATE INDEX idx_review_audit_review ON public.review_audit USING btree (review_id, at)
- `review_audit_pkey`: CREATE UNIQUE INDEX review_audit_pkey ON public.review_audit USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `review managers read audit` | SELECT | permissive | {public} | can_manage_reviews(business_id) |  |

### `review_cards`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `review_id` | uuid | no |  |  |
| `group_id` | uuid | yes |  |  |
| `chat_id` | text | no |  |  |
| `message_id` | text | no |  |  |
| `sent_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `review_cards_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `review_cards_pkey` (primary key): PRIMARY KEY (chat_id, message_id)
- `review_cards_review_id_fkey` (foreign key): FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE

**Indexes**

- `idx_review_cards_review`: CREATE INDEX idx_review_cards_review ON public.review_cards USING btree (review_id)
- `review_cards_pkey`: CREATE UNIQUE INDEX review_cards_pkey ON public.review_cards USING btree (chat_id, message_id)

**Policies**

_No policies._

### `review_drafts`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `review_id` | uuid | no |  |  |
| `review_version` | integer | no |  |  |
| `draft_version` | integer | no |  |  |
| `text` | text | no |  |  |
| `source` | text | no |  |  |
| `author_profile` | uuid | yes |  |  |
| `author_channel` | text | yes |  |  |
| `author_external_id` | text | yes |  |  |
| `author_name` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `review_drafts_author_profile_fkey` (foreign key): FOREIGN KEY (author_profile) REFERENCES profiles(id) ON DELETE SET NULL
- `review_drafts_pkey` (primary key): PRIMARY KEY (id)
- `review_drafts_review_id_fkey` (foreign key): FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
- `review_drafts_review_id_review_version_draft_version_key` (unique): UNIQUE (review_id, review_version, draft_version)
- `review_drafts_source_check` (check): CHECK ((source = ANY (ARRAY['ai'::text, 'edited'::text])))
- `review_drafts_text_check` (check): CHECK ((length(text) <= 4000))

**Indexes**

- `review_drafts_pkey`: CREATE UNIQUE INDEX review_drafts_pkey ON public.review_drafts USING btree (id)
- `review_drafts_review_id_review_version_draft_version_key`: CREATE UNIQUE INDEX review_drafts_review_id_review_version_draft_version_key ON public.review_drafts USING btree (review_id, review_version, draft_version)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `review drafts readable` | SELECT | permissive | {public} | (EXISTS ( SELECT 1 FROM reviews r WHERE (r.id = review_drafts.review_id))) |  |

### `review_edit_prompts`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `chat_id` | text | no |  |  |
| `prompt_message_id` | text | no |  |  |
| `card_message_id` | text | no |  |  |
| `review_id` | uuid | no |  |  |
| `review_version` | integer | no |  |  |
| `user_id` | text | no |  |  |
| `expires_at` | timestamp with time zone | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `review_edit_prompts_pkey` (primary key): PRIMARY KEY (chat_id, prompt_message_id)
- `review_edit_prompts_review_id_fkey` (foreign key): FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE

**Indexes**

- `review_edit_prompts_pkey`: CREATE UNIQUE INDEX review_edit_prompts_pkey ON public.review_edit_prompts USING btree (chat_id, prompt_message_id)

**Policies**

_No policies._

### `review_routes`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `site_id` | uuid | no |  |  |
| `group_id` | uuid | no |  |  |
| `business_id` | uuid | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `review_routes_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `review_routes_group_id_fkey` (foreign key): FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE CASCADE
- `review_routes_pkey` (primary key): PRIMARY KEY (site_id, group_id)
- `review_routes_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `idx_review_routes_group`: CREATE INDEX idx_review_routes_group ON public.review_routes USING btree (group_id)
- `review_routes_pkey`: CREATE UNIQUE INDEX review_routes_pkey ON public.review_routes USING btree (site_id, group_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `entitlement_write_gate_ins` | INSERT | restrictive | {public} |  | is_business_entitled(business_id) |
| `review managers add routes` | INSERT | permissive | {public} |  | (can_manage_reviews(business_id) AND (EXISTS ( SELECT 1 FROM sites s WHERE ((s.id = review_routes.site_id) AND (s.business_id = review_routes.business_id) AND (s.removed_at IS NULL)))) AND (EXISTS ( SELECT 1 FROM channel_groups g WHERE ((g.id = review_routes.group_id) AND (g.business_id = review_routes.business_id) AND (g.channel = 'telegram_reviews'::text) AND (g.unlinked_at IS NULL))))) |
| `review managers read routes` | SELECT | permissive | {public} | can_manage_reviews(business_id) |  |
| `review managers remove routes` | DELETE | permissive | {public} | can_manage_reviews(business_id) |  |

### `review_settings`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `business_id` | uuid | no |  |  |
| `tone` | text | no | 'warm'::text |  |
| `sign_off` | text | no | ''::text |  |
| `avoid` | text | no | ''::text |  |
| `contact` | text | no | ''::text |  |
| `examples` | text[] | no | '{}'::text[] |  |
| `updated_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `review_settings_avoid_check` (check): CHECK ((length(avoid) <= 1000))
- `review_settings_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `review_settings_contact_check` (check): CHECK ((length(contact) <= 200))
- `review_settings_examples_check` (check): CHECK ((COALESCE(array_length(examples, 1), 0) <= 3))
- `review_settings_pkey` (primary key): PRIMARY KEY (business_id)
- `review_settings_sign_off_check` (check): CHECK ((length(sign_off) <= 120))
- `review_settings_tone_check` (check): CHECK ((tone = ANY (ARRAY['warm'::text, 'neutral'::text, 'formal'::text])))

**Indexes**

- `review_settings_pkey`: CREATE UNIQUE INDEX review_settings_pkey ON public.review_settings USING btree (business_id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `entitlement_write_gate_ins` | INSERT | restrictive | {public} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {public} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `review managers insert settings` | INSERT | permissive | {public} |  | can_manage_reviews(business_id) |
| `review managers read settings` | SELECT | permissive | {public} | can_manage_reviews(business_id) |  |
| `review managers update settings` | UPDATE | permissive | {public} | can_manage_reviews(business_id) | can_manage_reviews(business_id) |

### `reviews`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `location_id` | uuid | yes |  |  |
| `site_id` | uuid | yes |  |  |
| `google_review_id` | text | no |  |  |
| `version` | integer | no | 1 |  |
| `delivered_version` | integer | no | 0 |  |
| `stars` | integer | no |  |  |
| `comment` | text | no | ''::text |  |
| `reviewer_name` | text | no | ''::text |  |
| `create_time` | timestamp with time zone | no |  |  |
| `update_time` | timestamp with time zone | no |  |  |
| `google_reply` | text | yes |  |  |
| `google_reply_time` | timestamp with time zone | yes |  |  |
| `language` | text | yes |  |  |
| `flags` | text[] | no | '{}'::text[] |  |
| `notify` | boolean | no | false |  |
| `status` | text | no | 'new'::text |  |
| `publishing_by` | text | yes |  |  |
| `publishing_at` | timestamp with time zone | yes |  |  |
| `published_text` | text | yes |  |  |
| `published_at` | timestamp with time zone | yes |  |  |
| `published_by_profile` | uuid | yes |  |  |
| `published_by_channel` | text | yes |  |  |
| `published_by_name` | text | yes |  |  |
| `skipped_at` | timestamp with time zone | yes |  |  |
| `skipped_by_name` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `reviews_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `reviews_business_id_google_review_id_key` (unique): UNIQUE (business_id, google_review_id)
- `reviews_location_id_fkey` (foreign key): FOREIGN KEY (location_id) REFERENCES google_locations(id) ON DELETE SET NULL
- `reviews_pkey` (primary key): PRIMARY KEY (id)
- `reviews_published_by_profile_fkey` (foreign key): FOREIGN KEY (published_by_profile) REFERENCES profiles(id) ON DELETE SET NULL
- `reviews_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
- `reviews_stars_check` (check): CHECK (((stars >= 1) AND (stars <= 5)))
- `reviews_status_check` (check): CHECK ((status = ANY (ARRAY['new'::text, 'drafted'::text, 'publishing'::text, 'published'::text, 'skipped'::text, 'answered_elsewhere'::text, 'deleted'::text])))
- `reviews_version_check` (check): CHECK ((version >= 1))

**Indexes**

- `idx_reviews_pending`: CREATE INDEX idx_reviews_pending ON public.reviews USING btree (business_id) WHERE (notify AND (status = ANY (ARRAY['new'::text, 'drafted'::text])))
- `idx_reviews_site`: CREATE INDEX idx_reviews_site ON public.reviews USING btree (site_id, update_time DESC)
- `reviews_business_id_google_review_id_key`: CREATE UNIQUE INDEX reviews_business_id_google_review_id_key ON public.reviews USING btree (business_id, google_review_id)
- `reviews_pkey`: CREATE UNIQUE INDEX reviews_pkey ON public.reviews USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `reviews readable` | SELECT | permissive | {public} | (can_manage_reviews(business_id) OR ((site_id IS NOT NULL) AND (business_id = get_my_business_id()) AND can_see_site_row(site_id))) |  |

### `roles`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `base_tier` | text | no |  |  |
| `capabilities` | text[] | no | '{}'::text[] |  |
| `is_system` | boolean | no | false |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `roles_base_tier_check` (check): CHECK ((base_tier = ANY (ARRAY['owner'::text, 'manager'::text, 'chef'::text, 'kitchen_staff'::text, 'front_of_house'::text])))
- `roles_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `roles_business_id_name_key` (unique): UNIQUE (business_id, name)
- `roles_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `idx_roles_business`: CREATE INDEX idx_roles_business ON public.roles USING btree (business_id)
- `roles_business_id_name_key`: CREATE UNIQUE INDEX roles_business_id_name_key ON public.roles USING btree (business_id, name)
- `roles_business_idx`: CREATE INDEX roles_business_idx ON public.roles USING btree (business_id)
- `roles_business_name_uniq`: CREATE UNIQUE INDEX roles_business_name_uniq ON public.roles USING btree (business_id, lower(name))
- `roles_pkey`: CREATE UNIQUE INDEX roles_pkey ON public.roles USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `roles_select` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `roles_write` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND (get_my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))) | ((business_id = get_my_business_id()) AND (get_my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))) |

**Triggers**

- `trg_guard_role_delete` BEFORE DELETE: EXECUTE FUNCTION guard_role_delete()
- `trg_validate_role_caps` BEFORE INSERT/UPDATE: EXECUTE FUNCTION validate_role_capabilities()

### `sites`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `address` | text | yes |  |  |
| `postcode` | text | yes |  |  |
| `fsa_rating` | text | yes |  |  |
| `manager_id` | uuid | yes |  |  |
| `status` | text | no | 'active'::text |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `removed_at` | timestamp with time zone | yes |  |  |
| `timezone` | text | no | 'Europe/London'::text |  |

**Constraints**

- `sites_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `sites_manager_id_fkey` (foreign key): FOREIGN KEY (manager_id) REFERENCES profiles(id) ON DELETE SET NULL
- `sites_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `idx_sites_business`: CREATE INDEX idx_sites_business ON public.sites USING btree (business_id)
- `sites_pkey`: CREATE UNIQUE INDEX sites_pkey ON public.sites USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `sites_select` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_list_site(id)) |  |
| `sites_write` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_sites'::text)) | ((business_id = get_my_business_id()) AND has_capability('manage_sites'::text)) |

**Triggers**

- `trg_sites_sync_quantity` AFTER DELETE/INSERT: EXECUTE FUNCTION sites_sync_quantity()

### `staff_checkins`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `user_id` | uuid | no |  |  |
| `business_id` | uuid | no |  |  |
| `checked_in_at` | timestamp with time zone | no | now() |  |
| `checked_out_at` | timestamp with time zone | yes |  |  |
| `date` | date | no | CURRENT_DATE |  |
| `created_at` | timestamp with time zone | yes | now() |  |
| `mood` | text | yes |  |  |
| `site_id` | uuid | yes |  |  |

**Constraints**

- `staff_checkins_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `staff_checkins_pkey` (primary key): PRIMARY KEY (id)
- `staff_checkins_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
- `staff_checkins_user_id_fkey` (foreign key): FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE

**Indexes**

- `idx_staff_checkins_business_date`: CREATE INDEX idx_staff_checkins_business_date ON public.staff_checkins USING btree (business_id, date)
- `idx_staff_checkins_site`: CREATE INDEX idx_staff_checkins_site ON public.staff_checkins USING btree (site_id)
- `idx_staff_checkins_user_date`: CREATE INDEX idx_staff_checkins_user_date ON public.staff_checkins USING btree (user_id, date)
- `staff_checkins_pkey`: CREATE UNIQUE INDEX staff_checkins_pkey ON public.staff_checkins USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Users can check in` | INSERT | permissive | {public} |  | ((user_id = auth.uid()) AND (business_id = get_my_business_id()) AND can_see_site_row(site_id)) |
| `Users can check out` | UPDATE | permissive | {public} | (user_id = auth.uid()) | (user_id = auth.uid()) |
| `Users can view own business checkins` | SELECT | permissive | {public} | ((business_id = get_my_business_id()) AND can_see_site_row(site_id)) |  |

**Triggers**

- `trg_site_id_default` BEFORE INSERT: EXECUTE FUNCTION set_site_id_default()

### `suppliers`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `name` | text | no |  |  |
| `contact_name` | text | yes |  |  |
| `phone` | text | yes |  |  |
| `address` | text | yes |  |  |
| `goods_supplied` | text | yes |  |  |
| `delivery_days` | text[] | no | '{}'::text[] |  |
| `business_id` | uuid | no |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `site_id` | uuid | yes |  |  |
| `notes` | text | yes |  |  |
| `email` | text | yes |  |  |
| `website` | text | yes |  |  |
| `logo_url` | text | yes |  |  |
| `logo_domain` | text | yes |  |  |
| `logo_source` | text | yes |  |  |
| `logo_verified` | boolean | no | false |  |
| `logo_updated_at` | timestamp with time zone | yes |  |  |

**Constraints**

- `suppliers_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `suppliers_logo_domain_check` (check): CHECK (((logo_domain IS NULL) OR (char_length(logo_domain) <= 253)))
- `suppliers_logo_source_check` (check): CHECK (((logo_source IS NULL) OR (logo_source = ANY (ARRAY['brandfetch'::text, 'manual'::text]))))
- `suppliers_logo_url_check` (check): CHECK (((logo_url IS NULL) OR ((char_length(logo_url) <= 2048) AND (logo_url ~~ 'https://%'::text))))
- `suppliers_pkey` (primary key): PRIMARY KEY (id)
- `suppliers_site_id_fkey` (foreign key): FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE

**Indexes**

- `idx_suppliers_business`: CREATE INDEX idx_suppliers_business ON public.suppliers USING btree (business_id)
- `idx_suppliers_site`: CREATE INDEX idx_suppliers_site ON public.suppliers USING btree (site_id)
- `suppliers_pkey`: CREATE UNIQUE INDEX suppliers_pkey ON public.suppliers USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view suppliers` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Managers can manage suppliers` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_suppliers'::text)) | ((business_id = get_my_business_id()) AND has_capability('manage_suppliers'::text)) |

### `tags`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `business_id` | uuid | no |  |  |
| `name` | text | no |  |  |
| `name_norm` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `tags_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `tags_business_id_name_norm_key` (unique): UNIQUE (business_id, name_norm)
- `tags_name_check` (check): CHECK (((btrim(name) <> ''::text) AND (char_length(name) <= 40)))
- `tags_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `tags_business_id_name_norm_key`: CREATE UNIQUE INDEX tags_business_id_name_norm_key ON public.tags USING btree (business_id, name_norm)
- `tags_pkey`: CREATE UNIQUE INDEX tags_pkey ON public.tags USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Members read tags` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `Recipe writers manage tags` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) | ((business_id = get_my_business_id()) AND has_capability('manage_recipes'::text)) |

### `template_email_log`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `email` | text | no |  |  |
| `letter` | integer | no |  |  |
| `token` | text | no | encode(gen_random_bytes(12), 'hex'::text) |  |
| `resend_id` | text | yes |  |  |
| `sent_at` | timestamp with time zone | no | now() |  |
| `opened_at` | timestamp with time zone | yes |  |  |
| `clicked_at` | timestamp with time zone | yes |  |  |
| `click_target` | text | yes |  |  |
| `error` | text | yes |  |  |

**Constraints**

- `template_email_log_letter_check` (check): CHECK (((letter >= 1) AND (letter <= 3)))
- `template_email_log_pkey` (primary key): PRIMARY KEY (id)
- `template_email_log_token_key` (unique): UNIQUE (token)

**Indexes**

- `idx_tel_email`: CREATE INDEX idx_tel_email ON public.template_email_log USING btree (email)
- `template_email_log_pkey`: CREATE UNIQUE INDEX template_email_log_pkey ON public.template_email_log USING btree (id)
- `template_email_log_token_key`: CREATE UNIQUE INDEX template_email_log_token_key ON public.template_email_log USING btree (token)
- `uq_tel_email_letter`: CREATE UNIQUE INDEX uq_tel_email_letter ON public.template_email_log USING btree (email, letter) WHERE (error IS NULL)

**Policies**

_No policies._

### `template_leads`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `email` | text | no |  |  |
| `source` | text | yes |  |  |
| `page` | text | yes |  |  |
| `user_agent` | text | yes |  |  |
| `created_at` | timestamp with time zone | no | now() |  |
| `note` | text | yes |  |  |
| `unsubscribed_at` | timestamp with time zone | yes |  |  |

**Constraints**

- `template_leads_pkey` (primary key): PRIMARY KEY (id)

**Indexes**

- `idx_template_leads_created`: CREATE INDEX idx_template_leads_created ON public.template_leads USING btree (created_at)
- `template_leads_pkey`: CREATE UNIQUE INDEX template_leads_pkey ON public.template_leads USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `template_leads_insert` | INSERT | permissive | {anon,authenticated} |  | ((email ~~ '%@%'::text) AND (length(email) < 255)) |

### `training_records`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `id` | uuid | no | gen_random_uuid() |  |
| `profile_id` | uuid | no |  |  |
| `safe_method` | text | no |  |  |
| `trained_at` | date | no | CURRENT_DATE |  |
| `trained_by` | uuid | yes |  |  |
| `notes` | text | yes |  |  |
| `business_id` | uuid | no |  |  |

**Constraints**

- `training_records_business_id_fkey` (foreign key): FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
- `training_records_pkey` (primary key): PRIMARY KEY (id)
- `training_records_profile_id_fkey` (foreign key): FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
- `training_records_trained_by_fkey` (foreign key): FOREIGN KEY (trained_by) REFERENCES profiles(id)

**Indexes**

- `idx_training_profile`: CREATE INDEX idx_training_profile ON public.training_records USING btree (profile_id)
- `training_records_pkey`: CREATE UNIQUE INDEX training_records_pkey ON public.training_records USING btree (id)

**Policies**

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Business members can view training` | SELECT | permissive | {public} | (business_id = get_my_business_id()) |  |
| `demo_read` | SELECT | permissive | {authenticated} | (business_id = demo_business_id()) |  |
| `entitlement_write_gate_ins` | INSERT | restrictive | {authenticated} |  | is_business_entitled(business_id) |
| `entitlement_write_gate_upd` | UPDATE | restrictive | {authenticated} | is_business_entitled(business_id) | is_business_entitled(business_id) |
| `Managers can manage training` | ALL | permissive | {public} | ((business_id = get_my_business_id()) AND has_capability('manage_team'::text)) |  |

### `trial_grants`

RLS: enabled

| Column | Type | Null | Default | Comment |
|---|---|---|---|---|
| `email` | text | no |  |  |
| `granted_at` | timestamp with time zone | no | now() |  |

**Constraints**

- `trial_grants_pkey` (primary key): PRIMARY KEY (email)

**Indexes**

- `trial_grants_pkey`: CREATE UNIQUE INDEX trial_grants_pkey ON public.trial_grants USING btree (email)

**Policies**

_No policies._

## Functions (`public`)

Signatures and security only. "anon"/"authenticated" = may the role execute it.

| Function | Returns | Language | Security | Volatility | anon | authenticated |
|---|---|---|---|---|---|---|
| `_link_completion_instance()` | trigger | plpgsql | definer | volatile | yes | yes |
| `_ntfy_push(p_title text, p_message text, p_priority integer, p_tags text, p_click text)` | bigint | plpgsql | definer | volatile | yes | yes |
| `_on_auth_user_created()` | trigger | plpgsql | definer | volatile | yes | yes |
| `_on_subscription_status_change()` | trigger | plpgsql | definer | volatile | yes | yes |
| `_subscription_arbiter()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `am_i_group_admin()` | boolean | sql | definer | stable | yes | yes |
| `apply_haccp_setup(p_session uuid, p_payload jsonb)` | jsonb | plpgsql | invoker | volatile | yes | yes |
| `attach_tag(p_recipe_id uuid, p_name text)` | tags | plpgsql | invoker | volatile | no | yes |
| `billable_site_count(p_business_id uuid)` | integer | sql | definer | stable | yes | yes |
| `can_list_site(p_site uuid)` | boolean | sql | definer | stable | yes | yes |
| `can_manage_reviews(b uuid)` | boolean | sql | definer | stable | no | yes |
| `can_see_shared_row(p_site uuid)` | boolean | sql | definer | stable | yes | yes |
| `can_see_site_row(p_site uuid)` | boolean | sql | definer | stable | yes | yes |
| `can_write_kitchen_row(p_site uuid)` | boolean | sql | definer | stable | yes | yes |
| `channel_ready(b uuid, ch text)` | boolean | sql | definer | stable | no | yes |
| `cleanup_orphan_tag()` | trigger | plpgsql | definer | volatile | yes | yes |
| `compute_entitlement(p_manual_status text, p_manual_until timestamp with time zone, p_stripe_status text, p_stripe_until timestamp with time zone, p_iap_status text, p_iap_until timestamp with time zone, OUT status text, OUT until_ts timestamp with time zone)` | record | sql | invoker | stable | yes | yes |
| `consume_trial(p_email text, p_business_id uuid)` | void | plpgsql | definer | volatile | no | no |
| `copy_kitchen(from_site uuid, to_site uuid)` | void | plpgsql | invoker | volatile | yes | yes |
| `count_template_leads()` | bigint | sql | definer | stable | yes | yes |
| `create_default_site()` | trigger | plpgsql | definer | volatile | yes | yes |
| `create_invite(p_email text, p_role text)` | TABLE(token text, expires_at timestamp with time zone, email text, role text) | plpgsql | definer | volatile | no | yes |
| `create_recipe_with_ingredients(p jsonb)` | jsonb | plpgsql | definer | volatile | no | yes |
| `demo_business_id()` | uuid | sql | definer | stable | yes | yes |
| `demo_clone_day(p_src date, p_dst date)` | integer | plpgsql | definer | volatile | yes | yes |
| `demo_daily_refresh()` | void | plpgsql | definer | volatile | yes | yes |
| `generate_checklist_instances(p_business uuid, p_from date, p_to date)` | integer | plpgsql | definer | volatile | yes | yes |
| `get_my_business_id()` | uuid | sql | definer | stable | yes | yes |
| `get_my_role()` | text | sql | definer | stable | yes | yes |
| `get_my_site_id()` | uuid | sql | invoker | stable | yes | yes |
| `grant_default_site_membership()` | trigger | plpgsql | definer | volatile | yes | yes |
| `guard_channel_group_members_update()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `guard_channel_groups_update()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `guard_google_locations_update()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `guard_group_admin_escalation()` | trigger | plpgsql | definer | volatile | yes | yes |
| `guard_owner_role_assignment()` | trigger | plpgsql | definer | volatile | yes | yes |
| `guard_role_delete()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `guard_telegram_enabled()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `guard_whatsapp_enabled()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `haccp_plan_shares_guard()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `has_capability(cap text)` | boolean | sql | definer | stable | yes | yes |
| `is_active_business_manager(b uuid)` | boolean | sql | definer | stable | no | yes |
| `is_business_entitled(p_business_id uuid)` | boolean | sql | definer | stable | yes | yes |
| `is_business_manager(b uuid)` | boolean | sql | definer | stable | yes | yes |
| `issue_group_link_code(p_channel text)` | text | plpgsql | definer | volatile | no | yes |
| `issue_link_code(p_profile uuid, p_site uuid)` | text | plpgsql | definer | volatile | no | yes |
| `join_with_invite(invite_token text, member_name text)` | jsonb | plpgsql | definer | volatile | yes | yes |
| `keep_primary_site()` | trigger | plpgsql | definer | volatile | yes | yes |
| `link_checklist_instances(p_business uuid)` | integer | plpgsql | definer | volatile | yes | yes |
| `list_template_leads()` | TABLE(id uuid, email text, source text, page text, note text, created_at timestamp with time zone, unsubscribed_at timestamp with time zone, letters jsonb) | sql | definer | stable | yes | yes |
| `profiles_with_capability(b uuid, cap text)` | SETOF uuid | sql | definer | stable | no | no |
| `protect_business_deleted_at()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `protect_business_entitlement()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `purge_deleted_businesses()` | void | plpgsql | definer | volatile | no | no |
| `record_iap_purchase(p_token text, p_product_id text, p_provider text)` | jsonb | plpgsql | definer | volatile | yes | yes |
| `remove_member(p_profile uuid)` | void | plpgsql | definer | volatile | yes | yes |
| `report_due(p_from date, p_to date, p_site uuid, p_templates uuid[])` | TABLE(site_id uuid, due bigint) | sql | definer | volatile | yes | yes |
| `resolve_checklist_notif_link()` | trigger | plpgsql | definer | volatile | yes | yes |
| `reviews_delete_token(p_id uuid)` | void | sql | definer | volatile | no | no |
| `reviews_read_token(p_id uuid)` | text | sql | definer | stable | no | no |
| `reviews_store_token(p_token text, p_name text)` | uuid | sql | definer | volatile | no | no |
| `revoke_channel_identities_on_profile_change()` | trigger | plpgsql | definer | volatile | yes | yes |
| `revoke_channel_identity(p_id uuid)` | void | plpgsql | definer | volatile | no | yes |
| `search_dinesafe(q text)` | TABLE(establishment_id bigint, name text, establishment_type text, address text, status text, last_inspection date, inspections_count integer, violations_count integer, latitude double precision, longitude double precision) | sql | definer | volatile | yes | yes |
| `seed_business_roles()` | trigger | plpgsql | definer | volatile | yes | yes |
| `seed_default_checklists(p_business_id uuid)` | integer | plpgsql | definer | volatile | yes | yes |
| `set_default_trial()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `set_site_id_default()` | trigger | plpgsql | definer | volatile | yes | yes |
| `setup_business(business_name text, owner_name text, business_address text, p_fhrs_id integer, p_fsa_rating text, p_post_code text)` | jsonb | plpgsql | definer | volatile | yes | yes |
| `sites_sync_quantity()` | trigger | plpgsql | definer | volatile | yes | yes |
| `sync_profile_role_text()` | trigger | plpgsql | definer | volatile | yes | yes |
| `update_updated_at()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `validate_role_capabilities()` | trigger | plpgsql | invoker | volatile | yes | yes |
| `whatsapp_ready(b uuid)` | boolean | sql | definer | stable | no | yes |

## Cron jobs (`pg_cron`)

Name and schedule only — commands are not reproduced (they can contain secrets).

| Job | Schedule (UTC) | Active |
|---|---|---|
| `demo-daily-refresh` | `45 7 * * *` | yes |
| `generate-checklist-instances` | `10 1 * * *` | yes |
| `google-reviews-sync` | `*/15 * * * *` | yes |
| `haccp-drip-hourly` | `15 * * * *` | yes |
| `purge-deleted-businesses` | `0 3 * * *` | yes |
| `whatsapp-reminders` | `*/10 * * * *` | yes |
| `whatsapp-sync-flows` | `30 3 * * *` | yes |

## Storage

| Bucket | Public | Size limit | Allowed types |
|---|---|---|---|
| `documents` | no | 10485760 | application/pdf, image/jpeg, image/png, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |
| `videos` | no | 104857600 |  |

### Storage policies (`storage.objects`)

| Policy | Command | Kind | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `Authenticated users can delete own videos` | DELETE | permissive | {authenticated} | (bucket_id = 'videos'::text) |  |
| `Authenticated users can read videos` | SELECT | permissive | {authenticated} | (bucket_id = 'videos'::text) |  |
| `Authenticated users can upload videos` | INSERT | permissive | {authenticated} |  | (bucket_id = 'videos'::text) |
| `demo_read_documents` | SELECT | permissive | {authenticated} | ((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (demo_business_id())::text)) |  |
| `documents_storage_delete_owner_manager` | DELETE | permissive | {authenticated} | ((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.business_id)::text AS business_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = ANY (ARRAY['owner'::text, 'manager'::text]))) |  |
| `storage_documents_delete` | DELETE | permissive | {public} | ((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.business_id)::text AS business_id FROM profiles WHERE (profiles.id = auth.uid()))) AND (( SELECT profiles.role FROM profiles WHERE (profiles.id = auth.uid())) = 'owner'::text)) |  |
| `storage_documents_insert` | INSERT | permissive | {public} |  | ((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.business_id)::text AS business_id FROM profiles WHERE (profiles.id = auth.uid())))) |
| `storage_documents_select` | SELECT | permissive | {public} | ((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.business_id)::text AS business_id FROM profiles WHERE (profiles.id = auth.uid())))) |  |

