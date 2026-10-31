# Boussole Android — spec (2026-10-31)

Appli Android complète, gratuite et open source, synchronisée avec Boussole PC.

## Choix validés

- **Toute l'appli** sur Android (mêmes écrans que sur PC), navigation en bas.
- **Capacitor** (MIT) enveloppe le même `renderer/` et `logic.js` : une seule base de code d'interface.
- **Synchro par ntfy, chiffrée de bout en bout**, appairage par QR code.
- **Mises à jour par Obtainium** (open source) qui suit les Releases GitHub.

## Étape A — appli Android autonome

- `window.api` a deux implémentations : `preload.js` (Electron) et `renderer/mobile-api.js` (Capacitor).
  Même surface (`get`, `set`, `reminder`, `capture`, `notify`…), donc l'interface ne change pas.
- Données dans le stockage privé de l'appli (`@capacitor/filesystem`) : `boussole.json`, `.bak`,
  une sauvegarde par jour (7 jours). Même format que sur PC (`L.normalize`).
- Notifications **programmées par Android** (`@capacitor/local-notifications`), donc elles sonnent appli
  fermée et PC éteint. `L.planNotifications(data, now)` (pur, testé) calcule les ~60 prochaines :
  rappels (avec relances), tâches avec heure, événements (avant / le matin), décrocher, coucher, check-ins.
  Règles identiques au PC : heures calmes, sphères, reporté / silencieux, urgent.
  Reprogrammées à chaque changement et au retour dans l'appli. Boutons « Fait » et « +10 min ».
- Canaux Android par sphère et par son (`perso-doux`, `pro-net`…), sons générés en WAV depuis `SOUNDS`.
- Messages d'un proche : l'appli lit aussi le sujet ntfy quand elle est ouverte (ids `k<id>` : pas de doublon).
- Pas d'envoi ntfy « vers le téléphone » depuis le téléphone lui-même.
- Mise en page mobile : barre du bas (Aujourd'hui, Agenda, Rappels, Vide-tête, Plus), agenda en vue Jour par défaut.
  Les réglages propres à Windows sont masqués ; un réglage aide à autoriser les notifications et l'économie de batterie.
- APK signée avec une clé propre au projet, gardée **hors du dépôt** (sa perte empêcherait les mises à jour).
- Publiée dans la même Release GitHub que la version PC.

## Étape B — appairage et synchro (Boussole PC 1.2)

- Le PC affiche un QR code : `{server, topic, key}` (clé AES-256 aléatoire). Le téléphone le scanne (ou saisie manuelle).
- Chaque élément porte `updatedAt` ; une suppression laisse une pierre tombale `{id, deleted: true, updatedAt}`.
  Fusion élément par élément : le plus récent gagne. Réglages partagés, sauf ceux propres à un appareil.
- Chaque modification part chiffrée (AES-GCM, WebCrypto) sur le sujet de synchro.
  Au retour d'un appareil (ntfy garde 12 h), échange d'une copie complète chiffrée en pièce jointe, puis fusion.
  Les changements non confirmés sont renvoyés.
- Une fois appairé, le PC n'envoie plus ses notifications au téléphone par ntfy (pas de doublon).

## Limites connues

- Pas de test sur un vrai téléphone de mon côté : logique testée sous Node, interface testée dans Electron,
  essais sur appareil par l'utilisateur.
- Certains fabricants (Xiaomi, Samsung…) retardent les alarmes : l'appli guide vers l'exception de batterie.
