# dsh-git-panel

Un panneau Git de style IDE dans l’espace de travail de la conversation : branches et historique des commits, indexation et commit des modifications, différences et explorateur de fichiers réunis dans un onglet permanent, ainsi qu’un indicateur de branche façon zsh à gauche de la zone de saisie. Plus besoin de basculer vers un terminal ou un IDE en pleine conversation.

## Dépôt

Code source, permissions et limites des données, signalement de problèmes : <https://github.com/xbzbing/dsh-git-panel>

## Fonctionnalités

- **Vue d’ensemble** : liste des branches et des tags, graphe de l’historique des commits et détails du commit ; un clic sur un fichier affiche sa différence. L’historique se recherche par « message / hash » ou « fichier / chemin », avec les filtres d’auteur, de date et de branche. La colonne du temps relatif s’ajuste à la langue de l’interface et, dans un panneau étroit, l’auteur puis le hash sont retirés.
- **Modifications** : indexer et abandonner fichier par fichier ou en lot, commit et **Amend**, remisage (stash), statistiques de lignes ajoutées·supprimées ; la liste bascule entre vue à plat et arborescence, avec indexation et abandon par dossier.
- **Actions Git courantes** : changer de branche, créer et supprimer des tags, revert / reset ; les actions destructives demandent une confirmation et rien n’est poussé automatiquement.
- **Messages de commit générés par IA** : ils suivent le style des commits existants du dépôt ; le modèle suit la session en cours par défaut et peut être fixé sur la page de détails. **La génération envoie le contenu du diff au fournisseur du modèle choisi.**
- **Indicateur Git dans la zone de saisie** : `<dépôt> (<branche>)` façon zsh, vert quand tout est synchronisé et orange en présence de modifications non validées ; un clic ouvre le panneau.
- **Plusieurs dépôts** : les worktrees et les dépôts indépendants des sous-répertoires sont détectés automatiquement ; après un changement, la vue d’ensemble, les modifications et l’indicateur portent sur le dépôt choisi.
- **Explorateur de fichiers** : prévisualisez le code, le Markdown (diagrammes mermaid compris), le HTML et les images, et modifiez les fichiers de configuration sur place. Les projets Java/Kotlin replient les chemins de paquets par convention : `src/main/java` devient une seule racine de sources (désactivable dans la configuration).
- **Différences et code source** : vues unifiée / côte à côte / avant / après, avec coloration syntaxique, mise en évidence par mot, contexte dépliable à la demande et recherche sur place avec <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Panneau étroit / mobile** : la mise en page s’adapte à la taille du panneau, dans la barre latérale comme sur téléphone.
- **Langues** : l’interface suit la langue système de DSH : Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский et Português.
- **Menus contextuels** : clic droit sur les fichiers, répertoires, images, branches, commits, modifications et stashes ; les actions destructives demandent toujours une confirmation.
