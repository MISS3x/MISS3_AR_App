# MISS3 AR App — Session Log (2026-03-09)

---

## 1. User: "zkontroluj build"
**→** Zkontroloval EAS build status — build finished ✅, link na instalaci na Expo.dev

## 2. User: "nemuzem to udelat prez odkaz?"
**→** Vysvětlil jak sdílet app přes EAS Internal Distribution — QR kód / odkaz z expo.dev

## 3. User: "pust dev server v terminalu"
**→** Spustil `npx expo start` v `p:\Antigravity\MISS3_AR_App`

## 4. User: "failed to load model"
**→** Analyzoval DevTools errory:
- `ReferenceError: Property 'supabase' doesn't exist` — chyběl import v `ModelDetailScreen.tsx`
- `StorageApiError: Object not found` — **Root cause:** RLS policy na `models_secure` bucket povolovala čtení jen pro `authenticated`, mobilní app je `anon`
**→** Opravil: přidal import supabase, přidal SQL policy pro anon read na models_secure storage
**→** User spustil SQL v Supabase SQL Editoru

## 5. User: "epic I can see 3d model but only in 3d, not in AR"
**→** model-viewer AR button v WebView nefunguje — WebView nemůže spustit iOS Quick Look
**→** Pokus 1: Přidal nativní floating button s `Linking.openURL(modelUrl)` → **FAIL** — Safari stahuje GLB místo Quick Look

## 6. User: "tlacitko tam je ale chce to nekam ulozit"
**→** Safari zobrazil download dialog místo AR. GLB soubory nejsou automaticky otevřeny v Quick Look
**→** Pokus 2: Hostovaná HTML stránka na Supabase Storage s model-viewer AR
**→** User řekl: "ne zadny vercel" a "to nechceme, chceme to do pameti"

## 7. User: "ma to byt nativni app"
**→** Pokus 3: `expo-file-system` download do cache + `expo-sharing` → Quick Look
**→** Potřeboval nový EAS build kvůli nativním modulům
**→** Build spuštěn, user šel domů

## 8. User: "what now? app was installed, MISS3 AR is grey"
**→** App potřebovala dev server. Spustil `npx expo start --tunnel`
**→** `@expo/ngrok` nešel nainstalovat globálně — opraveno lokální instalací: `npm install @expo/ngrok@4.1.0`
**→** Tunnel funguje ✅, QR kód v terminálu

## 9. User: "no usable data found" (QR scan)
**→** Expo QR kód nelze skenovat normální kamerou. Nutno otevřít MISS3 AR app přímo nebo poslat si URL

## 10. User: (screenshot — expo-file-system deprecated error)
**→** `downloadAsync` je deprecated v SDK 55
**→** Opravil: `import * as FileSystem from 'expo-file-system/legacy'`

## 11. User: "no error but it is asking me what to do" (share sheet)
**→** `expo-sharing` otevírá iOS share sheet — ne Quick Look přímo
**→** GLB soubory v share sheetu nespustí Quick Look (potřeba USDZ formát)
**→** **FAIL** — Quick Look vyžaduje USDZ, ne GLB

## 12. User: "nepotrebujeme jejich Quick look ktery je omezeny"
**→** User chce plný ARKit, ne Quick Look. Vysvětlil rozdíly (tabulka Quick Look vs ARKit)
**→** Dohodli se: Quick Look jako dočasné řešení dnes, ARKit zítra

## 13. User: "umime convertovat GLB→USDZ?"
**→** Ano, 3 možnosti: Three.js USDZExporter, model-viewer auto-konverze, Apple Reality Converter
**→** Pokus 4: Hosting ar-viewer.html na Supabase Storage → `expo-web-browser` in-app browser
**→** **FAIL** — Supabase Storage zobrazil raw HTML (Content-Type problém)

## 14. User: "zase ten plain kod"
**→** Pokus 5: WebView s `baseUrl: 'https://miss3.app'` — model-viewer si myslí že je na HTTPS
**→** **FAIL** — model-viewer stále nedetekuje AR support, skryl AR button

## 15. User: "no AR"
**→** **Závěr:** AR přes WebView na iOS prostě nefunguje. 5 pokusů, žádný úspěch
**→** Vyčistil ARViewerScreen na čistý 3D viewer bez AR pokusů
**→** User souhlasil: ARKit zítra

## 16. User: "urcite vycisti apku od nepotrebneho kodu"
**→** Smazán `ar-viewer.html`
**→** Odebrány z package.json: `expo-file-system`, `expo-sharing`, `expo-web-browser`, `expo-linking`
**→** `@expo/ngrok` přesunut do devDependencies
**→** 15 dependencies (z 20), žádné unused importy v kódu

## 17. User: "saving of preview from viewport still dont work"
**→** User si uvědomil že to je jiný projekt (MISS3 AR Tool web editor)
**→** Zalogováno jako TODO na příští session

---

## Stav na konci session

### ✅ Funguje
- Company Select → Model List → Model Detail → **3D Viewer** (rotate/zoom/pan)
- Supabase signed URLs + anon storage RLS
- Tunnel mode (`npx expo start --tunnel`) pro remote testing
- Vyčištěný codebase

### ❌ Nefunguje
- AR placement (vyžaduje ARKit modul — Phase 2)

### TODO příkazy (spustit na PC)
```powershell
cd p:\Antigravity\MISS3_AR_App
rm assets/ar-viewer.html
npm install
git add . && git commit -m "chore: cleanup unused AR deps" && git push
```

### TODO příští session
- ARKit modul (8 úkolů v task.md)
- Web editor save/capture bug (MISS3 AR Tool — jiný projekt)
