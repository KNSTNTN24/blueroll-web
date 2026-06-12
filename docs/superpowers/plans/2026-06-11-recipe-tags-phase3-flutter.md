# Recipe Tags Phase 3 (Flutter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Flutter release: `RecipeCategory` enum deleted, recipes carry tags; flat recipes list with tag filter + group-by-tags; tag chips editor in new/edit; tags in detail, exports, AI import.

**Architecture:** Pure logic (model tag parsing, grouping with duplicates) TDD'd with `flutter test`. UI wiring verified by `flutter analyze` + build. DB groundwork is live (Phase 1: `tags`, `recipe_tags`, `attach_tag`, RPC `tags[]`); web reference exists (Phase 2) — mirror its semantics (AND filter, duplicate-per-tag grouping, Untagged last), not its code. Spec: blueroll-web `docs/superpowers/specs/2026-06-11-recipe-tags-design.md`.

**Tech Stack:** Flutter/Dart, Riverpod, Supabase Dart client. Repo `~/HACCP/haccp-mobile`; branch: create `KNS/recipe-tags` from current main. Package name for test imports: `haccp_mobile` (pubspec `name:`).

**Conventions:**
- Every task: `flutter analyze` (no NEW issues vs Task-0 baseline) + `flutter test` green before commit. Commit footer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commit only files named in the task.
- Old-data safety: tags parse defensively (`?? []`) — recipes fetched without the join must not crash.
- The Supabase Dart join shape for `recipe_tags(tags(id, name))` is `[{…, "tags": {"id": …, "name": …}}]` (key = table name, no alias — unlike web which aliases to `tag`).

---

### Task 0: branch + baseline

- [ ] `cd ~/HACCP/haccp-mobile && git checkout main && git pull && git checkout -b KNS/recipe-tags`
- [ ] `flutter analyze` + `flutter test` baseline: record current state (pre-existing issues are the baseline, not your problem).
- [ ] No commit — reporting step only.

---

### Task 1: Recipe model — tags instead of category (TDD)

**Files:**
- Create: `test/models/recipe_tags_test.dart`
- Modify: `lib/models/recipe.dart`

- [ ] **Step 1: Write the failing test:**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:haccp_mobile/models/recipe.dart';

Map<String, dynamic> recipeJson({Map<String, dynamic> extra = const {}}) => {
      'id': 'r1',
      'name': 'Test',
      'business_id': 'b1',
      'created_by': 'u1',
      'created_at': '2026-06-11T00:00:00Z',
      ...extra,
    };

void main() {
  test('parses tags from the recipe_tags join, sorted case-insensitively', () {
    final r = Recipe.fromJson(recipeJson(extra: {
      'recipe_tags': [
        {'tags': {'id': 't2', 'name': 'Pasta'}},
        {'tags': {'id': 't1', 'name': 'hits'}},
        {'tags': null}, // dangling join row must not crash
      ],
    }));
    expect(r.tags.map((t) => t.name).toList(), ['hits', 'Pasta']);
    expect(r.tags.first.id, 't1');
  });

  test('missing join key -> empty tags (old query shapes must not crash)', () {
    final r = Recipe.fromJson(recipeJson());
    expect(r.tags, isEmpty);
  });

  test('missing category column must not crash (post-drop forward-compat)', () {
    // recipeJson has no 'category' key on purpose
    expect(() => Recipe.fromJson(recipeJson()), returnsNormally);
  });

  test('toJson does not emit category', () {
    final r = Recipe.fromJson(recipeJson());
    expect(r.toJson().containsKey('category'), isFalse);
  });
}
```

- [ ] **Step 2:** `flutter test test/models/recipe_tags_test.dart` → RED (no `tags` member; `json['category'] as String` throws on the third test).

- [ ] **Step 3: Modify `lib/models/recipe.dart`:**
  - DELETE the whole `RecipeCategory` enum (lines 1–41).
  - Add next to `Ingredient`/`RecipeIngredient` classes:

```dart
class RecipeTag {
  final String id;
  final String name;
  RecipeTag({required this.id, required this.name});

  factory RecipeTag.fromJson(Map<String, dynamic> json) =>
      RecipeTag(id: json['id'] as String, name: json['name'] as String);
}
```

  - In `Recipe`: replace `final RecipeCategory category;` with `final List<RecipeTag> tags;`; constructor: replace `required this.category,` with `this.tags = const [],`.
  - `fromJson`: replace the `category:` line with:

```dart
tags: (((json['recipe_tags'] as List?) ?? [])
        .map((e) => (e as Map<String, dynamic>)['tags'])
        .whereType<Map<String, dynamic>>()
        .map(RecipeTag.fromJson)
        .toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()))),
```

  - `toJson`: delete the `'category': category.name,` line.

- [ ] **Step 4:** `flutter test test/models/recipe_tags_test.dart` → GREEN. `flutter analyze` will now report every `category` consumer — that's the worklist for Tasks 3–9; do NOT fix them here.
- [ ] **Step 5:** Commit:

```bash
git add test/models/recipe_tags_test.dart lib/models/recipe.dart
git commit -m "feat(model): Recipe.tags replaces RecipeCategory enum"
```

---

### Task 2: tag grouping util (TDD) + TagChipsField widget

**Files:**
- Create: `test/utils/tag_grouping_test.dart`
- Create: `lib/utils/tag_grouping.dart`
- Create: `lib/widgets/tag_chips_field.dart`

- [ ] **Step 1: Write the failing test** (`test/utils/tag_grouping_test.dart`):

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:haccp_mobile/models/recipe.dart';
import 'package:haccp_mobile/utils/tag_grouping.dart';

Recipe recipe(String id, String name, List<String> tagNames) => Recipe.fromJson({
      'id': id,
      'name': name,
      'business_id': 'b1',
      'created_by': 'u1',
      'created_at': '2026-06-11T00:00:00Z',
      'recipe_tags': [
        for (final t in tagNames) {'tags': {'id': 'id-$t', 'name': t}},
      ],
    });

void main() {
  final carbonara = recipe('r1', 'Carbonara', ['Pasta', 'hits']);
  final tiramisu = recipe('r2', 'Tiramisu', ['Desserts']);
  final water = recipe('r3', 'Water', []);

  test('duplicate under each tag, Untagged last, sections sorted', () {
    final groups = groupRecipesByTag([carbonara, tiramisu, water]);
    expect(groups.map((g) => g.title).toList(),
        ['Desserts', 'hits', 'Pasta', kUntagged]);
    expect(groups[1].recipes.single.id, 'r1'); // hits
    expect(groups[2].recipes.single.id, 'r1'); // Pasta — duplicated
    expect(groups.last.recipes.single.id, 'r3');
  });

  test('no untagged -> no Untagged section', () {
    expect(groupRecipesByTag([tiramisu]).map((g) => g.title), ['Desserts']);
  });

  test('matchesTagFilter: AND semantics, case-insensitive', () {
    expect(matchesTagFilter(carbonara, ['pasta', 'HITS']), isTrue);
    expect(matchesTagFilter(carbonara, ['pasta', 'desserts']), isFalse);
    expect(matchesTagFilter(water, []), isTrue);
  });
}
```

- [ ] **Step 2:** RED (`tag_grouping.dart` missing).
- [ ] **Step 3: Create `lib/utils/tag_grouping.dart`:**

```dart
import '../models/recipe.dart';

// Grouping semantics (spec 2026-06-11, user-approved): a recipe with several
// tags is duplicated under each of its tag sections; untagged recipes form a
// final section. Filter is AND: recipe must carry every selected tag.
const kUntagged = 'Untagged';

class TagGroup {
  final String title;
  final List<Recipe> recipes;
  TagGroup(this.title, this.recipes);
}

List<TagGroup> groupRecipesByTag(List<Recipe> recipes) {
  final byTag = <String, List<Recipe>>{};
  final untagged = <Recipe>[];
  for (final r in recipes) {
    if (r.tags.isEmpty) {
      untagged.add(r);
      continue;
    }
    for (final t in r.tags) {
      byTag.putIfAbsent(t.name, () => []).add(r);
    }
  }
  int byName(Recipe a, Recipe b) => a.name.compareTo(b.name);
  final groups = byTag.entries
      .map((e) => TagGroup(e.key, e.value..sort(byName)))
      .toList()
    ..sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
  if (untagged.isNotEmpty) groups.add(TagGroup(kUntagged, untagged..sort(byName)));
  return groups;
}

bool matchesTagFilter(Recipe r, List<String> filter) {
  final norms = r.tags.map((t) => t.name.trim().toLowerCase()).toSet();
  return filter.every((f) => norms.contains(f.trim().toLowerCase()));
}
```

- [ ] **Step 4:** GREEN.
- [ ] **Step 5: Create `lib/widgets/tag_chips_field.dart`** (chip editor + autocomplete; mirrors web TagInput):

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/supabase.dart';
import '../config/theme.dart';
import '../providers/auth_provider.dart';

/// All tag names of the current business, for autocomplete.
final businessTagsProvider = FutureProvider<List<String>>((ref) async {
  final profile = await ref.watch(profileProvider.future);
  if (profile == null) return [];
  final response = await SupabaseConfig.client
      .from('tags')
      .select('name')
      .eq('business_id', profile.businessId)
      .order('name');
  return (response as List).map((e) => e['name'] as String).toList();
});

/// Inline tag creation/selection (spec approach A — no management screen).
/// Value is plain names; attaching to the recipe happens in the save handlers.
class TagChipsField extends ConsumerStatefulWidget {
  final List<String> value;
  final ValueChanged<List<String>> onChanged;
  const TagChipsField({super.key, required this.value, required this.onChanged});

  @override
  ConsumerState<TagChipsField> createState() => _TagChipsFieldState();
}

class _TagChipsFieldState extends ConsumerState<TagChipsField> {
  final _ctrl = TextEditingController();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  String _norm(String s) => s.trim().toLowerCase();

  void _add(String raw, List<String> existing) {
    final name = raw.trim();
    if (name.isEmpty || name.length > 40) return;
    if (widget.value.any((v) => _norm(v) == _norm(name))) {
      _ctrl.clear();
      return;
    }
    final canonical = existing.firstWhere(
      (e) => _norm(e) == _norm(name),
      orElse: () => name,
    );
    widget.onChanged([...widget.value, canonical]);
    _ctrl.clear();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final existing = ref.watch(businessTagsProvider).value ?? [];
    final chosen = widget.value.map(_norm).toSet();
    final draft = _norm(_ctrl.text);
    final suggestions = existing
        .where((e) => !chosen.contains(_norm(e)) &&
            (draft.isEmpty || _norm(e).startsWith(draft)))
        .take(8)
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final t in widget.value)
              Chip(
                label: Text(t, style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600)),
                onDeleted: () =>
                    widget.onChanged(widget.value.where((v) => v != t).toList()),
                backgroundColor: AppColors.primary.withValues(alpha: 0.08),
                side: BorderSide(color: AppColors.primary.withValues(alpha: 0.2)),
              ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _ctrl,
          decoration: const InputDecoration(
            labelText: 'Add tag',
            hintText: 'e.g. Pasta, Specials',
            border: OutlineInputBorder(),
          ),
          onChanged: (_) => setState(() {}),
          onSubmitted: (v) => _add(v, existing),
        ),
        if (suggestions.isNotEmpty && _ctrl.text.trim().isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in suggestions)
                ActionChip(
                  label: Text(s, style: GoogleFonts.inter(fontSize: 13)),
                  onPressed: () => _add(s, existing),
                ),
            ],
          ),
        ],
      ],
    );
  }
}
```

- [ ] **Step 6:** `flutter analyze` (no new issues beyond the known Task-1 `category` consumers), `flutter test` green.
- [ ] **Step 7:** Commit:

```bash
git add test/utils/tag_grouping_test.dart lib/utils/tag_grouping.dart lib/widgets/tag_chips_field.dart
git commit -m "feat(mobile): tag grouping util + TagChipsField widget"
```

---

### Task 3: recipes screen — flat list, tag filter, group toggle

**Files:**
- Modify: `lib/screens/recipes/recipes_screen.dart`

- [ ] **Step 1:** `recipesProvider` select gains the join: `'*, recipe_ingredients(*, ingredients(*)), recipe_tags(tags(id, name))'`.
- [ ] **Step 2:** Delete the `_catIcon` map (lines 36–44). Add imports: `import '../../utils/tag_grouping.dart';`. Remove the now-unused `RecipeCategory` references.
- [ ] **Step 3:** Convert `RecipesScreen` to `ConsumerStatefulWidget` with state:

```dart
final List<String> _tagFilter = [];
bool _groupByTag = false;
```

- [ ] **Step 4:** In the `data:` builder replace the category grouping (lines 97–101) and section rendering with:

```dart
final activeRecipes = recipes.where((r) => r.active).toList();
final inactiveRecipes = recipes.where((r) => !r.active).toList();

final allTagNames = activeRecipes
    .expand((r) => r.tags.map((t) => t.name))
    .toSet()
    .toList()
  ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));

final visible = activeRecipes
    .where((r) => matchesTagFilter(r, _tagFilter))
    .toList()
  ..sort((a, b) => a.name.compareTo(b.name));
```

Header widget above the list (only when `allTagNames.isNotEmpty`): a `Wrap` of `FilterChip`s toggling membership in `_tagFilter` (selected style: `AppColors.primary` tints, like the existing chips idiom) plus one `FilterChip(label: Text('Group by tags'), selected: _groupByTag, onSelected: …)` at the end.

List body:
- `_groupByTag == false`: flat `…visible.map((recipe) => _DishCard(recipe: recipe))`.
- `_groupByTag == true`: `groupRecipesByTag(visible)` rendered as sections reusing the existing section-header layout (rows 144–161) with `Icons.sell_rounded` instead of `_catIcon[cat]` and `group.title` / `group.recipes.length` instead of `cat.displayName` / `items.length`.
- Inactive section: unchanged, stays last (outside grouping).

- [ ] **Step 5:** In `_DishCard`, add a tag-chips row so tags are visible without grouping — inside the existing `Wrap` (line 358), prepend:

```dart
...recipe.tags.map((t) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
  decoration: BoxDecoration(
    color: AppColors.primary.withValues(alpha: 0.06),
    borderRadius: BorderRadius.circular(10),
    border: Border.all(color: AppColors.primary.withValues(alpha: 0.15)),
  ),
  child: Text(t.name, style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.primary)),
)),
```

(and the `none` check on line 306 adds `&& recipe.tags.isEmpty`).

- [ ] **Step 6:** `flutter analyze` — recipes_screen clean; `flutter test` green. Visual check on simulator/device: filter AND-behaviour, grouping duplicates a multi-tag dish, Untagged last.
- [ ] **Step 7:** Commit:

```bash
git add lib/screens/recipes/recipes_screen.dart
git commit -m "feat(mobile): recipes screen — flat list, tag filter, group-by-tags"
```

---

### Task 4: recipe new — tag chips + attach on save

**Files:**
- Modify: `lib/screens/recipes/recipe_new_screen.dart`

- [ ] **Step 1:** Replace `RecipeCategory _category = RecipeCategory.main;` (line 42) with `List<String> _tags = [];`. Add `import '../../widgets/tag_chips_field.dart';`.
- [ ] **Step 2:** Replace the category `DropdownButtonFormField` (line 172) with:

```dart
TagChipsField(value: _tags, onChanged: (t) => setState(() => _tags = t)),
```

- [ ] **Step 3:** In `_save()`: delete `'category': _category.name,` from the insert map (DB default applies). After `final recipeId = recipeResult['id'] as String;` add:

```dart
for (final t in _tags) {
  await db.rpc('attach_tag', params: {'p_recipe_id': recipeId, 'p_name': t});
}
```

At the end, also `ref.invalidate(businessTagsProvider);` next to `ref.invalidate(recipesProvider);`.
- [ ] **Step 4:** `flutter analyze` clean for this file; `flutter test` green. Device check: create recipe with one new + one existing tag.
- [ ] **Step 5:** Commit:

```bash
git add lib/screens/recipes/recipe_new_screen.dart
git commit -m "feat(mobile): recipe create uses tag chips"
```

---

### Task 5: recipe edit — load, diff, attach/detach

**Files:**
- Modify: `lib/screens/recipes/recipe_edit_screen.dart`

- [ ] **Step 1:** State: replace the `_category` field with:

```dart
List<String> _tags = [];
List<RecipeTag> _originalTags = [];
```

Add `import '../../widgets/tag_chips_field.dart';`.
- [ ] **Step 2:** `_loadRecipe()`: select gains `, recipe_tags(tags(id, name))`; replace `_category = recipe.category;` (line 126) with:

```dart
_originalTags = recipe.tags;
_tags = recipe.tags.map((t) => t.name).toList();
```

- [ ] **Step 3:** Form: replace the category dropdown (lines 285–291 region) with `TagChipsField(value: _tags, onChanged: (t) => setState(() => _tags = t)),`.
- [ ] **Step 4:** `_save()`: delete `'category': _category.name,` from the update map (line 175). After the recipe update block add:

```dart
// Tags diff: detach removed (orphans self-delete in the DB), attach current
// (attach_tag is an idempotent normalised find-or-create)
final currentNorms = _tags.map((t) => t.trim().toLowerCase()).toSet();
final removedIds = _originalTags
    .where((t) => !currentNorms.contains(t.name.trim().toLowerCase()))
    .map((t) => t.id)
    .toList();
if (removedIds.isNotEmpty) {
  await db
      .from('recipe_tags')
      .delete()
      .eq('recipe_id', widget.recipeId)
      .inFilter('tag_id', removedIds);
}
for (final t in _tags) {
  await db.rpc('attach_tag', params: {'p_recipe_id': widget.recipeId, 'p_name': t});
}
```

Invalidate `businessTagsProvider` alongside the existing invalidations.
- [ ] **Step 5:** `flutter analyze` clean for this file; `flutter test` green. Device check: backfilled recipe shows its category-derived tag; remove/add/save round-trip persists.
- [ ] **Step 6:** Commit:

```bash
git add lib/screens/recipes/recipe_edit_screen.dart
git commit -m "feat(mobile): recipe edit manages tags (diff attach/detach)"
```

---

### Task 6: recipe detail — tag pills

**Files:**
- Modify: `lib/screens/recipes/recipe_detail_screen.dart`

- [ ] **Step 1:** Its `_loadRecipe()` select gains `, recipe_tags(tags(id, name))`. Delete the local `_catIcon` map (lines 45–53).
- [ ] **Step 2:** Hero card (line 145): replace `_pill(recipe.category.displayName, AppColors.primary, Icons.restaurant_rounded),` with:

```dart
...recipe.tags.map((t) => _pill(t.name, AppColors.primary, Icons.sell_rounded)),
```

- [ ] **Step 3:** `flutter analyze` clean for this file; `flutter test` green.
- [ ] **Step 4:** Commit:

```bash
git add lib/screens/recipes/recipe_detail_screen.dart
git commit -m "feat(mobile): recipe detail shows tag pills"
```

---

### Task 7: allergen matrix — flat

**Files:**
- Modify: `lib/screens/menu/allergen_matrix_screen.dart`

- [ ] **Step 1:** Delete the `_catIcon` map (lines 45–53) and the `_group` method (lines 80–84).
- [ ] **Step 2:** `_buildCards`: drop grouping — one section-less `ListView.builder` over `recipes` (already name-ordered by the provider), `itemBuilder: (context, i) => _dishCard(recipes[i])`; `_sectionHeader` deleted (or kept only if the matrix view uses it — it does not, per inventory). Matrix view (`_buildMatrix`) is already flat — unchanged.
- [ ] **Step 3:** `flutter analyze` clean for this file; `flutter test` green.
- [ ] **Step 4:** Commit:

```bash
git add lib/screens/menu/allergen_matrix_screen.dart
git commit -m "feat(mobile): allergen cards view flat — category sections removed"
```

---

### Task 8: menu export — tags in PDF/CSV

**Files:**
- Modify: `lib/utils/menu_export.dart`
- Modify: the export-sheet caller in `lib/screens/menu/allergen_matrix_screen.dart` (`_showExportSheet`)

- [ ] **Step 1:** `generateMenuPdf`: add param `bool groupByTags = false`. Replace the `RecipeCategory` grouping + `categoryOrder` (lines 16–36) with:

```dart
final sections = groupByTags
    ? groupRecipesByTag(recipes)
    : [TagGroup('', [...recipes]..sort((a, b) => a.name.compareTo(b.name)))];
```

(`import 'tag_grouping.dart';`). In the page build loop iterate `sections`; emit the heading only when `section.title.isNotEmpty` (`'${section.title} (${section.recipes.length})'`); add a `Tags` column to the table after `Dish`:

```dart
final row = [r.name, r.tags.map((t) => t.name).join(', '), r.dietaryLabels.join(', ')];
```

with headers `['Dish', 'Tags', 'Dietary', if (includeAllergens) 'Allergens']` (keep the allergens cell logic).
- [ ] **Step 2:** `generateMenuCsv`: same `groupByTags` param; header `Category` → `Tags`; replace the category-ordered loop (lines 139–158) with a flat name-sorted loop (or grouped when `groupByTags`, prefixing rows with the section title), cell = `r.tags.map((t) => t.name).join('; ')`.
- [ ] **Step 3:** `_showExportSheet`: add a "Group by tags" switch beside the existing include-allergens toggle, passed through to both generators (default off).
- [ ] **Step 4:** `flutter analyze` clean; `flutter test` green. Device check: export PDF both modes — grouped output duplicates multi-tag dishes per section, Untagged last.
- [ ] **Step 5:** Commit:

```bash
git add lib/utils/menu_export.dart lib/screens/menu/allergen_matrix_screen.dart
git commit -m "feat(mobile): menu export — tags column + optional group-by-tags"
```

---

### Task 9: AI import — tags

**Files:**
- Modify: `lib/screens/ai_import/ai_import_screen.dart`

- [ ] **Step 1:** RPC payload (line 246–257): delete `'category': r['category'] ?? 'other',` and add a sibling of `'ingredients'`:

```dart
'tags': (r['tags'] as List<dynamic>?)?.cast<String>() ??
    // legacy edge-function responses: capitalise+s reproduces the backfill
    // labels (starter->Starters … beverage->Beverages)
    ((r['category'] is String && r['category'] != 'other')
        ? ['${(r['category'] as String)[0].toUpperCase()}${(r['category'] as String).substring(1)}s']
        : <String>[]),
```

- [ ] **Step 2:** `_PreviewCard` (lines 747–790): replace the single category pill with a tags `Wrap` using the same pill styling:

```dart
final tags = (data['tags'] as List<dynamic>?)?.cast<String>() ??
    (data['category'] is String && data['category'] != 'other'
        ? ['${(data['category'] as String)[0].toUpperCase()}${(data['category'] as String).substring(1)}s']
        : <String>[]);
```

and render `if (tags.isNotEmpty) Wrap(spacing: 6, runSpacing: 6, children: [for (final t in tags) Container(/* the existing pill Container with Text(t) */)])` in place of the category Container.
- [ ] **Step 3:** `flutter analyze` clean for this file; `flutter test` green. Device check: AI import end-to-end → recipe lands with tag(s).
- [ ] **Step 4:** Commit:

```bash
git add lib/screens/ai_import/ai_import_screen.dart
git commit -m "feat(mobile): AI import produces tags (legacy category mapped)"
```

---

### Task 10: sweep, version bump, release build

**Files:**
- Modify: `pubspec.yaml` (version)

- [ ] **Step 1: Zero category references:**

```bash
grep -rn "RecipeCategory\|\.category\b\|'category'" lib/ test/
```

Expected hits: ONLY the ai_import legacy-response mapping (`r['category']` / `data['category']` — reads the edge-function response, not the DB column). Anything else → fix.
- [ ] **Step 2:** `flutter analyze` — zero NEW issues vs the Task-0 baseline. `flutter test` — all green.
- [ ] **Step 3:** Bump `version: 1.4.0+21` → `version: 1.5.0+22`.
- [ ] **Step 4:** `flutter build appbundle --release` — builds clean (store upload is NOT part of this plan; Konstantin releases manually).
- [ ] **Step 5: Old-build compat check (spec DoD):** with this branch's DB already live since Phase 1, verify on a device/simulator running the SHIPPED build (or `git stash && flutter run` from main) that Recipes/Menu still render — including a recipe created tag-only from web (its `category` is `'other'` via the default).
- [ ] **Step 6:** Commit:

```bash
git add pubspec.yaml
git commit -m "chore(mobile): v1.5.0+22 — recipe tags release"
```

---

## Self-review (done at plan time)

- **Spec coverage (mobile scope):** model `List<String> tags` → implemented as `List<RecipeTag>` ({id,name}) because edit-screen detach needs tag ids — strictly richer than the spec line, same semantics; enum + `_catIcon` removal → Tasks 1, 3, 6, 7; flat list + filter + grouping → Task 3; editors → Tasks 4–5; detail → 6; matrix flat → 7; exports → 8; AI import → 9; release → 10. No offline-cache work (spec "New facts" #2).
- **Placeholders:** Task 3 Steps 4–5 and Task 8–9 reference existing widgets/styling by line with explicit replacement code for the logic; full code given for everything new. No TBDs.
- **Type consistency:** `RecipeTag`, `Recipe.tags`, `groupRecipesByTag`/`TagGroup`/`kUntagged`/`matchesTagFilter`, `TagChipsField(value:, onChanged:)`, `businessTagsProvider` — defined in Tasks 1–2, used with those exact names in 3–9. `attach_tag` params `{p_recipe_id, p_name}` match the Phase-1 SQL. Join key `'tags'` (Dart, no alias) vs `'tag'` (web alias) handled per platform.
- **Old-data safety:** tags parse with `?? []` + `whereType` (Task 1 tests cover missing key, null tag, missing category).
- **Supabase Dart API note:** `inFilter` is the supabase_flutter v2 name for `.in_()` — verify against the installed version in Task 5; if the project's client exposes `filter('tag_id', 'in', …)` instead, use that.
