# Handoff pro Web Team (MISS3 AR Tool)

**Datum:** 18. května 2026
**Týká se:** Zpracování a vizualizace velkých AR Meshů (iOS RoomPlan)

## 🔴 Problém
Mobilní iOS aplikace byla aktualizována, aby při skenování obřích prostor (haly, krovy) nepadala na vyčerpání paměti (RAM). 
Aplikace nyní provádí **"Streaming" meshe** — jakmile se blíží limit paměti, appka vyexportuje aktuální část meshe, pošle ji do Supabase Storage a **uvolní paměť**, aby mohla skenovat dál.

Tím pádem jeden sken místnosti (jeden `project_id`) už **není reprezentován jedním souborem**, ale sérií několika na sebe navazujících `.obj` chunků.

Původní způsob, kdy web načítal mesh pomocí sloupce `mesh_url` z tabulky `ar_projects`, už nestačí (obsahuje totiž link vždy jen na ten úplně první nebo poslední kousek).

## 🟢 Řešení (Co musí udělat Web Team)
Mobilní aplikace nyní zapisuje každý nahraný kousek meshe do samostatné tabulky **`ar_mesh_scans`**.

1. **Načítání z DB:**
   Při otevírání projektu na webu musí backend/frontend přestat používat `ar_projects.mesh_url`. Místo toho musí udělat dotaz:
   ```javascript
   const { data } = await supabase
     .from('ar_mesh_scans')
     .select('file_path')
     .eq('project_id', TENTO_PROJEKT);
   ```
   Tím získáte pole cest ke VŠEM `.obj` chunkům, ze kterých se mesh skládá.

2. **Načítání modelů (Three.js / Babylon.js / A-Frame):**
   - Získat public URL ke každému chunk z `mesh-scans` bucketu přes Supabase Storage.
   - Použít `OBJLoader` na každý z nich (ideálně paralelně přes `Promise.all`).
   - Přidat je všechny do stejné `THREE.Group` nebo `Scene`. Všechny chunky sdílejí společný souřadnicový systém (ARWorld origin), takže se v prostoru perfektně navážou na sebe.

3. **Paměťová optimalizace na webu (volitelné):**
   Vzhledem k tomu, že složený mesh může mít i desítky milionů polygonů (stovky MB), bude vhodné do budoucna uvažovat o:
   - Zobrazení progress baru podle počtu načtených chunků.
   - Použití `.glb` exportu nebo Draco komprese v budoucích verzích.

## Struktura tabulky `ar_mesh_scans`
- `id` (uuid)
- `project_id` (text) - vazba na projekt
- `user_id` (uuid) - autor
- `file_path` (text) - cesta ve storage bucketu `mesh-scans`
- `file_size` (int) - velikost v bajtech
- `vertices_count` (int)
- `faces_count` (int)
- `format` (text) - aktuálně vždy "obj"
