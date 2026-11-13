# dsh-git-panel

Um painel Git no estilo IDE no espaço de trabalho da conversa: branches e histórico de commits, preparação e commit de alterações, diferenças e um navegador de arquivos em uma única aba fixa, além de um indicador de branch no estilo zsh à esquerda da caixa de entrada. Não é preciso alternar para um terminal ou IDE no meio da conversa.

## Repositório

Código-fonte, permissões e limites de dados, e relato de problemas: <https://github.com/xbzbing/dsh-git-panel>

## Recursos

- **Visão geral**: lista de branches e tags, gráfico do histórico de commits e detalhes do commit; clique em um arquivo para ver a diferença dele. O histórico pesquisa por “mensagem / hash” ou “arquivo / caminho”, junto com filtros de autor, data e branch. A coluna de tempo relativo se ajusta ao idioma da interface e, em um painel estreito, o autor e depois o hash são recolhidos.
- **Alterações**: preparar e descartar por arquivo ou em lote, commit e **Amend**, stash e estatísticas de linhas adicionadas·removidas; a lista alterna entre visão plana e árvore de pastas, com preparação e descarte por pasta.
- **Ações Git comuns**: trocar de branch, criar e excluir tags, revert / reset; ações destrutivas pedem confirmação e nada é enviado automaticamente.
- **Mensagens de commit geradas por IA**: seguem o estilo dos commits existentes do repositório; o modelo segue a sessão atual por padrão e pode ser fixado na página de detalhes. **A geração envia o conteúdo do diff ao provedor do modelo escolhido.**
- **Indicador Git na caixa de entrada**: `<repositório> (<branch>)` no estilo zsh, verde quando sincronizado e laranja com alterações não confirmadas; um clique abre o painel.
- **Vários repositórios**: worktrees e repositórios independentes em subdiretórios são detetados automaticamente; após a troca, a visão geral, as alterações e o indicador atuam sobre o repositório escolhido, e um worktree do próprio repositório da sessão pode ser escolhido onde estiver. Também suporta ficheiros de área de trabalho multiroot do VS Code (`.code-workspace`), ativáveis nas definições do plugin (desativado por omissão).
- **Navegador de arquivos**: pré-visualize código, Markdown (incluindo diagramas mermaid), HTML e imagens, e edite arquivos de configuração no local. Projetos Java/Kotlin dobram caminhos de pacotes por convenção: `src/main/java` vira uma única raiz de código (configurável).
- **Diferenças e código-fonte**: visualizações unificada / lado a lado / antes / depois com realce de sintaxe, destaque por palavra, expansão de contexto sob demanda e busca no local com <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Painel estreito / celular**: o layout se adapta ao tamanho do painel, na barra lateral e no celular.
- **Idiomas**: a interface segue o idioma do sistema do DSH: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский e Português.
- **Menús de contexto**: clique direito em arquivos, diretórios, imagens, branches, commits, alterações e stashes; ações destrutivas continuam pedindo confirmação.
