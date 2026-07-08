---
name: verify
description: Ako overiť zmeny AIM Viewera naživo v tomto repe — build/launch/drive recept (Playwright + devtest harness bez Supabase). Použi pri verifikácii frontend zmien pred commitom.
---

# Verify — AIM Viewer

## Kontext prostredia
- Remote sessions **nemajú Supabase creds** (`.env.local` chýba) → reálne routes (`/drawing/[id]`,
  `/node/[id]`…) padnú na DB fetchi. Layouty pod `app/(viewer)/` ťahajú dáta z DB.
- Komponentové zmeny sa preto overujú cez **dočasnú stránku MIMO `(viewer)` groupu**
  (root layout je bez DB) — napr. `app/devtest/page.tsx` (`"use client"`), ktorá renderuje
  testovaný komponent s lokálnymi props. **Pred commitom ju zmaž.**
- Chromium: `/opt/pw-browsers/chromium`; playwright modul nainštaluj do scratchpadu
  (`npm i playwright`), NIE do repa. Nespúšťaj `playwright install`.

## Recept (PDF prehliadačka / drawing-*)
1. Testovacie viacstranové PDF sa dá vygenerovať čistým Pythonom (raw PDF syntax,
   `zlib` streamy, base-14 Helvetica — bez závislostí) do `public/devtest-drawing.pdf`;
   text na známych súradniciach → `DrawingRegion.bbox` presne sedí na overlay.
2. `app/devtest/page.tsx`: `DrawingWorkspace` s `pdfUrl="/devtest-drawing.pdf"`,
   ručnými `links` a fake `DocumentPanelData`. Vonkajší wrapper **`w-full`, NIE `mx-auto`**
   (auto marginy vo flex-col body zrušia stretch → stĺpec shrink-wrapne na obsah
   a fitWidth „dýcha" s contentom — falošné merania).
3. `npx next dev -p 3210` na pozadí; drive Playwrightom:
   - mobil: `{ viewport: 390x844, hasTouch: true, isMobile: true }`, `locator.tap()`,
     pinch cez CDP `Input.dispatchTouchEvent` (dva touchpointy, postupný rozstup);
   - desktop: `mouse.wheel` burst (kurzor NAJPRV `mouse.move` nad canvas!), klik, pan.
4. `/api/element/[id]` vráti 400 (bez DB) → panel ukáže „Detail sa nepodarilo načítať" —
   očakávané, layout panelov sa dá overiť aj tak.

## Na čo si dať pozor (poučenia z D-054)
- **Click cez pointer capture:** `setPointerCapture` v pointerdown presmeruje click na
  scroller a `<a>` regióny prestanú klikať myšou. Capture až po prekročení pan thresholdu.
- **Zoom kotva:** raster (`dims`) za `width` zaostáva o async render — scroll restore
  aplikovať až keď `dims.width ≈ width`, inak sa `scrollLeft` clampne na starý rozsah.
- Esc v headless Chromium **neukončí** fullscreen (browser UI) — testuj cez toggle tlačidlo.
- Wrapper transformu je `canvas.closest(".relative")`, nie `canvas.parentElement`.
