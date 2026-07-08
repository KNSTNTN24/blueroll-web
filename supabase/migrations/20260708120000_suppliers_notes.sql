-- Suppliers redesign: free-text notes (e.g. "min order £150") shown in the row subline.
alter table public.suppliers add column if not exists notes text;
