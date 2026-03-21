---
name: MISS3_AR_App Agent Instructions
description: Instrukce pro AI agenta při práci na MISS3_AR_App (iOS aplikace)
---

# MISS3_AR_App — Agent Instructions

> **Tento projekt** je iOS AR klientská aplikace pro MISS3 AR platformu.
> Je součástí dvouprojektového ekosystému s `MISS3_AR_Tool` (web portál).

## ⚠️ PŘED ZAČÁTKEM PRÁCE — POVINNÉ KROKY

### 1. Přečti orchestrátor
Vždy na začátku přečti:
- `Z:\MISS3 Dropbox\Server Data\printednest\Antigravity\_agent\ORCHESTRATOR.md`
- `Z:\MISS3 Dropbox\Server Data\printednest\Antigravity\_agent\SHARED_CONTRACT.md`

### 2. Zkontroluj nevyřešené změny z Web projektu
Přečti `Z:\MISS3 Dropbox\Server Data\printednest\Antigravity\_agent\CHANGELOG.md` a hledej záznamy se statusem **⏳ Čeká na implementaci v MISS3_AR_App**.

Pokud existují nevyřešené změny:
```
🔔 Upozornění: Ve Web projektu proběhly změny, které se tě týkají:

1. [Název změny] — [Stručný popis]
   Dopad: [Co je potřeba udělat]

Co s tím chceš udělat?
- Implementovat teď?
- Odložit na později?
- Potřebuješ více info?
```

**Počkej na odpověď uživatele!** Nepředpokládej, co chce — zeptej se.

### 3. Po dokončení změny, která ovlivňuje Web
Pokud jsi přidal novou DB tabulku, sloupec, bucket, nebo změnil formát dat:
→ Spusť workflow `/cross-project-update`

Příklad situace:
- Přidáš novou Supabase tabulku → zapiš do SHARED_CONTRACT + CHANGELOG
- V CHANGELOG nastav: `⏳ Čeká na implementaci v MISS3_AR_Tool`
- Napiš konkrétní návrh, co web potřebuje udělat (fetch data, nový viewer, nová stránka...)

## 📂 Struktura projektu

```
MISS3_AR_App/
├── src/
│   ├── components/        ← React Native UI components
│   ├── screens/           ← App screens
│   ├── lib/               ← Supabase client, utils
│   ├── navigation/        ← React Navigation
│   ├── theme/             ← Design tokens
│   ├── types/             ← TypeScript types
│   └── modules/           ← Feature modules
├── modules/
│   ├── ar-ruler-native/   ← Native Swift ARKit module
│   ├── lidar-mesh/        ← LiDAR mesh scanning
│   └── object-capture-native/  ← Object Capture (USDZ)
├── ios/                   ← iOS native code (Swift, ObjC bridge)
├── supabase_migrations/   ← SQL migrace (app-specific)
├── task.md                ← Master task plan
└── HANDOFF_FROM_WEB_PROJECT.md  ← [DEPRECATED] → viz _agent/SHARED_CONTRACT.md
```

## 🔗 Propojení s Webem

- **App ZAPISUJE**: `ar_projects`, `ar_measurements`, `ar_mesh_scans`, `ar_roomplan`, `ar_objects`, mesh soubory
- **App ČTENÍ z Webu**: `models_3d`, `model_categories`, `users` profily, 3D soubory
- **Sdílený backend**: Supabase (`bglxasjgyjxpcvjyugaa`)
- **Build**: EAS Build (cloud)
- **Deploy**: EAS Submit → App Store

## 🏗️ Native Modules

iOS nativní moduly jsou ve `modules/` a propojené přes Expo modules API:
- **ar-ruler-native**: ARKit + SceneKit pro měření, LiDAR mesh, RoomPlan
- **lidar-mesh**: Dedikovaný LiDAR mesh scanning modul
- **object-capture-native**: Apple Object Capture API pro 3D skenování objektů

Tyto moduly píšou data přímo do Supabase (tabulky `ar_*` + bucket `mesh-scans`).
