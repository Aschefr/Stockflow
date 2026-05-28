# Audit des Scrappers Images & PDF — Stockflow

## Résumé Exécutif

Après analyse complète du pipeline frontend (`App.tsx`) et backend Rust (`scraper.rs`), voici les problèmes de fiabilité identifiés et les améliorations proposées.

---

## 🖼️ Scrapper Images

### Pipeline actuel
```
Frontend executeScrapeImageForSku(sku)
  → Construit query: "{brand} {mpn} {cleanVpc} image product"
  → invoke("scrape_images", { sku, query, networkPath })

Backend scrape_images_internal()
  1. Si RS → scrape direct ma.rsdelivers.com (Cloudinary URLs)
  2. Sinon / fallback → SearxNG catégorie images
  3. Télécharge jusqu'à 5 images, déduplique par taille, génère miniatures
```

### 🔴 Problèmes identifiés

| # | Problème | Localisation | Sévérité |
|---|---|---|---|
| 1 | **Query trop générique** : `"{brand} {mpn} image product"` donne de mauvais résultats pour des composants industriels (ex: "Siemens 6ES7 image product" ramène des photos de rails DIN ou de catalogues génériques) | `App.tsx:723` | Haute |
| 2 | **RS Direct : filtre trop strict** — ne prend que les URLs contenant `r_code` mais certaines images RS utilisent des codes internes différents du stock code (ex: `Y-XXXXXX-01.jpg` ≠ RS code). Des images valides sont ignorées | `scraper.rs:1119` | Haute |
| 3 | **Fallback SearxNG activé SEULEMENT si `candidate_urls` vide** — mais si RS direct ne donne aucune image (hors RS), il n'essaie aucune autre source directe (Farnell, Mouser, Conrad) avant SearxNG | `scraper.rs:1152-1153` | Moyenne |
| 4 | **Pas de vérification Content-Type** : l'image est chargée avec `image::load_from_memory` ce qui peut échouer silencieusement sur des SVG ou des webp non reconnus, mais n'émet pas d'événement de progression d'échec visible | `scraper.rs:1220-1223` | Basse |
| 5 | **`scrape_image_url` sauvegardé en DB seulement pour la 1ère image** mais le frontend ne montre pas cette URL dans la sidebar si le scraping vient d'une session précédente (les URLs Cloudinary générées sont testées même si déjà une image existe) | `scraper.rs:1227` / sidebar | Basse |
| 6 | **Simulation de progression par timer** au lieu d'événements réels Tauri — les étapes "Analyse", "Téléchargement", "Miniatures" sont simulées par des setTimeout, pas par de vrais événements backend. Si le scraping est plus rapide ou plus lent, le timer est décalé | `App.tsx:866-890` | Cosmétique |
| 7 | **`existing_sizes` ne tient pas compte des miniatures** : les miniatures `thumb_*` ont une taille différente de l'original, le test de déduplication `existing_sizes.iter().any(|&s| s == candidate_size)` ne comparera jamais avec une miniature. Potentiel re-téléchargement inutile si l'original a été supprimé mais la miniature reste | `scraper.rs:1077-1093` / `1215` | Basse |

### ✅ Améliorations proposées (Images)

1. **Query enrichie** : ajouter le MPN seul en premier terme, retirer "image product" (bruit), utiliser la catégorie comme filtre secondaire :
   ```
   "{mpn} {brand} photo"         (si MPN disponible)
   "{brand} {vpc_code} produit"  (si code VPC disponible)
   ```

2. **RS Direct : assouplir le filtre** — accepter aussi les URLs Cloudinary ne contenant pas le code exact (ex: accepter toute URL Cloudinary de la page produit) :
   ```rust
   // Avant
   if url_str.contains(r_code) { ... }
   // Après
   if !url_str.is_empty() { ... } // accepter toute URL Cloudinary de la page
   ```

3. **Essai direct Farnell/Mouser** avant SearxNG : utiliser les URLs produit VPC configurées pour scraper l'image de la fiche produit.

4. **Remplacer la simulation par de vrais événements Tauri** : émettre `image-scrape-progress` pour chaque étape réelle (téléchargement, resize, sauvegarde).

5. **Ajouter vérification Content-Type** : rejeter les réponses dont le `content-type` n'est pas `image/*`.

---

## 📄 Scrapper PDF

### Pipeline actuel
```
Frontend executeScrapePdfForSku(sku)
  → Construit query: "{brand} {mpn} {cleanVpc} datasheet pdf"
  → invoke("scrape_pdf", { sku, query, networkPath })

Backend scrape_pdf_internal()
  1. Si RS → scrape direct fr.rs-online.com / ma.rsdelivers.com (HTML scan .pdf URLs)
  2. Si aucun candidat direct → SearxNG avec query
  3. Trier par domaine VPC, limiter à 5, télécharger, dédupliquer par taille, sauvegarder
```

### 🔴 Problèmes identifiés

| # | Problème | Localisation | Sévérité |
|---|---|---|---|
| 1 | **Query trop générique** pour PDF aussi : `"datasheet pdf"` en fin de requête génère beaucoup de résultats non pertinents. Pour des composants industriels, le terme `"fiche technique"` en français serait plus pertinent sur les sites VPC FR | `App.tsx:702` | Haute |
| 2 | **RS Direct : scan naïf du HTML** — la détection de liens PDF dans le HTML RS est faite par un scan caractère par caractère cherchant `http...pdf`. Cette méthode attrape des URLs JS, des fragments encodés, des URLs d'assets non-PDF masqués | `scraper.rs:746-764` | Haute |
| 3 | **SearxNG : filtre trop strict** — `ends_with(".pdf")` manque les liens PDF avec des paramètres GET (`?dl=1`, `?format=pdf`, etc.) | `scraper.rs:796` | Haute |
| 4 | **Pas de vérification Content-Type HTTP** : un lien `.pdf` peut retourner une erreur HTML (403/404) et le code stocke quand même ces octets HTML comme "PDF valide" (la vérification `image::load_from_memory` n'existe pas pour les PDF) | `scraper.rs:840-876` | Haute |
| 5 | **Limite de 5 PDF** avant vérification de contenu : si les 5 premières URLs sont des 403, on retourne "Tous les téléchargements ont échoué" alors qu'il y avait peut-être 10 liens valides | `scraper.rs:829` | Moyenne |
| 6 | **Suppression des anciens fichiers** : les fichiers dans `local_files_to_remove` sont supprimés même s'ils sont valides et non remplacés. Un PDF local devient "à supprimer" dès qu'il n'est pas dans `saved_names` alors qu'il devrait rester si on n'a pas trouvé de meilleur candidat | `scraper.rs:1047-1048` | Moyenne |
| 7 | **`first_relative_path` vide si tous les PDFs viennent du cache local** : si les PDFs existent déjà localement et sont réutilisés (non-HTTP URLs), `first_relative_path` reste vide et la DB n'est pas mise à jour | `scraper.rs:987-1010` | Basse |

### ✅ Améliorations proposées (PDF)

1. **Query améliorée** :
   ```typescript
   // Avant
   const query = `${brand} ${mpn} ${cleanVpc} datasheet pdf`
   // Après
   const query = mpn 
     ? `"${mpn}" ${brand} datasheet filetype:pdf`
     : `${brand} ${sku} fiche technique filetype:pdf`
   ```

2. **Validation Content-Type HTTP** : vérifier `content-type: application/pdf` avant d'accepter les bytes comme PDF valide :
   ```rust
   let ct = res.headers().get("content-type")
       .and_then(|v| v.to_str().ok())
       .unwrap_or("");
   if !ct.contains("pdf") && !ct.contains("octet-stream") {
       continue; // Ignorer les réponses HTML
   }
   ```

3. **Filtre SearxNG assoupli** :
   ```rust
   // Avant
   if link.to_lowercase().ends_with(".pdf") { ... }
   // Après
   let lower = link.to_lowercase();
   if lower.contains(".pdf") || lower.contains("filetype=pdf") || lower.contains("format=pdf") { ... }
   ```

4. **Augmenter la liste de candidats** avant filtrage : tenter jusqu'à 10 liens mais ne garder que les 5 premiers **valides** (avec Content-Type PDF correct).

5. **Scan HTML RS amélioré** : utiliser un pattern regex simple plutôt que le scan caractère par caractère, et filtrer les faux positifs JS/JSON.

6. **Conserver les PDFs locaux non remplacés** : ne supprimer un fichier local que s'il a été explicitement remplacé par un plus récent.

---

## 🔗 Comparaison Image vs PDF

| Critère | Image | PDF |
|---|---|---|
| Source primaire | RS Cloudinary (bon) | RS HTML scan (fragile) |
| Fallback | SearxNG images ✅ | SearxNG général ✅ |
| Validation du contenu téléchargé | `image::load_from_memory` ✅ | ❌ Aucune |
| Progression temps-réel | Simulée ⚠️ | Réelle (partielle) ✅ |
| Qualité query SearxNG | Générique ⚠️ | Générique ⚠️ |
| Déduplication | Par taille de fichier ✅ | Par type+taille ✅ |

---

## 🎯 Priorités de correction

### Haute priorité (fiabilité directe)
- [ ] Validation Content-Type PDF avant sauvegarde
- [ ] Filtre SearxNG `.pdf` → `.contains(".pdf")`
- [ ] Query MPN-first pour PDF et images

### Moyenne priorité (qualité des résultats)
- [ ] RS HTML scan → regex robuste pour PDFs
- [ ] Augmenter pool de candidats PDF à 10 avant filtrage
- [ ] Ne pas supprimer les PDFs locaux non remplacés

### Basse priorité (cosmétique/optimisation)
- [ ] Remplacer la simulation de progression images par vrais événements Tauri
- [ ] Assouplir filtre Cloudinary pour RS (accepter toute URL de la page)
- [ ] Essai direct Farnell/Mouser images avant SearxNG

> [!IMPORTANT]
> La correction la plus impactante est la **validation Content-Type pour les PDFs** — actuellement un lien 404 dont le serveur renvoie une page HTML d'erreur peut être sauvegardé comme "PDF" valide, corrompant la fiche du produit.

