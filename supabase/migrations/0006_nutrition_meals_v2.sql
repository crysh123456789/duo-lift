-- Nutrition 2.0 v1 keeps food_days.meals as jsonb.
-- Legacy slot: a string note ("avena y huevos").
-- v2 slot: {"time":"HH:mm"|null,"items":[{"id","name","grams","proteinG","carbsG","fatG"}],"note":""}.
-- The app soft-migrates strings into note on read (Zustand persist v8 and sync canonicalize).
-- Rows are not rewritten here. A bulk rewrite would make the previous client
-- call .trim() on an object if this migration landed before that client deploy.
-- sync_apply already stores meals as jsonb, so v2 objects upsert without a new column.

comment on column public.food_days.meals is
  'Meal slots. Legacy: string note per slot. v2: {time, items[{id,name,grams,proteinG,carbsG,fatG}], note}. Clients soft-migrate strings to notes; kcal is 4P+4C+9G and is not stored.';
