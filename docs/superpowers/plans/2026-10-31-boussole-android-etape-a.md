# Plan — Boussole Android, étape A (appli autonome)

Spec : `docs/superpowers/specs/2026-10-31-boussole-android-design.md`.

1. **`L.planNotifications(data, now)`** dans `logic.js` + tests (`npm test`) : rappels avec relances,
   reporté → prochaine heure permise, silencieux, urgent ; tâches avec heure ; événements ; décrocher,
   coucher, check-ins ; heures calmes ; tri et limite à 60.
2. **Capacitor** : dépendances (`@capacitor/core`, `cli`, `android`, `filesystem`, `local-notifications`),
   `capacitor.config.json`, `scripts/build-mobile.js` (copie `renderer/`, `logic.js`, polices, icône dans `mobile/www`),
   `npx cap add android`, icône d'appli, permissions (notifications, alarmes exactes, démarrage).
3. **`renderer/mobile-api.js`** : stockage (fichier + `.bak` + sauvegarde du jour), `get` / `set` / `reminder` /
   `capture`, programmation des notifications, actions « Fait » / « +10 min », lecture des messages d'un proche,
   no-op pour ce qui est propre au PC. Chargé seulement sur Android.
4. **Sons et canaux** : `scripts/make-sounds.js` génère les WAV de `SOUNDS` dans `res/raw`, canaux par sphère et son.
5. **Mise en page mobile** dans `style.css` + `app.js` : barre du bas avec « Plus », sélecteur de sphère en haut,
   agenda en vue Jour par défaut, réglages Windows masqués, aide notifications / batterie.
6. **Partager vers Boussole** (texte depuis une autre appli → Vide-tête) si un plugin open source simple convient ;
   sinon reporté à l'étape B.
7. **Construction** : clé de signature hors du dépôt, `gradlew assembleRelease`, vérification de l'APK.
8. **Publication** : version 1.2.0, APK ajoutée à la Release GitHub, explications Obtainium.
9. **Vérifications** : `npm test`, interface mobile testée dans Electron à 390 px de large, essais sur téléphone par l'utilisateur.
