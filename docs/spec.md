# Boussole — spec (2026-10-30)

Appli Windows pour adultes TDAH (en particulier la présentation inattentive). Objectif : compenser
les fonctions exécutives les plus touchées (organisation, lancement, mémoire de travail et prospective,
gestion du temps, régulation émotionnelle), sans jamais culpabiliser.

## Besoins → fonctions

| Besoin (doc) | Fonction |
|---|---|
| Mémoire prospective (factures, RDV, SMS) | Rappels récurrents qui relancent toutes les X min jusqu'à « Fait » + carte de relance toujours visible |
| Initiation de l'action, « première petite étape » | Tâche = titre + micro-étape ; une seule tâche « Maintenant » ; bouton « Juste 2 minutes » |
| Temps non ressenti, 2 h = 15 min | Rail du temps jusqu'au coucher, minuteur-disque, carillon périodique (ignoré si inactif) |
| Mémoire de travail, 1 000 pensées | Vide-tête global (Ctrl+Alt+Espace) → à trier / tâche / parking à idées |
| Report du coucher, journée « inutile » | Soir : alerte de décrochage, récap des victoires, vide-tête du coucher, cohérence cardiaque |
| Dysrégulation émotionnelle intériorisée | Météo intérieure (humeur / énergie / tension), historique 30 j, copie pour le médecin |
| Sensibilité à la critique | Pas de rouge, pas de série cassée, ton réglable (doux / direct / humour) |

## Couleurs (psychologie)

- Sarcelle « lagune » : calme, concentration → couleur principale, Focus.
- Ambre : attention sans alarme → rappels (remplace le rouge, anxiogène).
- Sauge : progrès, sécurité → tâches faites.
- Lavande : créativité → vide-tête / idées.
- Rose doux : empathie → météo intérieure.
- Miel : récompense → victoires.
- Le soir : thème « Veilleuse » sans bleu (tons chauds, faible excitation, aide l'endormissement).

## Technique

Electron, sans framework. `main.js` (fenêtres, tray, notifications, planificateur, raccourci,
stockage JSON atomique + .bak dans %AppData%), `preload.js`, `logic.js` (fonctions pures partagées,
testées par `test.js`), `renderer/` (interface). Données 100 % locales.
Empaquetage : electron-builder → installateur NSIS (à lancer depuis un chemin court, NSIS ne gère pas
les chemins de plus de 260 caractères).

Fiabilité :
- Chaque écriture porte un numéro de version (`rev`). Les modifications faites par le processus principal
  (relances, carte de relance, vide-tête rapide) sont journalisées et rejouées sur une écriture en retard
  de l'interface (`L.mergeIncoming`), au lieu d'être écrasées.
- Sauvegardes : `boussole.json.bak` à chaque écriture, un fichier par jour dans `%AppData%/Boussole/sauvegardes`
  (7 jours), et en option une copie dans un dossier cloud (30 jours, regroupée sur une minute).
- Export / import JSON depuis les Réglages ; une copie `avant-import-*.json` est faite avant tout import.
- Rappel « urgent » : ignore les heures calmes.

## Perso / Pro, agenda, fiches (2026-10-31)

- Chaque tâche, rappel, événement et idée a une `sphere` (`perso` | `pro`, défaut `perso`).
- Sélecteur Perso / Pro / Tout dans la barre latérale. Mode auto : Pro pendant les horaires de travail
  (`workDays`, `workStart`, `workEnd`), Perso sinon ; un choix manuel tient jusqu'au prochain changement.
- Notifications : icône de la sphère dans le titre, son propre à la sphère (joué par l'interface).
  `L.notifyMode` : Pro hors horaires → `proOff` (défaut : reporté), Perso pendant le travail → `persoAtWork`
  (défaut : silencieux). Urgent → toujours normal. Les événements ne sont jamais reportés.
- Couleurs : Pro = bleu cobalt (cadre, fiabilité), Perso = rose orchidée (chaleur). Le soir, Pro passe
  en gris doux (pas de bleu la nuit).
- Agenda jour / semaine / mois (`L.agendaItems`, `L.layoutDay`) : événements (`events`), tâches datées,
  rappels (récurrents dépliés à partir d'aujourd'hui ; les quotidiens masqués en vue mois).
- Fiche latérale pour tout modifier, avec un fil de notes datées (`notes: [{at, text}]`).
- Tâche avec heure → une notification à l'heure dite ; événement → une notification `eventLead` min avant.
