# Boussole

Une appli Windows pour s'orienter quand on a un TDAH : ne plus oublier, réussir à démarrer, voir le temps
passer, séparer le perso du pro, et fermer la journée en douceur. Gratuite, open source, et tes données
restent sur ton ordinateur.

## Ce qu'elle fait

- **Aujourd'hui** : une seule tâche à la fois, avec sa toute première petite étape et un bouton « Juste 2 minutes ».
- **Agenda** jour / semaine / mois, qui se remplit tout seul (rendez-vous, tâches datées, rappels),
  avec glisser-déposer et récurrences (chaque jour, semaine, mois, année : anniversaires…).
- **Une chose à la fois** : impossible de placer deux choses sur le même créneau, perso ou pro.
- **Rappels insistants** : ils reviennent jusqu'à « Fait », avec une petite carte de relance à l'écran.
- **Perso et Pro** bien séparés : couleurs, filtres, sons et notifications (le pro attend le soir et le week-end).
- **Focus** avec un minuteur visuel, et un carillon pour sentir le temps qui passe.
- **Vide-tête** : `Ctrl+Maj+Espace` partout dans Windows pour noter une pensée en deux secondes.
- **Ce soir** : décrocher, voir ses victoires, respirer.
- **Météo intérieure** : humeur, énergie et tension en un clic, avec un résumé à montrer à son médecin.
- **Fiches et notes datées** sur tout, **recherche** globale et **archive** de ce qui est terminé.
- **Sur le téléphone** et **messages d'un proche** grâce à [ntfy](https://ntfy.sh) (gratuit, open source, sans compte).
- Personnalisable de partout : thèmes pensés avec la psychologie des couleurs, ton des messages, horaires, modules.

## Installer

Télécharge `Boussole Setup x.y.z.exe` dans les [Releases](../../releases) et lance-le.
L'appli se met ensuite à jour toute seule.

L'installateur n'est pas signé (une signature de code est payante) : Windows peut afficher
« Windows a protégé votre ordinateur ». Clique sur **Informations complémentaires**, puis **Exécuter quand même**.

## Développer

```bash
npm install
npm start      # lancer l'appli
npm test       # tests de la logique (rappels, récurrences, agenda, messages…)
npm run dist   # fabriquer l'installateur Windows
```

Le fonctionnement est décrit dans [docs/spec.md](docs/spec.md).

## Vie privée

Tout est enregistré dans `%AppData%\Boussole`, avec une sauvegarde par jour. Rien ne sort de l'ordinateur,
sauf si tu actives toi-même le téléphone ou les messages d'un proche (via ntfy) ou une copie vers ton cloud.

## Licence

MIT
