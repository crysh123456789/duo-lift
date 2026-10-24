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

## Cuentas

Supabase Auth (correo y contraseña) es la identidad. Cada cuenta ve solo sus entrenos y su diario. No hay clave compartida ni chips para cambiar de persona. El inicio de sesión entra directo a la app. La app no muestra una pantalla para traer un historial legado.

`claim_legacy_history` se elimina en `0013` (esquemas `public` y `private`, todas las sobrecargas). `private.legacy_claims` se vacía y se le revocan los privilegios; la tabla sigue porque `decline_legacy_history` y `legacy_history_status` todavía la leen. Este cliente no llama a `claim_legacy_history`. Si no hay decisión y no queda nada abierto, llama a `decline_legacy_history` y deja `clean`. Una decisión ya guardada sigue reetiquetando esas filas en el teléfono. La cuenta `user-amigo` la borra operaciones; esta app no tira esa fila.

En Authentication → Providers → Email, desactiva **Confirm email** para que Crear cuenta abra la sesión. Si queda activo, la app pide revisar el correo. Ese interruptor es un paso de operaciones aparte del enlace de recuperación.

`/forgot` pide el enlace y `/reset` guarda la contraseña nueva. El `redirectTo` está fijado a `https://duo-lift-gamma.vercel.app/reset` (nunca localhost). En Authentication → URL Configuration, Site URL tiene que ser `https://duo-lift-gamma.vercel.app` y Redirect URLs tiene que permitir `https://duo-lift-gamma.vercel.app/reset`. El texto de éxito es el mismo si ese correo no tiene cuenta.

## Supabase sync

The gym log stays in Zustand (`duo-lift-v2`) and, when sync is enabled, also upserts into the Duo Lift Supabase project (`https://xivctpewomnpzcgbvczv.supabase.co`, region `sa-east-1`).

Copy `.env.example` to `.env.local`. On Vercel set:

| Variable | Where |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xivctpewomnpzcgbvczv.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable / legacy anon key. Public by design. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is accepted if the anon key is empty. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Not used by `/api/sync`. Never prefix it with `NEXT_PUBLIC_`. |
| `DUO_LIFT_SYNC_ENABLED` | `true` on production (`duo-lift-gamma.vercel.app`) uploads this account's rows after login. A failed round keeps the phone history and shows the error pill. |

`DUO_LIFT_PASSWORD` is not read by the app, the tests, or CI. Delete it from Vercel Production and Preview and redeploy. Nothing validates `duo_session`. `POST /api/session` still returns 410 for the old shared password and does not consult that variable. The mention in `supabase/migrations/0007_auth_per_person.sql` is a historical comment and stays.

Apply migrations `0001` through `0007_auth_per_person.sql` together with this app. `0007` replaces `sync_apply` so it runs as the signed-in user and revokes `service_role`. It is already applied on the live project, so the previous gamma `/api/sync` fails until this release is deployed. Phone data stays on the device. A fresh database still runs `0001`–`0007` as one file. RLS is `(select auth.uid())::text` on the caller's rows. `user_metadata` is only a profile seed at signup, never a policy. `duos`, `duo_members`, `duo_reminders`, and `sync_tombstones` keep RLS on with no policies and no grants to `anon` or `authenticated`.

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
