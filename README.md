# AIMviewer

Asset Information Model platforma — **AIM Viewer** (prvý use case, D-003).
Viewer správne previazaných dát o stavbe počas životného cyklu.

Stack (D-026): **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**,
dáta **výhradne server-side** cez Supabase `service_role` (RLS odložené, D-025),
hosting **Vercel** (D-006). Konvencie: [`AGENTS.md`](AGENTS.md),
rozhodnutia: [`DECISIONS.md`](DECISIONS.md), plán: [`ROADMAP.md`](ROADMAP.md).

## Štruktúra repa

```
.                      ← Next.js app v roote
├── app/               ← App Router (page.tsx = Server Component, test-fetch)
├── components/ui/     ← shadcn/ui komponenty
├── lib/supabase/      ← server-only Supabase klient (service_role)
└── supabase/          ← DB migrácie + seed (Supabase Cloud)
```

## Lokálny vývoj

1. **Env:** skopíruj `.env.example` → `.env.local` a doplň hodnoty zo
   Supabase → *Project Settings → API*:
   - `SUPABASE_URL` = `https://acwoupricatirhlfkhvk.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role kľúč (tajný)

   > `.env.local` je gitignored — **nikdy** ho necommituj. `service_role`
   > kľúč sa číta len server-side a nikdy sa nedostane do prehliadača.

2. **Inštalácia + beh:**
   ```bash
   npm install
   npm run dev
   ```
   Otvor http://localhost:3000 — stránka ukáže „Supabase connected ✅" a
   `select count(*) from objects` (seed = **13**).

## Deploy na Vercel

1. **Import repa:** [vercel.com/new](https://vercel.com/new) → *Add New… → Project*
   → vyber GitHub repo `AssetinSpace/AIMviewer`. Vercel autodetekuje Next.js
   (root, build `next build`) — nič netreba meniť.
2. **Environment Variables** (pred prvým deployom, *Settings → Environment
   Variables* alebo v import obrazovke):
   - `SUPABASE_URL` = `https://acwoupricatirhlfkhvk.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role kľúč
   - Scope: Production + Preview + Development. Kľúč je **secret** (nie je
     `NEXT_PUBLIC_*`, takže sa nedostane do client bundle).
3. **Deploy** → appka beží na `*.vercel.app`. Push do `main` = auto-deploy.

Vlastná doména sa rieši až keď je demo verejné (po S3, D-026).
