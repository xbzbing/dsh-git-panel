# dsh-git-panel

Un panneau Git de style IDE dans l’espace de travail de la conversation : branches et historique des commits, indexation et commit des modifications, différences et explorateur de fichiers réunis dans un onglet permanent, ainsi qu’un indicateur de branche façon zsh à gauche de la zone de saisie. Plus besoin de basculer vers un terminal ou un IDE en pleine conversation.

## Fonctionnalités

- **Vue d’ensemble** : liste des branches et des tags, graphe de l’historique des commits avec recherche et détails du commit ; cliquez sur un fichier pour voir sa différence dans ce commit.
- **Modifications** : indexer et abandonner fichier par fichier ou en lot, commit et **Amend**, remisage (stash) et statistiques de lignes ajoutées·supprimées.
- **Actions Git courantes** : changer de branche, créer et supprimer des tags, revert / reset de commits ; les actions destructives demandent une confirmation, et les modifications restent dans le dépôt local, sans push automatique.
- **Messages de commit générés par IA** : ils suivent le style des commits existants du dépôt ; le modèle suit la session en cours par défaut et peut être fixé sur la page de détails. **La génération envoie le contenu du diff au fournisseur du modèle choisi.**
- **Indicateur Git dans la zone de saisie** : `<dépôt> (<branche>)` façon zsh, vert quand tout est synchronisé et orange en présence de modifications non validées ; un clic ouvre le panneau.
- **Plusieurs dépôts** : les worktrees et les dépôts indépendants des sous-répertoires sont détectés automatiquement ; après un changement, la vue d’ensemble, les modifications et l’indicateur portent sur le dépôt choisi.
- **Fichiers** : parcourez l’arborescence de l’espace de travail et prévisualisez le code, le Markdown (y compris les diagrammes mermaid), le HTML et les images ; fonctionne aussi hors d’un dépôt Git. Les fichiers de configuration et de documentation (json / yaml / xml / properties / md / txt / toml / conf / ini / cfg, `.gitignore`, etc.) se modifient et s’enregistrent sur place.
- **Différences et code source** : vues unifiée / côte à côte / avant / après, avec coloration syntaxique, mise en évidence par mot, contexte dépliable à la demande et recherche sur place avec <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Panneau étroit / mobile** : la mise en page s’adapte à la taille du panneau, dans la barre latérale comme sur téléphone.
- **Langues** : l’interface suit la langue système de DSH : Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский et Português.

## Dépôt

Code source, permissions et limites des données, signalement de problèmes : <https://github.com/xbzbing/dsh-git-panel>
