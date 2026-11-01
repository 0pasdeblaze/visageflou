# visageflou

Le projet est 95% vibecodé, outil pratique pour flouter facilement et rapidement un grand nombre de visages sur photos. le site est une page statique, aucune donnée ne quitte l'appareil de l'utilisateur.

## Fonctionnalités
- Détection automatique des visages, sur plusieurs images à la fois
- Flou gaussien, pixelisation ou aplat noir, avec réglages de force, de marge, de bord et de forme
- Ajout, déplacement, redimensionnement et suppression des flous à la main
- Export JPEG ou PNG sans métadonnées EXIF, image par image ou en `.zip`
- Fonctionne hors ligne après le premier chargement

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
Caddy sert les fichiers statiques et obtient le certificat HTTPS du domaine `SITE_ADDRESS` (`visageflou.fr` par défaut, `:8080` pour du HTTP derrière un reverse proxy). Les ports 80 et 443 doivent être ouverts et le DNS pointer vers le serveur.

## Licence
[MIT](LICENSE). Modèle CenterFace (via [deface](https://github.com/ORB-HD/deface)) et ONNX Runtime : voir `THIRD_PARTY_NOTICES.md`.
