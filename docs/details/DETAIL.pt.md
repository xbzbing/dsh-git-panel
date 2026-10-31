# dsh-git-panel

Um painel Git no estilo IDE no espaço de trabalho da conversa: branches e histórico de commits, preparação e commit de alterações, diferenças e um navegador de arquivos em uma única aba fixa, além de um indicador de branch no estilo zsh à esquerda da caixa de entrada. Não é preciso alternar para um terminal ou IDE no meio da conversa.

## Recursos

- **Visão geral**: lista de branches e tags, gráfico de histórico de commits com busca e detalhes do commit; clique em um arquivo para ver a diferença dele nesse commit.
- **Alterações**: preparar e descartar por arquivo ou em lote, commit e **Amend**, stash e estatísticas de linhas adicionadas·removidas.
- **Ações Git comuns**: trocar de branch, criar e excluir tags, revert / reset de commits; ações destrutivas pedem confirmação, e as alterações ficam no repositório local, sem push automático.
- **Mensagens de commit geradas por IA**: seguem o estilo dos commits existentes do repositório; o modelo segue a sessão atual por padrão e pode ser fixado na página de detalhes. **A geração envia o conteúdo do diff ao provedor do modelo escolhido.**
- **Indicador Git na caixa de entrada**: `<repositório> (<branch>)` no estilo zsh, verde quando sincronizado e laranja com alterações não confirmadas; um clique abre o painel.
- **Vários repositórios**: worktrees e repositórios independentes em subdiretórios são detectados automaticamente; após a troca, a visão geral, as alterações e o indicador passam a atuar sobre o repositório escolhido.
- **Arquivos**: navegue pela árvore de diretórios do espaço de trabalho e pré-visualize código, Markdown (incluindo diagramas mermaid), HTML e imagens; também funciona fora de um repositório Git.
- **Diferenças e código-fonte**: visualizações unificada / lado a lado / antes / depois com realce de sintaxe, destaque por palavra, expansão de contexto sob demanda e busca no local com <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Painel estreito / celular**: o layout se adapta ao tamanho do painel e funciona na barra lateral e no celular.
- **Idiomas**: a interface segue o idioma do sistema do DSH: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский e Português.

## Repositório

Código-fonte, permissões e limites de dados, e relato de problemas: <https://github.com/xbzbing/dsh-git-panel>
