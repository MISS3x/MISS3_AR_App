---
name: Cross-Project Orchestrator
description: Orchestrace mezi MISS3_AR_Tool (web) a MISS3_AR_App (iOS) — kontrola sdíleného kontraktu, changelog, sync check
---

# Cross-Project Orchestrator Skill

Tento skill ti říká, jak správně pracovat v rámci dvouprojektového ekosystému MISS3.

## Kdy se aktivuje

- **Vždy na začátku práce** na tomto projektu
- Když uživatel zmíní druhý projekt nebo "sync"
- Když měníš DB schéma, RLS, API, nebo datové formáty
- Když uživatel řekne `/sync-check`

## Co máš udělat

### 1. Na začátku session — přečti sdílené dokumenty

Přečti tyto soubory (jsou v nadřazené složce):

```
Z:\MISS3 Dropbox\Server Data\printednest\Antigravity\_agent\ORCHESTRATOR.md
Z:\MISS3 Dropbox\Server Data\printednest\Antigravity\_agent\SHARED_CONTRACT.md
Z:\MISS3 Dropbox\Server Data\printednest\Antigravity\_agent\CHANGELOG.md
```

### 2. Zkontroluj nevyřešené změny

Hledej v CHANGELOG.md záznamy se statusem **⏳**.

- Pokud existují záznamy `⏳ Čeká na implementaci v MISS3_AR_Tool` (pro web) nebo `⏳ Čeká na implementaci v MISS3_AR_App` (pro app):
  - **Informuj uživatele** o každé nevyřešené změně
  - **Zeptej se** co s tím chce udělat (implementovat / odložit / potřebuje víc info)
  - **Počkej na odpověď** — neimplementuj bez souhlasu

### 3. Po změně, která ovlivňuje druhý projekt

Spusť workflow `cross-project-update`:

1. Aktualizuj `SHARED_CONTRACT.md` — přidej/uprav tabulku, sloupec, bucket, API
2. Přidej záznam na začátek `CHANGELOG.md` ve formátu:
   ```
   ## YYYY-MM-DD — [Název změny]
   - **Projekt**: [tento projekt]
   - **Změna**: [co se změnilo]
   - **Dopad na [druhý projekt]**: [co potřebuje implementovat]
   - **Návrh implementace**: [konkrétní kroky]
   - **Status**: ⏳ Čeká na implementaci v [druhý projekt]
   ```
3. Informuj uživatele, že changelog byl aktualizován

### 4. Sync check (`/sync-check`)

1. Projdi celý CHANGELOG
2. Spočítej záznamy se statusem ⏳
3. Pokud žádné → `✅ Oba projekty jsou v syncu`
4. Pokud existují → vypiš je a navrhni řešení

### 5. Na konci každé odpovědi — cross-project status

**Po dokončení jakéhokoliv úkolu** (ne jen na začátku!) znovu přečti `CHANGELOG.md` a zkontroluj ⏳ záznamy pro tento projekt.

Pokud existují nevyřešené změny, přidej na konec odpovědi neformální upozornění:

```
---
👀 **Novinka z Web týmu:** Na webu přibyl sloupec `is_public` na tabulce `models_3d`.
App zatím nefiltruje podle tohoto sloupce.
💡 **Návrh:** Přidat `.eq('is_public', true)` do query na model list.
Chceš to řešit teď, nebo až příště?
```

Pravidla:
- **Piš neformálně** — jako kolega, ne jako robot
- **Buď specifický** — řekni co přesně se změnilo, ne jen "jsou nevyřešené změny"
- **Navrhni řešení** — co bys jako agent udělal, kdybys dostal OK
- **Nezasahuj** — jen informuj a čekej na odpověď
- **Maximálně 3 položky** — pokud je jich víc, řekni "a dalších N čeká" a nabídni `/sync-check`

## Důležité soubory

| Soubor | Cesta | Účel |
|---|---|---|
| Orchestrátor | `Antigravity/_agent/ORCHESTRATOR.md` | Master instrukce |
| Kontrakt | `Antigravity/_agent/SHARED_CONTRACT.md` | DB schéma, API, typy |
| Changelog | `Antigravity/_agent/CHANGELOG.md` | Log změn se statusy |
| Sync check | `Antigravity/_agent/workflows/sync-check.md` | Workflow kontroly |
| Update | `Antigravity/_agent/workflows/cross-project-update.md` | Workflow aktualizace |
