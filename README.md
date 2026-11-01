# visageflou

Le projet est 95% vibecodé, outil pratique pour flouter facilement et rapidement un grand nombre de visages sur photos et vidéos. le site est une page statique, aucune donnée ne quitte l'appareil de l'utilisateur.

Floutage de visages qui s'exécute entièrement dans votre navigateur. Ouvrez une image, les visages sont détectés sur votre appareil, réglez le flou, ajoutez / déplacez / supprimez des flous à la main, puis exportez. Rien n'est envoyé sur un serveur.

## Fonctionnalités
- Plusieurs images à la fois : chacune a ses propres flous et son propre historique annuler / rétablir
- Détection automatique des visages (CenterFace) avec un curseur de sensibilité
- Flou gaussien, pixelisation ou aplat noir ; curseurs de force, de marge, de bord adouci et de forme (ellipse / rectangle)
- Réglage du type et de la force propre à chaque flou
- Dessiner, sélectionner, déplacer, redimensionner et supprimer des flous
- Export en pleine résolution (JPEG ou PNG) sans métadonnées EXIF, position GPS comprise : image par image, ou toutes d'un coup dans une archive `.zip`
- Garde-fous : l'export est bloqué tant que la détection n'est pas terminée, et une confirmation est demandée pour une image sans aucun flou
- Interface en français

Raccourcis : `V` sélection, `A` ajouter un flou, `Suppr` supprimer, `Ctrl/Cmd+Z` annuler (avec `Maj` : rétablir), `←` / `→` changer d'image.

## Développement
```
npm install
npm run dev
npm test
```

## Déploiement (VPS)
Prérequis : un VPS avec Docker, un enregistrement DNS `A` (et `AAAA` si le VPS a une IPv6) de `visageflou.fr` vers le VPS, et les ports 80 et 443 ouverts.

```
git clone git@github.com:0pasdeblaze/visageflou.git && cd visageflou
docker compose up -d --build
```

L'image est un serveur [Caddy](https://caddyserver.com) en lecture seule qui ne sert que des fichiers statiques (pas de journaux d'accès, méthodes autres que GET refusées, en-têtes de sécurité définis dans `deploy/Caddyfile`). Caddy obtient et renouvelle seul le certificat HTTPS ; il est conservé dans le volume `caddy_data`.

Variable `SITE_ADDRESS` (par défaut `visageflou.fr`) : mettez `:8080` pour servir en HTTP simple derrière un reverse proxy qui termine le TLS (et adaptez alors les ports dans `docker-compose.yml`).

Mise à jour : `git pull && docker compose up -d --build`.

Les journaux du conteneur sont désactivés (`logging: driver: none`) pour ne conserver aucune adresse IP. Pour déboguer un premier déploiement, commentez temporairement cette ligne.

## Confidentialité
- Les photos sont décodées, analysées et floutées dans la page ; il n'existe aucun point d'envoi de fichiers.
- La CSP n'autorise que `connect-src 'self'` (nécessaire pour charger le modèle et le moteur WASM) et le serveur n'a aucune route qui accepte des données. Vous pouvez le vérifier dans les outils de développement de votre navigateur. Comme pour tout site web, c'est l'hébergeur qui fournit le code que vous exécutez ; pour une garantie plus forte, compilez et servez votre propre copie.
- L'export repasse par un canvas, ce qui supprime les données EXIF.

## Modèle
`public/models/centerface-dynamic.onnx` est le modèle CenterFace de [deface](https://github.com/ORB-HD/deface), converti avec `tools/convert_model.py` (dimensions d'entrée dynamiques, poids retirés des entrées du graphe). Voir `THIRD_PARTY_NOTICES.md`.
