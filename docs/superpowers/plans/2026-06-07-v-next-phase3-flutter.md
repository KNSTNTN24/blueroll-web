# v-next Phase 3 (Flutter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Flutter release: mobile sides of v-next items 1–7 + carried-over A (Buy owner-only) and B (team-flag as cache).

**Architecture:** Pure logic (dietary resolution in the Recipe model, checklist card status, initials validation) TDD'd with `flutter test`. UI wiring verified by `flutter analyze` + build. DB/RPC groundwork is live (Phase 1); web reference implementations exist (Phase 2) — mirror their semantics, not their code.

**Tech Stack:** Flutter/Dart, Riverpod, Supabase Dart client, SharedPreferences. Repo `~/HACCP/haccp-mobile`, branch: create `KNS/v-next` from current main (`d25c3ca`). Spec: `blueroll-web docs/superpowers/specs/2026-06-07-v-next-fixes-design.md`.

**Conventions:**
- Tests in `test/` (flutter_test present). If the stock `widget_test.dart` fails pre-existing, note it and exclude from the gate — do not fix unrelated code.
- Every task: `flutter analyze` (no new issues) + `flutter test` green before commit. Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Untracked junk in the repo (`android/`?? screenshots) — never stage; commit only named files. (`android/` untracked is suspicious — investigate in Task 0; a Flutter app needs android/ in git.)
- Old-data safety: every new model field parses with a default (`?? false`, `?? 1`, `?? null`) — rows created before Phase 1 columns existed must not crash parsing.

---

### Task 0: branch + repo sanity

- [ ] `git checkout -b KNS/v-next` from `d25c3ca`.
- [ ] Investigate untracked `android/`: `git log --oneline -3 -- android` (was it ever tracked? `.gitignore`d?). If it was deliberately untracked (e.g. local signing configs), leave as is and note; if it's a mistake, report DONE_WITH_CONCERNS — do NOT stage it without the controller's decision.
- [ ] `flutter analyze` + `flutter test` baseline: record current state (pre-existing issues are the baseline, not your problem).
- [ ] No commit (or commit nothing) — reporting task.

---

### Task 1: Recipe model — dietary overrides (TDD)

**Files:**
- Create: `test/models/recipe_dietary_test.dart`
- Modify: `lib/models/recipe.dart` (fromJson + fields + getters at 90-118, 152-177)

- [ ] **Step 1: Write the failing test:**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:blueroll/models/recipe.dart'; // adjust package name to pubspec `name:` if different — check before running

Map<String, dynamic> recipeJson({Map<String, dynamic> extra = const {}}) => {
      'id': 'r1',
      'name': 'Test',
      'category': 'main',
      'business_id': 'b1',
      'created_by': 'u1',
      'created_at': '2026-06-07T00:00:00Z',
      'recipe_ingredients': [
        {
          'id': 'ri1',
          'quantity': '1',
          'unit': 'kg',
          'ingredient': {'id': 'i1', 'name': 'Milk', 'allergens': ['milk']},
        }
      ],
      ...extra,
    };

void main() {
  test('no overrides: derived from allergens (milk -> not vegan/DF)', () {
    final r = Recipe.fromJson(recipeJson());
    expect(r.dietaryLabels, ['Vegetarian', 'GF']);
  });

  test('override true beats computed false', () {
    final r = Recipe.fromJson(recipeJson(extra: {'dairy_free_override': true}));
    expect(r.dietaryLabels.contains('DF'), true);
  });

  test('override false beats computed true (beef stew is not vegetarian)', () {
    final r = Recipe.fromJson(recipeJson(extra: {
      'vegetarian_override': false,
      'vegan_override': false,
    }));
    expect(r.dietaryLabels.contains('Vegetarian'), false);
    expect(r.dietaryLabels.contains('Vegan'), false);
  });

  test('old rows without override keys parse fine (null = auto)', () {
    final r = Recipe.fromJson(recipeJson());
    expect(r.veganOverride, isNull);
    expect(r.vegetarianOverride, isNull);
    expect(r.glutenFreeOverride, isNull);
    expect(r.dairyFreeOverride, isNull);
  });
}
```

- [ ] **Step 2:** `flutter test test/models/recipe_dietary_test.dart` → RED (no such fields).
- [ ] **Step 3:** Model changes:
  - fields: `final bool? veganOverride; final bool? vegetarianOverride; final bool? glutenFreeOverride; final bool? dairyFreeOverride;` (+ constructor params)
  - fromJson: `veganOverride: json['vegan_override'] as bool?,` (×4)
  - getters become override-aware:

```dart
  bool get _computedVegetarian {
    final a = allAllergens;
    return !a.contains('fish') && !a.contains('crustaceans') && !a.contains('molluscs');
  }

  bool get isVegetarian => vegetarianOverride ?? _computedVegetarian;

  bool get isVegan =>
      veganOverride ??
      (_computedVegetarian &&
          !allAllergens.contains('milk') &&
          !allAllergens.contains('eggs'));

  bool get isGlutenFree => glutenFreeOverride ?? !allAllergens.contains('gluten');
  bool get isDairyFree => dairyFreeOverride ?? !allAllergens.contains('milk');
```

  (`dietaryLabels` stays as-is — it reads the getters. NOTE the Vegan/Vegetarian exclusivity in dietaryLabels: with `vegan_override=true` and `vegetarian_override=false` the label list shows 'Vegan' — acceptable, matches web's independent flags closely enough; don't over-engineer.)
- [ ] **Step 4:** GREEN; `flutter analyze` no new issues.
- [ ] **Step 5:** Commit test + model: `feat(recipes): dietary tri-state overrides in model`

---

### Task 2: dietary chips on recipe new/edit

**Files:**
- Create: `lib/widgets/dietary_chips.dart`
- Modify: `lib/screens/recipes/recipe_new_screen.dart` (state + payload at 72-114 + UI anchor after allergen Wrap ~186)
- Modify: `lib/screens/recipes/recipe_edit_screen.dart` (load/hydrate + payload at 139-152 + same UI anchor ~395)

- [ ] **Step 1:** Widget:

```dart
import 'package:flutter/material.dart';
import '../config/theme.dart'; // adjust to the AppColors import used by neighbours

/// Tri-state dietary chips: auto (computed) -> forced ON -> forced OFF -> auto.
/// overrides values: null = auto, true/false = explicit.
class DietaryChips extends StatelessWidget {
  const DietaryChips({
    super.key,
    required this.overrides,
    required this.computed,
    required this.onChanged,
  });

  /// keys: vegan, vegetarian, gluten_free, dairy_free
  final Map<String, bool?> overrides;

  /// computed effective value per key (from current ingredient allergens)
  final Map<String, bool> computed;
  final ValueChanged<Map<String, bool?>> onChanged;

  static const labels = {
    'vegan': 'Vegan',
    'vegetarian': 'Vegetarian',
    'gluten_free': 'Gluten-Free',
    'dairy_free': 'Dairy-Free',
  };

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: labels.entries.map((e) {
        final o = overrides[e.key];
        final on = o ?? (computed[e.key] ?? false);
        return FilterChip(
          label: Text(
            o == null ? '${e.value} · auto' : e.value,
            style: TextStyle(
              fontSize: 11,
              decoration: on ? null : TextDecoration.lineThrough,
            ),
          ),
          selected: on,
          showCheckmark: false,
          side: o != null ? const BorderSide(width: 1.5) : null,
          onSelected: (_) {
            final next = o == null ? true : (o == true ? false : null);
            onChanged({...overrides, e.key: next});
          },
        );
      }).toList(),
    );
  }
}
```

- [ ] **Step 2 (new screen):** state `Map<String, bool?> _dietary = {'vegan': null, 'vegetarian': null, 'gluten_free': null, 'dairy_free': null};`; computed map from current ingredient allergens (reuse the model rules: build a helper or inline the same exclusion lists); render a "Dietary" `_FormCard`/section AFTER the allergen Wrap block (anchor line ~186) following the screen's section idiom; insert payload adds:

```dart
        'vegan_override': _dietary['vegan'],
        'vegetarian_override': _dietary['vegetarian'],
        'gluten_free_override': _dietary['gluten_free'],
        'dairy_free_override': _dietary['dairy_free'],
```

- [ ] **Step 3 (edit screen):** hydrate `_dietary` from the loaded recipe row in `_loadRecipe` (json `vegan_override` etc.); same UI; add the 4 keys to the `.update({...})` payload (139-152).
- [ ] **Step 4:** `flutter analyze` + `flutter test` green.
- [ ] **Step 5:** Commit: `feat(recipes): editable dietary chips on new/edit`

---

### Task 3: AI import — atomic RPC + return to recipe (item 6)

**Files:**
- Modify: `lib/screens/ai_import/ai_import_screen.dart` `_saveRecipe` (206-298)

- [ ] **Step 1:** Replace the insert + per-ingredient loop (lines ~220-275) with:

```dart
      final rpcResult = await db.rpc('create_recipe_with_ingredients', params: {
        'p': {
          'recipe': {
            'name': r['name'] ?? 'Imported Recipe',
            'description': r['description'],
            'category': r['category'] ?? 'other',
            'instructions': r['instructions'] ?? '',
            'cooking_method': r['cookingMethod'],
            'cooking_temp': r['cookingTemp']?.toString(),
            'cooking_time': r['cookingTime']?.toString(),
            'cooking_time_unit': r['cookingTimeUnit'] ?? 'minutes',
          },
          'ingredients': [
            for (final ing in (r['ingredients'] as List<dynamic>? ?? []))
              if (((ing as Map<String, dynamic>)['name'] as String?)?.trim().isNotEmpty ?? false)
                {
                  'name': (ing['name'] as String).trim(),
                  'allergens':
                      (ing['allergens'] as List<dynamic>?)?.cast<String>() ?? [],
                  'quantity': ing['quantity']?.toString(),
                  'unit': ing['unit'],
                },
          ],
        },
      });
      final recipeId = (rpcResult as Map<String, dynamic>)['recipe_id'] as String;

      // source_video_url is not part of the RPC payload — non-critical follow-up
      if (videoUrl.isNotEmpty) {
        try {
          await db
              .from('recipes')
              .update({'source_video_url': videoUrl}).eq('id', recipeId);
        } catch (e) {
          debugPrint('source_video_url update failed (non-critical): $e');
        }
      }
```

  ⚠️ Supabase Dart `.rpc()` THROWS on error (unlike JS) — the existing try/catch already handles it; the catch's SnackBar must keep the user on the import screen with `_parsedRecipe` intact (it does — verify nothing resets it in catch/finally).
- [ ] **Step 2:** Navigation (line ~285): `context.go('/recipes');` → `context.go('/recipes/$recipeId');` — CHECK the router (`lib/config/router.dart`) for the recipe-detail route pattern first; use its exact path shape. If the detail route requires an object/extra instead of id-in-path, report DONE_WITH_CONCERNS with specifics rather than improvising.
- [ ] **Step 3:** `flutter analyze` green.
- [ ] **Step 4:** Commit: `fix(ai-import): atomic RPC save + land on the imported recipe`

---

### Task 4: checklist model + card status/ordering + multi-per-day (items 4+5)

**Files:**
- Create: `test/models/checklist_status_test.dart`
- Modify: `lib/models/checklist.dart` (ChecklistTemplate fields/fromJson 155-175; new pure function)
- Modify: `lib/screens/checklists/checklists_screen.dart` (status 80-98, list build/sort, card subtitle 269-322)
- Modify: `lib/screens/checklists/checklist_detail_screen.dart` (mode gate ~103-118)
- Modify: `lib/screens/checklists/checklist_manage_screen.dart` (fields 352-445 area; payload 145-157)

- [ ] **Step 1: failing tests** for a new pure function in the model file:

```dart
// test/models/checklist_status_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:blueroll/models/checklist.dart'; // adjust package name

void main() {
  ChecklistTemplate tpl({bool multi = false, int min = 1, String? deadline}) =>
      ChecklistTemplate.fromJson({
        'id': 't1', 'name': 'T', 'frequency': 'daily', 'business_id': 'b1',
        'created_at': '2026-06-07T00:00:00Z',
        'multi_per_day': multi, 'min_per_day': min, 'deadline_time': deadline,
      });

  test('old rows parse without new keys (defaults false/1)', () {
    final t = ChecklistTemplate.fromJson({
      'id': 't1', 'name': 'T', 'frequency': 'daily', 'business_id': 'b1',
      'created_at': '2026-06-07T00:00:00Z',
    });
    expect(t.multiPerDay, false);
    expect(t.minPerDay, 1);
  });

  test('single, none today, before deadline -> pending', () {
    final s = cardStatus(tpl(deadline: '23:59'), 0, false,
        now: DateTime(2026, 6, 7, 10));
    expect(s.label, 'Pending');
    expect(s.done, false);
  });

  test('single, none, past deadline -> overdue', () {
    final s = cardStatus(tpl(deadline: '09:00'), 0, false,
        now: DateTime(2026, 6, 7, 10));
    expect(s.label, 'Overdue');
    expect(s.overdue, true);
  });

  test('multi below min -> N/M today, not done', () {
    final s = cardStatus(tpl(multi: true, min: 8), 3, false);
    expect(s.label, '3/8 today');
    expect(s.done, false);
  });

  test('multi at min -> done', () {
    final s = cardStatus(tpl(multi: true, min: 2), 2, false);
    expect(s.done, true);
  });

  test('multi min 0 -> always done, count label', () {
    final s = cardStatus(tpl(multi: true, min: 0), 0, false);
    expect(s.label, '0 today');
    expect(s.done, true);
  });

  test('sort: pending first, deadline asc nulls last, name', () {
    final a = (t: tpl(deadline: '09:00'), done: false, name: 'B');
    final b = (t: tpl(deadline: '17:00'), done: false, name: 'A');
    final c = (t: tpl(), done: false, name: 'A');
    final d = (t: tpl(deadline: '08:00'), done: true, name: 'A');
    expect(compareCards(a, b), lessThan(0));   // earlier deadline first
    expect(compareCards(b, c), lessThan(0));   // deadline before none
    expect(compareCards(a, d), lessThan(0));   // pending before done
  });
}
```

- [ ] **Step 2:** RED (fields/functions missing).
- [ ] **Step 3:** Model: add `final bool multiPerDay; final int minPerDay;` to ChecklistTemplate (+constructor), fromJson: `multiPerDay: json['multi_per_day'] as bool? ?? false, minPerDay: (json['min_per_day'] as num?)?.toInt() ?? 1,`. Pure functions in the same file:

```dart
class CardStatus {
  const CardStatus({required this.label, required this.done, this.overdue = false});
  final String label;
  final bool done;
  final bool overdue;
}

/// Mirror of web src/lib/checklist-status.ts (counter model).
CardStatus cardStatus(ChecklistTemplate t, int periodCount, bool signedOffOrNoSupervisor,
    {DateTime? now}) {
  final n = now ?? DateTime.now();
  if (t.multiPerDay) {
    final min = t.minPerDay < 0 ? 0 : t.minPerDay;
    if (min == 0) return CardStatus(label: '$periodCount today', done: true);
    if (periodCount >= min) return CardStatus(label: '$periodCount/$min today', done: true);
    return CardStatus(label: '$periodCount/$min today', done: false);
  }
  if (periodCount == 0) {
    if (t.deadlineTime != null && t.deadlineTime!.contains(':')) {
      final p = t.deadlineTime!.split(':');
      final dl = DateTime(n.year, n.month, n.day, int.parse(p[0]), int.parse(p[1]));
      if (n.isAfter(dl)) return const CardStatus(label: 'Overdue', done: false, overdue: true);
    }
    return const CardStatus(label: 'Pending', done: false);
  }
  return CardStatus(
      label: signedOffOrNoSupervisor ? 'Completed' : 'Awaiting Sign-off', done: true);
}

int compareCards(
    ({ChecklistTemplate t, bool done, String name}) a,
    ({ChecklistTemplate t, bool done, String name}) b) {
  if (a.done != b.done) return a.done ? 1 : -1;
  final ad = a.t.deadlineTime, bd = b.t.deadlineTime;
  if (ad != bd) {
    if (ad == null) return 1;
    if (bd == null) return -1;
    return ad.compareTo(bd);
  }
  return a.name.compareTo(b.name);
}
```

- [ ] **Step 4:** GREEN.
- [ ] **Step 5 (list screen):** compute per-template `periodCount` (completions in today/period — completions provider already supplies the list; multi uses TODAY); replace `getChecklistStatus` usage with `cardStatus`; sort cards with `compareCards`; subtitle shows the status label + `by ${deadline}` when set, overdue in amber/red per file's palette.
- [ ] **Step 6 (detail gate):** in `_ScreenMode` resolution (~103-118): if `template.multiPerDay` → ALWAYS `_ScreenMode.fill` (new completion any time).
- [ ] **Step 7 (manage screen):** below the deadline `_FormCard` add a multi-per-day card: switch "Can be completed multiple times per day" + when on, an int stepper/TextField "Minimum per day (0 = optional)" (`_multiPerDay`, `_minPerDay` state; hydrate in `_loadTemplate`); payload (145-157) adds `'multi_per_day': _multiPerDay, 'min_per_day': _multiPerDay ? _minPerDay : 1,`.
- [ ] **Step 8:** analyze + tests green. Commit all five files: `feat(checklists): multi-per-day counter, deadline ordering + overdue`

---

### Task 5: checklist drafts (item 2)

**Files:**
- Modify: `lib/screens/checklists/checklist_detail_screen.dart`

- [ ] **Step 1:** On load (fill mode only): fetch draft, hydrate `_responses`/`_notes` if user hasn't typed yet:

```dart
  Future<void> _loadDraft() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) return;
    final row = await SupabaseConfig.client
        .from('checklist_drafts')
        .select('responses')
        .eq('template_id', widget.templateId)
        .eq('created_by', profile.id)
        .maybeSingle();
    if (row != null && mounted && _responses.isEmpty) {
      final saved = (row['responses'] as Map<String, dynamic>);
      setState(() {
        saved.forEach((k, v) => _responses[k] = v.toString());
      });
    }
  }
```

  (call it where the template finishes loading, fill mode only; text/temperature controllers must be re-seeded — use the existing `_controllerFor` mechanism: set controller.text for hydrated keys.)
- [ ] **Step 2:** "Save draft" OutlinedButton next to Submit (bottom row ~753-784, fill mode only): upsert

```dart
      await SupabaseConfig.client.from('checklist_drafts').upsert({
        'template_id': widget.templateId,
        'business_id': profile.businessId,
        'created_by': profile.id,
        'responses': _responses,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }, onConflict: 'template_id,created_by');
```

  with guard `if (profile == null) return;`, Toast.success('Draft saved'), Toast.error on catch.
- [ ] **Step 3:** In `_submit()` success path (after responses insert): delete the draft (try/catch, non-fatal): `.from('checklist_drafts').delete().eq('template_id', widget.templateId).eq('created_by', profile.id)`.
- [ ] **Step 4:** analyze green. Commit: `feat(checklists): save draft, resume later`

---

### Task 6: `initials` item type (item 3)

**Files:**
- Create: `test/models/initials_test.dart`
- Modify: `lib/models/checklist.dart` (enum 57-85 + small helpers)
- Modify: `lib/screens/checklists/checklist_detail_screen.dart` (`_buildInput` switch 905-988 + submit validation 133-139)
- Modify: `lib/screens/checklists/checklist_manage_screen.dart` (item-type picker — find where items' types are chosen; add the new enum value's label)

- [ ] **Step 1: failing test:**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:blueroll/models/checklist.dart'; // adjust package name

void main() {
  test('initials enum parses and displays', () {
    expect(ChecklistItemType.fromString('initials'), ChecklistItemType.initials);
    expect(ChecklistItemType.initials.displayName, 'Initials (who filled this)');
  });
  test('unknown type still falls back to tick', () {
    expect(ChecklistItemType.fromString('hologram'), ChecklistItemType.tick);
  });
  test('initials validation: 2-5 alphanumeric, uppercased', () {
    expect(isValidInitials('jd'), true);
    expect(isValidInitials('JDOE5'), true);
    expect(isValidInitials('J'), false);
    expect(isValidInitials('TOOLONG'), false);
    expect(isValidInitials('J.D'), false);
  });
}
```

- [ ] **Step 2:** RED → model: add `initials` to the enum + `displayName` case `'Initials (who filled this)'`; top-level helpers in checklist.dart:

```dart
String normalizeInitials(String v) => v.trim().toUpperCase();
bool isValidInitials(String v) => RegExp(r'^[A-Z0-9]{2,5}$').hasMatch(normalizeInitials(v));
```

→ GREEN.
- [ ] **Step 3:** `_buildInput` new case (uses SharedPreferences key `blueroll_last_initials`):

```dart
      case ChecklistItemType.initials:
        return TextFormField(
          key: ValueKey('initials_${item.id}'),
          controller: _controllerFor(item.id),
          textCapitalization: TextCapitalization.characters,
          maxLength: 5,
          decoration: const InputDecoration(hintText: 'e.g. JD', counterText: ''),
          onTap: () async {
            if ((_responses[item.id] ?? '').isEmpty) {
              final prefs = await SharedPreferences.getInstance();
              final last = prefs.getString('blueroll_last_initials');
              if (last != null && mounted) {
                _controllerFor(item.id).text = last;
                setState(() => _responses[item.id] = last);
              }
            }
          },
          onChanged: (v) async {
            final norm = normalizeInitials(v);
            setState(() => _responses[item.id] = norm);
            if (isValidInitials(norm)) {
              final prefs = await SharedPreferences.getInstance();
              await prefs.setString('blueroll_last_initials', norm);
            }
          },
        );
```

- [ ] **Step 4:** submit validation (after the required-empty loop 133-139): for required initials items, reject invalid values:

```dart
    for (final item in (_template!.items ?? []).where(
        (i) => i.required && i.itemType == ChecklistItemType.initials)) {
      if (!isValidInitials(_responses[item.id] ?? '')) {
        Toast.error(context, '${item.name}: enter 2–5 letters/digits');
        return;
      }
    }
```

- [ ] **Step 5:** manage screen item-type picker: the new enum value appears automatically if the picker iterates `ChecklistItemType.values` — VERIFY (grep how the type selector is built); if it's a hardcoded list, add initials with `displayName`.
- [ ] **Step 6:** analyze + tests green. Commit: `feat(checklists): initials item type`

---

### Task 7: paywall Buy — owner only (carried-over A)

**Files:**
- Modify: `lib/screens/auth/paywall_screen.dart` (Buy block 301-339; screen reads `ref` already)

- [ ] **Step 1:** Read role: `final role = ref.watch(profileProvider).value?.role;` (the screen is a ConsumerWidget/ConsumerState — follow its pattern). Replace the Buy `SizedBox` block: when `role != null && role.name != 'owner'`, render instead of the buy button:

```dart
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: ShapeDecoration(
                        color: Colors.white.withValues(alpha: 0.12),
                        shape: ContinuousRectangleBorder(
                            borderRadius: BorderRadius.circular(28)),
                      ),
                      child: const Text(
                        'Subscription inactive.\nAsk the business owner to renew it.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.white, fontSize: 15),
                      ),
                    ),
```

  Keep Buy for `role == null` (profile still loading or pre-onboarding owner flow) and for owners. Restore link (365) stays for everyone.
- [ ] **Step 2:** analyze green. Commit: `feat(paywall): purchase restricted to owner role`

---

### Task 8: team flag — cache, not override (carried-over B)

**Files:**
- Modify: `lib/providers/purchase_provider.dart` `_init()` (110-137)

- [ ] **Step 1:** Change the team-flag semantics: it grants optimistic access for instant UX/offline, but the server check runs ALWAYS and can revoke:

Old (lines ~112-127):
```dart
    final persisted = prefs.getBool(_subscribedKey) ?? false;
    final isTeam = prefs.getBool(_teamKey) ?? false;
    if (persisted || isTeam) {
      state = state.copyWith(isSubscribed: true);
    }

    if (!state.isSubscribed) {
      final hasServerEntitlement = await _checkSupabaseSubscription();
      ...
    }

    if (isTeam) {
      state = state.copyWith(isAvailable: false);
      return;
    }
```

New:
```dart
    final persisted = prefs.getBool(_subscribedKey) ?? false;
    final isTeam = prefs.getBool(_teamKey) ?? false;
    if (persisted || isTeam) {
      // Optimistic: instant access for cached members (also covers offline).
      state = state.copyWith(isSubscribed: true);
    }

    if (isTeam) {
      // Team flag is a CACHE, not a permanent override: when the server is
      // reachable, the business row is the truth. Offline/error -> keep cache.
      try {
        final entitled = await _checkSupabaseSubscription();
        if (!entitled) {
          state = state.copyWith(isSubscribed: false);
          await prefs.setBool(_teamKey, false);
        }
      } catch (_) {
        // network error: keep optimistic access
      }
      // Team members never touch the store IAP machinery on this device.
      state = state.copyWith(isAvailable: false);
      return;
    }

    if (!state.isSubscribed) {
      final hasServerEntitlement = await _checkSupabaseSubscription();
      if (hasServerEntitlement) {
        state = state.copyWith(isSubscribed: true);
        await _persistSubscribed(true);
      }
    }
```

  ⚠️ READ `_checkSupabaseSubscription` first (lines 240-271): it returns false BOTH for "not entitled" and for caught network errors (`catch (_) { return false; }`). Revoking on a network error would lock out an offline kitchen. You MUST distinguish: either add a tri-state variant (`Future<bool?> _serverEntitlement()` returning null on exception) and use it here, or refactor the existing method — keep the old behavior for the non-team path. The plan's intent: `null` (unreachable) → keep cache; `false` (server says no) → revoke.
- [ ] **Step 2:** analyze green. Commit: `fix(purchase): team flag demoted to cache — server can revoke`

---

### Task 9: release prep

- [ ] `pubspec.yaml`: bump version (current is 1.3.3+13 per session notes — set `1.4.0+14`).
- [ ] `flutter analyze` (no new issues vs Task-0 baseline), `flutter test` (all green).
- [ ] `flutter build appbundle --release` → paste the output path/size. (Konstantin uploads to Play Console manually; iOS build out of scope this release.)
- [ ] Release notes draft (commit in repo as `RELEASE_NOTES_1.4.0.md`): dietary editing, checklist drafts, initials, multi-per-day + deadlines ordering, AI-import fix, library nav, team/paywall hardening.
- [ ] Commit pubspec + notes: `chore: v1.4.0+14 release prep`
- [ ] Update `~/HACCP/sessions/2026-06-07.md` (separate repo) + commit there.

---

## Self-review (done at plan time)

- **Spec coverage:** items 1→T1/T2, 2→T5, 3→T6, 4+5→T4, 6→T3, 7→**covered by T4 step 6? NO** — item 7 mobile = post-edit navigation to Library tab: `checklist_manage_screen.dart:225` `context.go('/checklists')`. **Added here:** T4 Step 7.5: change to `context.go('/checklists?tab=library')` IF the checklists screen supports a tab query param — it likely does NOT (TabController index, not URL). Simpler mobile-idiomatic fix: after save use `context.pop()` (manage screen is pushed from the Library tab, so popping returns there) — verify how the screen is opened in router.dart; if pushed → pop; if go-routed → pass a `?tab=1` param and read it in ChecklistsScreen initState to set `_tabCtrl.index`. Implementer verifies and applies whichever matches the router; report which.
- A→T7, B→T8.
- **Placeholders:** all code steps carry code; steps with repo-dependent uncertainty (router path shape T3, type picker T6.5, tab return T4) explicitly instruct verify-then-apply with BLOCKED/DONE_WITH_CONCERNS escape — no silent improvisation.
- **Old-data safety:** every new parsed field defaults (T1 test 4, T4 test 1).
- **Package name in test imports** flagged in both test files (check pubspec `name:`).
