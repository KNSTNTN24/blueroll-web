# Remove hardcoded service_role key from mobile — Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development. TDD where logic applies. Steps use `- [ ]`.

**Goal:** Eliminate the hardcoded Supabase `service_role` JWT from the Flutter app by fixing the two root causes (no DELETE RLS policy; redundant admin fetch), so future builds stop shipping a full-database master key.

**Decision (Konstantin, 2026-06-07):** Do NOT rotate the leaked key — accepted risk (repo is private; key already in a test APK + private git history). Scope here is code/policy only.

**Facts established:**
- Key at `haccp-mobile/lib/screens/checklists/checklists_screen.dart:67` and `checklist_detail_screen.dart:731`. Decoded JWT role=service_role, project rszrggreuarvodcqeqrj, == `.env.local` SERVICE_ROLE_KEY. Added 2026-03-23 by Maria (`9af9aaa`, `ec56f2d`). Repo KNSTNTN24/haccp-mobile is PRIVATE. Not present in web/crm code.
- `checklist_completions` SELECT policy is already `business_id = get_my_business_id()` → the "see all team completions" admin fetch in checklists_screen.dart is REDUNDANT.
- No DELETE policy exists on `checklist_completions` or `checklist_responses` → the Undo path genuinely needed the admin key.
- `checklist_responses.completion_id` FK is `ON DELETE CASCADE` → deleting a completion auto-deletes its responses; mobile only needs to delete the completion.

---

### Task 1: DELETE RLS policy on checklist_completions (web repo, TDD)

**Files:**
- Create: `supabase/tests/sql/09_completion_delete_policy.test.sql`
- Create: `supabase/migrations/20260607160000_completion_delete_policy.sql`

Runner: `SUPABASE_ACCESS_TOKEN=sbp_… scripts/sql-api.sh <file>` (live; on HTTP error re-run curl without -f).

- [ ] **Step 1: failing test** (`09_completion_delete_policy.test.sql`):

```sql
-- DELETE policy on checklist_completions: a member may undo their OWN completion
-- (responses cascade); managers/owners may undo any in their business; nobody
-- can delete across businesses. Verified under role 'authenticated'.
DO $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_tpl uuid; v_comp uuid; v_item uuid; v_cnt int;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE email = 'testpush@g.com';
  ASSERT v_profile.id IS NOT NULL, 'test profile missing';

  INSERT INTO public.checklist_templates (name, frequency, business_id)
  VALUES ('__DELPOL_TPL__', 'daily', v_profile.business_id) RETURNING id INTO v_tpl;
  INSERT INTO public.checklist_template_items (template_id, name, item_type, sort_order)
  VALUES (v_tpl, 'i1', 'tick', 0) RETURNING id INTO v_item;

  -- a completion authored by the test user, with one response
  INSERT INTO public.checklist_completions (template_id, business_id, completed_by)
  VALUES (v_tpl, v_profile.business_id, v_profile.id) RETURNING id INTO v_comp;
  INSERT INTO public.checklist_responses (completion_id, item_id, value)
  VALUES (v_comp, v_item, 'true');

  -- act as the test user
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_profile.id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- delete own completion -> succeeds, response cascades
  DELETE FROM public.checklist_completions WHERE id = v_comp;
  RESET ROLE;
  SELECT count(*) INTO v_cnt FROM public.checklist_completions WHERE id = v_comp;
  ASSERT v_cnt = 0, 'own completion not deleted';
  SELECT count(*) INTO v_cnt FROM public.checklist_responses WHERE completion_id = v_comp;
  ASSERT v_cnt = 0, format('responses did not cascade: %s left', v_cnt);

  -- foreign-business completion must NOT be deletable
  INSERT INTO public.checklist_completions (template_id, business_id, completed_by)
  VALUES (v_tpl, v_profile.business_id, v_profile.id) RETURNING id INTO v_comp;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000099', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.checklist_completions WHERE id = v_comp; -- RLS: affects 0 rows
  RESET ROLE;
  SELECT count(*) INTO v_cnt FROM public.checklist_completions WHERE id = v_comp;
  ASSERT v_cnt = 1, 'foreign user was able to delete (RLS hole)';

  DELETE FROM public.checklist_templates WHERE id = v_tpl; -- cleanup (cascades)
END $$;
SELECT 'COMPLETION DELETE POLICY TESTS PASSED' AS result;
```

- [ ] **Step 2:** run → RED (delete of own completion affects 0 rows because no DELETE policy exists → `v_cnt = 1` assert "own completion not deleted" fires). Paste verbatim.
- [ ] **Step 3:** migration (`20260607160000_completion_delete_policy.sql`):

```sql
-- Undo a checklist completion without the service_role key (2026-06-07).
-- A member may delete their OWN completion; managers/owners may delete any in
-- their business. checklist_responses cascade via FK ON DELETE CASCADE, so no
-- separate responses policy is needed.
DROP POLICY IF EXISTS "Delete own or managed completions" ON public.checklist_completions;
CREATE POLICY "Delete own or managed completions" ON public.checklist_completions
  FOR DELETE
  USING (
    business_id = public.get_my_business_id()
    AND (completed_by = auth.uid() OR public.get_my_role() IN ('owner','manager'))
  );
```

- [ ] **Step 4:** apply + re-run → `[{"result":"COMPLETION DELETE POLICY TESTS PASSED"}]`. Re-run tests 01-08 (no regressions).
- [ ] **Step 5:** commit both files: `feat(db): DELETE policy on checklist_completions (undo without service key)`

---

### Task 2: strip the key from the mobile app (haccp-mobile, branch KNS/v-next)

**Files:**
- Modify: `lib/screens/checklists/checklists_screen.dart` (remove the admin HTTP fallback ~64-90)
- Modify: `lib/screens/checklists/checklist_detail_screen.dart` (Undo ~725-745: use normal client, delete completion only)

- [ ] **Step 1 (checklists_screen.dart):** read the block ~58-95. The normal query (`.from('checklist_completions').select(...).eq('business_id', ...)`) already returns all team completions (SELECT policy is business-scoped). DELETE the entire `try { const sk = '...'; final resp = await http.get(... apikey: sk ...); allCompletions = ...; } catch` admin-fallback block; keep `allCompletions = myCompletions as List;`. Remove the now-unused `http` import IF nothing else in the file uses it (grep first). Verify no other reference to `sk`/the key remains in the file.
- [ ] **Step 2 (checklist_detail_screen.dart):** in the Undo handler (~725-745) replace:

```dart
      // Use admin client to bypass RLS
      final adminClient = SupabaseClient(SupabaseConfig.url, 'eyJ...service_role...');
      await adminClient.from('checklist_responses').delete().eq('completion_id', completionId);
      await adminClient.from('checklist_completions').delete().eq('id', completionId);
```

with (responses cascade via FK; normal client now permitted by the Task-1 policy):

```dart
      // Normal client — RLS now allows deleting own/managed completions;
      // checklist_responses cascade via FK ON DELETE CASCADE.
      await SupabaseConfig.client
          .from('checklist_completions')
          .delete()
          .eq('id', completionId);
```

Remove the unused `SupabaseClient` import IF unused elsewhere (grep).
- [ ] **Step 3:** `grep -rn "service_role\|gcQOi5ifm" lib/` → MUST be zero hits. Paste.
- [ ] **Step 4:** `flutter analyze` (no new issues) + `flutter test` (15 pass).
- [ ] **Step 5:** commit both files: `fix(security): remove hardcoded service_role key; use RLS + cascade`

---

### Task 3: docs + verify

- [ ] Append to web `docs/superpowers/README.md`:

```markdown

## Security: service_role key removed from mobile (2026-06-07)

- Был зашит `service_role` JWT в haccp-mobile (checklists_screen + checklist_detail) — обход RLS.
- Причина закрыта: SELECT-политика completions уже business-scoped (admin-fetch был лишним);
  добавлена DELETE-политика `Delete own or managed completions` (responses каскадят по FK).
- Ключ удалён из обоих файлов; будущие сборки его не отгружают.
- Ключ НЕ ротирован (решение Константина: репо приватный, риск принят). При смене решения —
  Settings→API→roll + обновить env: Edge Functions, Railway CRM, scripts/sql-api.sh.
- Тест: supabase/tests/sql/09.
```

- [ ] Re-run SQL test 09 + `flutter test`. Commit README: `docs: service_role removal notes`.
- [ ] Update `~/HACCP/sessions/2026-06-07.md` (separate repo) + commit.

---

## Self-review
- Root causes both addressed: redundant admin fetch (removed, SELECT policy already covers it) + missing DELETE policy (added). Cascade verified via FK so responses need no policy.
- DELETE policy is business-scoped + own-or-manager — verified by the foreign-user negative test.
- No placeholders; full SQL + Dart. Key-removal gated by a zero-hit grep.
