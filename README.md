# CEPROC - Examen blanc CQP pizzaïolo

Prototype pédagogique proposé au CEPROC, Centre d’Excellence des Professions Culinaires. Ce projet et ses sujets ne sont pas une publication officielle de l’école ; ils sont à relire et à valider par ses formateurs avant un usage officiel.

L’interface reprend le [logo officiel du CEPROC](https://www.ceproc.com/wp-content/themes/ceproc/images/logo-min-ceproc.png), qui reste la propriété de l’école. Sa palette reprend les couleurs du [site officiel](https://www.ceproc.com/) : `#364991`, `#0c3686`, `#f6f1eb` et `#c43013`.

## Utiliser les examens

Ouvrir le site publié, choisir l’un des dix sujets, répondre puis sélectionner **Afficher les résultats**.

Chaque sujet comporte **17 questions sur 50 points**. Le résultat de cet entraînement est **REÇU à partir de 40/50 inclus**, et **NON REÇU en dessous de 40/50**. La correction indique la note, le nombre de questions entièrement réussies, les réponses données, les bonnes réponses et les explications. Les points partiels et les pénalités de choix multiples sont expliqués avant les questions. Le chronomètre de 45 minutes est indicatif.

Le bouton **Télécharger le pack complet** fournit la version HTML hors connexion, les dix PDF remplissables et leur corrigé séparé. Le téléchargement est également intégré à la page pour rester disponible sur un hébergement statique.

## Fichiers du site

- `index.html` : application autonome, données des dix sujets et correction automatique.
- `pdf/` : dix sujets PDF remplissables et le corrigé détaillé.
- `telechargements/Pack_examens_blancs_CQP_CEPROC.zip` : pack pour les apprenants.
- `.nojekyll` : publication directe des fichiers statiques sur GitHub Pages.

Le site utilise uniquement HTML, CSS et JavaScript. Aucun serveur applicatif, base de données, secret ni abonnement ChatGPT n’est nécessaire pour le faire fonctionner. Les liens vers les ressources officielles sont des références facultatives, sans dépendance pour la notation.

## Réponses et progression

Les réponses sont sauvegardées dans le navigateur lorsque celui-ci le permet. Le site ne transmet pas les réponses à un serveur et ne fournit pas de suivi centralisé des apprenants. **Exporter / Importer** permet de reprendre la progression sur un autre appareil ou navigateur. Une exportation préalable est nécessaire avant un changement de domaine.

Les bonnes réponses sont présentes dans le code pour permettre la correction locale. Cet outil convient à l’entraînement et n’est pas un système d’épreuve surveillée sécurisé.

## Publication sur GitHub Pages

Le dépôt contient directement le contenu à publier. Dans les réglages GitHub Pages, utiliser **Deploy from a branch**, la branche contenant ces fichiers et le répertoire **/(root)**. Conserver la structure relative `pdf/` et `telechargements/`.

GitHub Pages est disponible gratuitement pour les dépôts publics sur GitHub Free, dans les limites applicables. L’hébergement dépend de GitHub, pas de l’abonnement ChatGPT. Il reste disponible tant que le dépôt et GitHub Pages sont maintenus actifs et que les conditions du service sont respectées.

- [GitHub Pages et disponibilité des offres](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Configurer la source de publication](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Remise et reprise par l’école

Le dossier de remise complet fourni séparément inclut les sources éditables, les données des questions et les scripts de reconstruction du site et des PDF. L’école peut reprendre ces éléments sur son hébergement statique ou son propre compte GitHub.

Un transfert du dépôt vers un compte ou une organisation GitHub de l’école est possible avec les droits nécessaires et l’accord du destinataire. L’adresse GitHub Pages dépend du propriétaire et du nom du dépôt : les adresses GitHub Pages ne sont pas automatiquement redirigées après un transfert. Il faut donc vérifier la publication et communiquer la nouvelle adresse.

[Transférer un dépôt GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)

## Portée du contenu

Les recettes, chiffres et situations sont fictifs. Le seuil de 40/50 est celui demandé pour cet entraînement et ne constitue pas une décision du jury. Les références officielles figurent dans l’application et le corrigé ; les formateurs doivent vérifier le contenu et les protocoles applicables avant tout usage officiel.
