# visageflou

Floutage de visages qui s'exécute entièrement dans votre navigateur. Ouvrez une image, les visages sont détectés sur votre appareil, réglez le flou, ajoutez / déplacez / supprimez des flous à la main, puis exportez. Rien n'est envoyé sur un serveur.

## Fonctionnalités
- Détection automatique des visages (CenterFace) avec un curseur de sensibilité
- Flou gaussien, pixelisation ou aplat noir ; curseurs de force, de marge, de bord adouci et de forme (ellipse / rectangle)
- Réglage du type et de la force propre à chaque flou
- Dessiner, sélectionner, déplacer, redimensionner et supprimer des flous ; annuler / rétablir
- Export en pleine résolution (JPEG ou PNG) sans métadonnées EXIF, position GPS comprise

## Développement
```
npm install
npm run dev
npm test
```

## Déploiement
```
docker compose up -d --build
```
L'image est un serveur [Caddy](https://caddyserver.com) en lecture seule qui ne sert que des fichiers statiques (pas de journaux d'accès, méthodes autres que GET refusées, en-têtes de sécurité définis dans `deploy/Caddyfile`).

Renseignez `SITE_ADDRESS` dans `docker-compose.yml` :
- un nom de domaine (par exemple `visageflou.fr`) pour un HTTPS géré par Caddy ; les ports 80 et 443 doivent atteindre le conteneur et le DNS doit pointer vers lui
- `:8080` (par défaut) lorsqu'un reverse proxy placé devant termine le TLS

## Confidentialité
- Les photos sont décodées, analysées et floutées dans la page ; il n'existe aucun point d'envoi de fichiers.
- La CSP n'autorise que `connect-src 'self'` (nécessaire pour charger le modèle et le moteur WASM) et le serveur n'a aucune route qui accepte des données. Vous pouvez le vérifier dans les outils de développement de votre navigateur. Comme pour tout site web, c'est l'hébergeur qui fournit le code que vous exécutez ; pour une garantie plus forte, compilez et servez votre propre copie.
- L'export repasse par un canvas, ce qui supprime les données EXIF.

## Modèle
`public/models/centerface-dynamic.onnx` est le modèle CenterFace de [deface](https://github.com/ORB-HD/deface), converti avec `tools/convert_model.py` (dimensions d'entrée dynamiques, poids retirés des entrées du graphe). Voir `THIRD_PARTY_NOTICES.md`.
