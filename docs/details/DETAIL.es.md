# dsh-git-panel

Un panel de Git al estilo IDE en el espacio de trabajo de la conversación: ramas e historial de commits, preparación y commit de cambios, diferencias y un explorador de archivos en una sola pestaña fija, además de un indicador de rama al estilo zsh a la izquierda del cuadro de entrada. No hace falta cambiar a una terminal o a un IDE en mitad de la conversación.

## Funciones

- **Resumen**: lista de ramas y etiquetas, gráfico de historial de commits con búsqueda y detalles del commit; haz clic en un archivo para ver su diferencia en ese commit.
- **Cambios**: preparar y descartar por archivo o en lote, commit y **Amend**, stash y estadísticas de líneas añadidas·eliminadas.
- **Acciones de Git habituales**: cambiar de rama, crear y eliminar etiquetas, revert / reset de commits; las acciones destructivas piden confirmación y los cambios se quedan en el repositorio local, sin push automático.
- **Mensajes de commit generados con IA**: siguen el estilo de los commits existentes del repositorio; el modelo sigue la sesión actual por defecto y se puede fijar en la página de detalles. **La generación envía el contenido del diff al proveedor del modelo elegido.**
- **Indicador de Git en el cuadro de entrada**: `<repositorio> (<rama>)` al estilo zsh, verde cuando está sincronizado y naranja con cambios sin confirmar; un clic abre el panel.
- **Varios repositorios**: detecta automáticamente los worktrees y los repositorios independientes en subdirectorios; tras cambiar, el resumen, los cambios y el indicador actúan sobre el repositorio elegido.
- **Archivos**: explora el árbol de directorios del espacio de trabajo y previsualiza código, Markdown (incluidos diagramas mermaid), HTML e imágenes; también funciona fuera de un repositorio Git.
- **Diferencias y código fuente**: vistas unificada / en paralelo / antes / después con resaltado de sintaxis, énfasis por palabra, expansión de contexto bajo demanda y búsqueda en el sitio con <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Panel estrecho / móvil**: el diseño se adapta al tamaño del panel, así que funciona en la barra lateral y en el teléfono.
- **Idiomas**: la interfaz sigue el idioma del sistema de DSH: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский y Português.

## Repositorio

Código fuente, permisos y límites de datos, y reporte de problemas: <https://github.com/xbzbing/dsh-git-panel>
