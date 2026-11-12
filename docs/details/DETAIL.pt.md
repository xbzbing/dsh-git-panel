# dsh-git-panel

Um painel Git no estilo IDE no espaço de trabalho da conversa: branches e histórico de commits, preparação e commit de alterações, diferenças e um navegador de arquivos em uma única aba fixa, além de um indicador de branch no estilo zsh à esquerda da caixa de entrada. Não é preciso alternar para um terminal ou IDE no meio da conversa.

## Recursos

- **Visão geral**: lista de branches e tags, gráfico do histórico de commits e detalhes do commit; clique em um arquivo para ver a diferença dele nesse commit. O histórico permite pesquisar por “mensagem / hash” ou “arquivo / caminho”. A pesquisa por arquivo / caminho encontra substrings literais nos caminhos históricos sem diferenciar maiúsculas e minúsculas de letras inglesas, incluindo nomes de arquivos e trechos de diretórios; os filtros de autor, data e branch continuam combináveis. Ela não pesquisa o conteúdo do código; caminhos excluídos continuam pesquisáveis, renomeações não seguem automaticamente o nome antigo, o Git pode simplificar parte do histórico de merges e branches secundários, e os detalhes do commit continuam mostrando a lista completa de arquivos.
- **Alterações**: preparar e descartar por arquivo ou em lote, commit e **Amend**, stash e estatísticas de linhas adicionadas·removidas; a lista alterna entre visão plana e árvore de pastas, com contagem por pasta e preparação / descarte por pasta — plano por padrão, com a visão configurável nas configurações do plugin.
- **Ações Git comuns**: trocar de branch, criar e excluir tags, revert / reset de commits; ações destrutivas pedem confirmação, e as alterações ficam no repositório local, sem push automático.
- **Mensagens de commit geradas por IA**: seguem o estilo dos commits existentes do repositório; o modelo segue a sessão atual por padrão e pode ser fixado na página de detalhes. **A geração envia o conteúdo do diff ao provedor do modelo escolhido.**
- **Indicador Git na caixa de entrada**: `<repositório> (<branch>)` no estilo zsh, verde quando sincronizado e laranja com alterações não confirmadas; um clique abre o painel.
- **Vários repositórios**: worktrees e repositórios independentes em subdiretórios são detectados automaticamente; após a troca, a visão geral, as alterações e o indicador passam a atuar sobre o repositório escolhido.
- **Arquivos**: navegue pela árvore de diretórios do espaço de trabalho e pré-visualize código, Markdown (incluindo diagramas mermaid), HTML e imagens; também funciona fora de um repositório Git. Arquivos de configuração e documentação (json / yaml / xml / properties / md / txt / toml / conf / ini / cfg, `.gitignore` e semelhantes) podem ser editados e salvos no local. Projetos Java/Kotlin também dobram caminhos de pacotes por convenção: `src/main/java` vira uma única raiz de código e uma sequência de diretórios de pacote com um único filho é mesclada em uma linha `com.example…` (ativado por padrão; pode ser desativado nas configurações do plugin).
- **Diferenças e código-fonte**: visualizações unificada / lado a lado / antes / depois com realce de sintaxe, destaque por palavra, expansão de contexto sob demanda e busca no local com <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Painel estreito / celular**: o layout se adapta ao tamanho do painel e funciona na barra lateral e no celular.
- **Idiomas**: a interface segue o idioma do sistema do DSH: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский e Português.
- **Menús de contexto** — clique direito em arquivos, diretórios, imagens, ramos, commits, alterações e stashes para copiar caminhos, revelar no gerenciador de arquivos, baixar / salvar como, aplicar ao índice ou descartar, trocar de ramo, criar tags, reverter ou redefinir, citar no compositor ou verificar o remoto; ações destrutivas pedem confirmação.

## Repositório

Código-fonte, permissões e limites de dados, e relato de problemas: <https://github.com/xbzbing/dsh-git-panel>
