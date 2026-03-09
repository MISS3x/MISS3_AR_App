# MISS3 iOS App — Handoff z Web Projektu

## 🎯 Vize a Kontext

Tento iOS projekt **navazuje na existující webovou platformu MISS3 AR Tools**.

### Jak to funguje dohromady:
1. **Web portál** (`miss3-ar-tools.vercel.app`) = **Designer Portal** kde firmy mají účet, nahrávají 3D modely svých produktů (nábytek, stoly, židle, kuchyně...), spravují kategorie, nastavují AR parametry, generují QR kódy
2. **Supabase** = sdílená databáze (PostgreSQL + Storage) kde jsou všechny modely, uživatelé, metadata
3. **Tato iOS app** = **klientská mobilní aplikace** napojená na stejnou DB, která čte sortiment konkrétní firmy a umožňuje je prohlížet v AR

### Business model:
- **Firma** (výrobce nábytku, např.) si založí účet na webu, nahraje své 3D modely (GLB formát)
- **Tato iOS app** se napojí na účet konkrétní firmy a stáhne jejich sortiment
- **App je snadno přebrandovatelná** — logo, barvy, název firmy se načítají z DB
- **Modulární architektura** — budeme postupně přidávat moduly (AR měření, multi-model scéna, sdílení plánků, atd.)

### Důležité:
- **NEPOUŽÍVÁME VERCEL** pro iOS — Vercel slouží jen webu
- **Supabase je jediný backend** — iOS app se připojuje přímo na Supabase SDK
- **Build přes EAS Build** (Expo Application Services) — cloud build bez Macu
- **Deploy přes EAS Submit** na App Store

---

## 🔧 Technický Stack

| Co | Technologie |
|---|---|
| Framework | **Expo (React Native)** + TypeScript |
| UI | React Native / SwiftUI components |
| 3D Rendering | expo-three / react-three-fiber |
| AR | ARKit (přes expo-ar nebo ViroReact) |
| Backend | **Supabase** (sdílený s webem) |
| Auth | Supabase Auth (email + password) |
| Storage | Supabase Storage (GLB modely, thumbnaily) |
| Build | EAS Build (cloud, žádný Mac nepotřeba) |
| Deploy | EAS Submit → App Store |

---

## 🗄️ Supabase Připojení

```
SUPABASE_URL=https://bglxasjgyjxpcvjyugaa.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnbHhhc2pneWp4cGN2anl1Z2FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDExMDkzNDQsImV4cCI6MjA1NjY4NTM0NH0.sFmgHCIkMfJ4ZQPfSe7Y_E0FXzVpkUodQNFLHBpFKJQ
```

### Tabulky

#### `models_3d` — hlavní tabulka modelů
| Sloupec | Typ | Popis |
|---|---|---|
| `id` | uuid (PK) | ID modelu |
| `title` | text | Název |
| `description` | text | Popis |
| `storage_path` | text | Cesta k GLB v `models_secure` bucket |
| `thumbnail_path` | text | Cesta k PNG v `model_thumbnails` bucket |
| `uploaded_by` | uuid (FK → auth.users) | Kdo nahrál |
| `owner_id` | uuid (FK → auth.users) | Vlastník |
| `ar_placement` | jsonb | `{floor: bool, wall: bool, qr_target: bool}` |
| `model_transform` | jsonb | `{position: {x,y,z}, rotation: {x,y,z}, scale: {x,y,z}}` |
| `annotations` | jsonb | Pole anotací s textem, barvami, pozicemi |
| `metadata` | jsonb | Obsahuje `mind_file_path`, `file_size`, `original_name` |
| `is_active` | bool | Soft delete flag |
| `category_id` | uuid (FK → categories) | Kategorie |
| `info_url` | text | Odkaz na e-shop produktu |
| `created_at` | timestamp | Datum vytvoření |

#### `users` — uživatelé (auto-created při signup)
| Sloupec | Typ | Popis |
|---|---|---|
| `id` | uuid (PK) | = auth.users.id |
| `display_name` | text | Zobrazované jméno |
| `company_name` | text | Název firmy |
| `account_type` | text | `individual` / `company` |
| `contact_email` | text | Kontaktní email |
| `tier` | text | `free` / `pro` / `premium` |

#### `categories` — kategorie modelů
| Sloupec | Typ | Popis |
|---|---|---|
| `id` | uuid (PK) | |
| `name` | text | Název kategorie |
| `user_id` | uuid | Vlastník kategorií |

### Storage Buckets
| Bucket | Přístup | Obsah |
|---|---|---|
| `models_secure` | **Private** (signed URLs, max 300s) | GLB modely + .mind soubory |
| `model_thumbnails` | **Public** | Preview PNG thumbnaily |

### RLS Policies
- Authenticated uživatelé vidí/editují/mažou **jen své modely** (`owner_id` OR `uploaded_by` = auth.uid())
- Storage má INSERT, UPDATE, DELETE policies pro oba buckety

---

## 🔗 GitHub

- **Web repo:** `https://github.com/MISS3x/MISS3_AR_Tools` (pro referenci)
- **iOS repo:** `https://github.com/MISS3x/MISS3_iOS_App` ← VYTVOŘIT
- **Organizace:** `MISS3x`
- **Git config:** `user.name = "MISS3"`, `user.email = "office@miss3.cz"`

---

## 📱 iOS App MVP Features

### Fáze 1: Základ
- [ ] Login / Signup (Supabase Auth)
- [ ] Seznam modelů konkrétní firmy (grid s thumbnaily z DB)
- [ ] Filtrace podle kategorií
- [ ] Detail modelu (metadata, popis, odkaz na e-shop)

### Fáze 2: 3D + AR
- [ ] 3D Viewer (SceneKit nebo react-three-fiber)
- [ ] AR Viewer — umístění modelu na podlahu (ARKit)
- [ ] AR Viewer — umístění na stěnu
- [ ] QR Scanner → otevření modelu v AR

### Fáze 3: Moduly (budoucí)
- [ ] Multi-model AR scéna (vybrat více modelů do jedné místnosti)
- [ ] AR měření vzdáleností
- [ ] Generování situačního plánku
- [ ] Screenshot/video AR scény
- [ ] Offline cache stažených modelů
- [ ] Push notifikace (nový model v sortimentu)

### Přebrandování
- Logo, barvy, název firmy = načtené z `users` tabulky (company_name)
- App se napojí na konkrétní `owner_id` → vidí jen modely té firmy
- Konfigurace přes env proměnné nebo config file

---

## 🚀 Setup kroky

```bash
# 1. Scaffold Expo projekt
npx -y create-expo-app@latest ./ --template blank-typescript

# 2. Instalace závislostí
npm install @supabase/supabase-js
npm install expo-three three @react-three/fiber
npm install @react-navigation/native @react-navigation/native-stack
npm install expo-camera expo-barcode-scanner

# 3. GitHub repo
git init
git remote add origin https://github.com/MISS3x/MISS3_iOS_App.git
git add . && git commit -m "initial: Expo project scaffold" && git push -u origin main

# 4. EAS Build setup
npx -y eas-cli@latest build:configure
```

---

## ⚙️ Uživatelské preference (globální pravidla)

- **Jazyk:** Komunikace česky, kód/commity anglicky
- **task.md** s progress barem (viz globální pravidla v Gemini)
- **Git auto-backup** po každé změně (commit + push automaticky)
- **Commit messages** anglicky, krátké a popisné
- **Nikdy necommitovat** `.env` soubory nebo secrets
- **Estetika:** Premium design, moderní UI, žádné základní placeholder UI
