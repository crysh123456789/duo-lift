This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Supabase sync

The gym log stays in Zustand (`duo-lift-v2`) and, when sync is enabled, also upserts into the Duo Lift Supabase project (`https://xivctpewomnpzcgbvczv.supabase.co`, region `sa-east-1`).

Copy `.env.example` to `.env.local`. On Vercel set:

| Variable | Where |
| --- | --- |
| `DUO_LIFT_PASSWORD` | Server. Shared duo password. Required before sync can turn on. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xivctpewomnpzcgbvczv.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy anon JWT. Public by design. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is accepted if the anon key is empty. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Bypasses RLS. Never prefix it with `NEXT_PUBLIC_`. |
| `DUO_LIFT_SYNC_ENABLED` | `true` on production (`duo-lift-gamma.vercel.app`) uploads this browser's localStorage after the duo cookie is valid. A failed round keeps the phone history and shows the error pill. `false` leaves the pill on Local. |

Apply `supabase/migrations/0001_init.sql` through `0006_nutrition_meals_v2.sql` before enabling the flag. On project `xivctpewomnpzcgbvczv` migrations through `0005` are applied; `0006` only comments `food_days.meals` and does not rewrite rows. Anon and authenticated have no table grants. `SUPABASE_SERVICE_ROLE_KEY` stays on the server; the browser only talks to `/api/sync`.

The diary stores five slots in that jsonb column. Older days keep a string per slot; the app reads it as the meal note. New days store `{ time, items, note }` (protein, carbs, fat, grams). Kilocalories are derived (`4P + 4C + 9G`) and are not a column. The same payload syncs through `/api/sync` when `DUO_LIFT_SYNC_ENABLED` is on.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
