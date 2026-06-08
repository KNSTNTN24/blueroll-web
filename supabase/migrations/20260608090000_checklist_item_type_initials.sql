-- Add 'initials' to the allowed checklist item types.
--
-- Phase 2 (web + mobile + ai-generate-checklist) shipped an 'initials' item
-- type, but the checklist_template_items_item_type_check constraint was never
-- widened. Saving any template containing an initials item therefore failed
-- with "new row ... violates check constraint
-- checklist_template_items_item_type_check" — surfaced in prod as the save
-- button hanging on the checklist editor.
--
-- Widening a CHECK to allow an extra value is safe: every existing row is in
-- the previous (smaller) set, so the constraint re-validates instantly.

alter table public.checklist_template_items
  drop constraint checklist_template_items_item_type_check,
  add constraint checklist_template_items_item_type_check
    check (item_type = any (array['tick','temperature','text','yes_no','photo','initials']));
