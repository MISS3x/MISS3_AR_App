# MISS3 AR Universal App — Master Task Plan

> Živý dokument. Cokoliv dokončíme → odškrtneme `[x]`.

## 🚨 Blokující akce (manuální)

*Žádné aktuální blokery* ✅

## 📊 Progress: **12 / 26 done (46%)**

```
##############################################------------------------------------------------------  46%
```

| Section | Done | Total | % |
|---|---|---|---|
| Foundation | 6 | 6 | 100% |
| 3D Viewer | 3 | 3 | 100% |
| Quick Look AR (temp) | 1 | 1 | 100% |
| UI/UX Polish | 0 | 4 | 0% |
| ARKit Module (native) | 0 | 8 | 0% |
| Android Build | 0 | 2 | 0% |
| Git & Cleanup | 2 | 2 | 100% |

---

## Foundation
- [x] **#1** — Expo project scaffold with TypeScript ✅
- [x] **#2** — Supabase client + env config ✅ fixed API key + anon storage RLS
- [x] **#3** — Company Select Screen ✅ live on iPhone
- [x] **#4** — Model List Screen (grid + thumbnails) ✅
- [x] **#5** — Model Detail Screen ✅
- [x] **#6** — EAS iOS Development Build ✅ installed on iPhone

## 3D Viewer
- [x] **#7** — WebView + Google model-viewer (rotate, zoom, pan, auto-rotate) ✅
- [x] **#8** — Signed URL generation from models_secure bucket ✅
- [x] **#9** — Loading states + error handling ✅

## Quick Look AR (dočasné řešení)
- [x] **#10** — Download to cache + expo-sharing → Quick Look with AR ✅

## UI/UX Polish
- [x] **#11** — Clean model names (remove underscores, extensions) ✅
- [x] **#12** — Fix settings icon overlap with model count badge ✅ (Settings icon removed)
- [x] **#13** — Add file size display from DB ✅
- [x] **#14** — Overall layout polish (spacing, animations, company select card) ✅

## ARKit Module (native — Phase 2)
- [x] **#15** — Research & Download logic: ViroReact locally caches Supabase models ✅
- [x] **#16** — AR Interactions: Drag, Scale (pinch), Rotate (twist) gestures ✅
- [x] **#17** — Advanced Placement: Detect wall/floor normals and align model appropriately ✅ (Using `ViroARPlaneSelector` + `FixedToWorld` drag mapping)
- [ ] **#18** — Graphics Polish: Soft Shadows & Ambient Light Estimation
- [ ] **#19** — Dev UI: Add floating menu to toggle "Clay mode" (gray material) for light testing
- [ ] **#20** — AR annotations / dimension lines
- [ ] **#21** — AR screenshot / recording
- [ ] **#22** — QR target tracking (place model on QR code)

## Android Build
- [ ] **#23** — EAS Android APK build
- [ ] **#24** — Test on Android device + ARCore support

## Git & Cleanup
- [x] **#25** — GitHub repo (MISS3x/MISS3_AR_App) ✅
- [x] **#26** — Git push all changes ✅
