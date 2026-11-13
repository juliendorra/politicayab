# POLITICAYAB

Un atelier web pour créer des affiches politiques tricotées. Le document fait
toujours **180 pixels de large** et chaque rangée utilise **au plus deux fils**.
La palette peut contenir d’autres fils pour les rangées suivantes.

```sh
npm start
```

Ouvrir [l’atelier](http://127.0.0.1:4173/). La commande affiche l’adresse si
l’atelier tourne déjà. Le premier lancement reste actif dans son terminal
jusqu’à `Ctrl+C`. Node.js 22 suffit, sans dépendance à installer.
Le projet est un site statique : un hébergeur peut servir
`index.html`, `style.css`, `mark.svg` et `src/` ensemble.

Le workflow [Deploy to OVH](.github/workflows/deploy.yml) publie ces fichiers
depuis `main` vers [juliendorra.com/politicayab/](https://juliendorra.com/politicayab/).
Il utilise les secrets GitHub Actions `FTP_SERVER`, `FTP_USER` et
`FTP_PASSWORD`. Le compte OVH doit avoir `www/politicayab` comme dossier racine,
ce qui correspond à `./` dans le workflow. Le workflow peut aussi être lancé
manuellement depuis GitHub Actions.

- **Dessin** : crayon (B), gomme (E), remplissage (G), pipette (I). Ajustez la
  hauteur dans le panneau de droite. Zoomer permet de voir la grille de mailles.
  Avec **Remplir**, choisissez un aplat, un damier, des pois, des rayures ou
  des diagonales. Le motif se répète à partir de la maille cliquée dans la zone
  contiguë. Ses espaces gardent la couleur d’origine.
- **Fils** : sélectionnez, ajoutez ou modifiez un fil dans la palette. Si une
  teinte du [nuancier Temperature Blanket](src/data/yarn-swatches.SOURCE.md)
  est proche, l’atelier propose son nom et affiche la marque et la gamme.
  « Utiliser cette teinte » applique le code couleur du nuancier. Pour les
  autres teintes, l’atelier propose le nom le plus proche parmi les 32 004 noms
  de [Color Names](https://github.com/meodai/color-names/tree/471fb3a6812d3943e99ef4bcc25b99eb77c4b502)
  ([licence MIT](src/data/color-names.LICENSE)). Le nom reste modifiable. Le
  panneau « Par rangée » montre les deux fils et permet d’en remplacer un sur
  toute la rangée. Si un geste ajoute un troisième fil, les rangées concernées
  restent intactes et sont indiquées ; les autres rangées peuvent changer.
  Dans le menu d’un fil, **Supprimer le fil** permet de le retirer de la palette.
  S’il est utilisé, choisissez le fil qui le remplace. La suppression peut
  être annulée avec l’historique.
- **Objets** : choisissez, déposez ou collez une image avec Ctrl/⌘ + V,
  ou ajoutez un texte avec T. Avec **Sélection** (V), cliquez sur un objet
  dans l’affiche ou dans la liste. Glissez-le pour le déplacer et tirez un coin
  pour changer sa taille. Les images gardent leurs proportions tant que
  « Conserver les proportions » est cochée. Les réglages de fils et de typographie restent
  accessibles. Glissez les objets dans la liste pour changer leur ordre,
  avec le premier plan en haut. La liste permet de dupliquer ou de supprimer
  chaque objet. Une copie se place au même endroit, juste au-dessus de son
  original, et reste éditable. Les changements valides sont sauvegardés
  au fur et à mesure. Cliquez à côté pour désélectionner. La conversion des
  images tient compte des fils déjà présents hors de l’image et sous les
  pixels transparents. Avec deux fils choisis, les échantillons indiquent
  les tons foncés et clairs. « Inverser les fils » les échange.
- **Grain** : réglez l’intensité pour disperser des points sur toute
  l’affiche. Dans une zone de rangées unies, le mode automatique cherche
  au-dessus et en dessous les mélanges qui partagent sa couleur. Les rangées
  proches et les mélanges bien présents pèsent davantage. Vous pouvez aussi
  choisir le fil dans le panneau Grain. Les rangées bicolores conservent leurs
  deux fils. Le grain est appliqué avant la correction des flottés.
- **Flottés** : activez les points d’accroche et choisissez la séquence
  maximale en mailles. L’atelier répartit des points de l’autre fil sur les
  longues séquences des rangées à deux fils, bords compris. Le réglage
  s’applique à l’affiche affichée et au PNG. Le projet garde le dessin
  d’origine pour permettre de changer de seuil ou de désactiver les points.
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
