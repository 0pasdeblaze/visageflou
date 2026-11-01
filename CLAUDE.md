# visageflou

Site statique de floutage de visages, entièrement côté client (images uniquement).

## Conventions
- README, documentation, messages de commit et interface du site en français ; commentaires de code en anglais.
- Les notes de déploiement privées vont dans `CLAUDE.local.md` (ignoré par git). Ne jamais commiter d'IP, de nom de serveur ou de chemin local.

## À savoir
- La CSP est dans `vite.config.ts` (balise meta) et `deploy/Caddyfile` (en-tête) : les garder synchronisées.
- Hors ligne : `src/sw.template.js` devient `dist/sw.js` au build. Télécharger avec `cache: 'no-store'` et appeler `cache.match` avec `ignoreVary` ; `/`, `/index.html` et `/sw.js` restent `no-cache` côté serveur.
- Un export ne doit jamais traiter une image dont la détection n'est pas terminée.
- Le floutage est fait par `src/blur.ts` (pas `ctx.filter`, absent de Safari).

## Commandes
`npm install`, `npm run dev`, `npm run build`, `npm test`
