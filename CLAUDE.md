# visageflou

Site statique de floutage de visages, entièrement côté client. Images uniquement. La confidentialité d'abord : les photos ne quittent jamais le navigateur.

## Conventions
- Le README, la documentation, les messages de commit et **toute l'interface du site** sont en français (`index.html` et textes de `src/main.ts`). Les commentaires de code restent en anglais.

## Décisions
- Détecteur : modèle CenterFace ONNX issu de deface (MIT), exécuté avec `onnxruntime-web` (WASM). Le modèle de `public/models/` est converti par `tools/convert_model.py`.
- Le floutage est notre propre moteur de pixels (`src/blur.ts`), pas `ctx.filter` du canvas (non pris en charge par Safari). La force est relative à la taille de la zone, pour que l'aperçu (réduit) et l'export (pleine résolution) aient le même rendu.
- Aucune requête tierce, aucun outil d'analyse. Tout est servi depuis la même origine ; la CSP est intégrée à index.html à la compilation (`vite.config.ts`) et envoyée en en-tête par `deploy/Caddyfile`. Garder les deux synchronisés.
- La logique pure (`centerface.ts`, `blur.ts`, `zip.ts`) ne dépend pas du DOM, ce qui permet de la tester ; l'interface est dans `main.ts`.
- Plusieurs images : chaque image est un `Doc` (flous, historique, analyse). Seule l'image affichée garde ses pixels décodés en mémoire ; la détection et l'export décodent une image à la fois.
- Confidentialité de l'export : jamais d'export d'une image dont la détection n'est pas terminée ; confirmation si une image n'a aucun flou.

## Commandes
- `npm install` (le postinstall copie le moteur WASM d'ORT dans `public/ort/`, ignoré par git)
- `npm run dev` / `npm run build` / `npm run preview`
- `npm test`

Les notes de déploiement privées, si elles existent, sont dans `CLAUDE.local.md` (ignoré par git).
