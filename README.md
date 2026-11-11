# PoliticAYAB

Un atelier web pour créer des affiches politiques tricotées. Le document fait
toujours **180 pixels de large** et chaque rangée utilise **au plus deux fils**.
La palette peut contenir d’autres fils pour les rangées suivantes.

```sh
npm run dev
```

Ouvrir [l’atelier](http://127.0.0.1:4173/). Node.js 22 suffit ; aucune dépendance à
installer. Le projet est un site statique : un hébergeur peut servir
`index.html`, `style.css`, `mark.svg` et `src/` ensemble.

- **Dessin** : crayon (B), gomme (E), remplissage (G), pipette (I). Ajustez la
  hauteur dans le panneau de droite. Zoomer permet de voir la grille de mailles.
- **Fils** : sélectionnez, ajoutez ou modifiez un fil dans la palette. Le
  panneau « Par rangée » montre les deux fils et permet d’en remplacer un sur
  toute la rangée. Si un geste ajoute un troisième fil, les rangées concernées
  restent intactes et sont indiquées ; les autres rangées peuvent changer.
- **Image** : choisissez un fichier, déposez-le ou collez-le avec Ctrl/⌘ + V.
  Vous pouvez le placer sur l’affiche ou remplacer toute l’affiche. La
  conversion cherche la paire de fils la plus proche pour chaque rangée.
  En superposition, les mailles existantes hors de l’image ou sous des pixels
  transparents sont préservées ; leurs fils priment sur la paire choisie.
- **Texte** (T) : choisissez une typographie et des dimensions, puis placez le
  texte. Il est transformé en pixels de la couleur active et suit la même
  règle de deux fils. Sur la grille, les flèches et Espace permettent de
  déplacer le curseur et d’utiliser l’outil au clavier.
- **Tricot** : l’aperçu sur carton permet de comparer les proportions des
  mailles et l’aspect mat ou brillant. Le rendu est indicatif.
- **PNG** : l’export est opaque, à taille réelle, avec un pixel par maille,
  dans les couleurs de la palette. Les modes AYAB à deux couleurs pour
  l’image entière attendent un motif en noir et blanc
  ([manuel AYAB](https://manual.ayab-knitting.com/1.0/pattern_image_creation/)).
  Le fichier d’atelier n’encode aucun réglage machine.
- **Projet** : l’atelier enregistre la dernière affiche dans le navigateur.
  Le menu « Projet » permet de télécharger et de rouvrir le fichier JSON
  éditable. Les images importées restent dans le navigateur.

`npm test` vérifie les règles de dessin, de conversion et de sauvegarde.
