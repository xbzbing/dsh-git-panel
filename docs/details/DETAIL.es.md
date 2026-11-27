# dsh-git-panel

Un panel de Git al estilo IDE en el espacio de trabajo de la conversación: ramas e historial de commits, preparación y commit de cambios, diferencias y un explorador de archivos en una sola pestaña fija, además de un indicador de rama al estilo zsh a la izquierda del cuadro de entrada. No hace falta cambiar a una terminal o a un IDE en mitad de la conversación.

## Repositorio

Código fuente, permisos y límites de datos, y reporte de problemas: <https://github.com/xbzbing/dsh-git-panel>

## Funciones

- **Resumen**: lista de ramas y etiquetas, gráfico del historial de commits y detalles del commit; haz clic en un archivo para ver su diferencia. El historial se busca por «mensaje / hash» o «archivo / ruta», junto con filtros de autor, fecha y rama. La columna de tiempo relativo se ajusta al idioma de la interfaz y, en un panel estrecho, primero se retira el autor y luego el hash.
- **Cambios**: preparar y descartar por archivo o en lote, commit y **Amend**, stash y estadísticas de líneas añadidas·eliminadas; la lista alterna entre vista plana y de carpetas, con preparación y descarte por carpeta.
- **Acciones Git habituales**: cambiar de rama, crear y eliminar etiquetas, revert / reset; las acciones destructivas piden confirmación y nada se envía automáticamente.
- **Git Flow**: iniciar, integrar y finalizar ramas Feature, Release y Hotfix con las convenciones `develop` y `main` / `master`.
- **Mensajes de commit con IA**: por defecto, siguen el estilo de los commits existentes del repositorio y usan el modelo de la sesión actual, que puede fijarse en la página de detalles. Puedes personalizar las reglas de commit y consultar en diálogos el prompt predeterminado integrado y las instrucciones finales de la configuración guardada. **La generación envía el diff y las reglas personalizadas al proveedor del modelo elegido; consultar los prompts no llama al modelo.**
- **Indicador Git en el cuadro de entrada**: `<repositorio> (<rama>)` al estilo zsh, verde si está sincronizado y naranja con cambios sin confirmar; un clic abre el panel.
- **Varios repositorios**: los worktrees y los repositorios independientes en subdirectorios se detectan automáticamente; tras el cambio, el resumen, los cambios y el indicador actúan sobre el repositorio elegido, y un worktree del propio repositorio de la sesión se puede cambiar esté donde esté. También admite archivos de área de trabajo multiroot de VS Code (`.code-workspace`), que se activan en los ajustes del plugin (desactivado por omisión).
- **Explorador de archivos**: previsualiza código, Markdown (incluidos diagramas mermaid), HTML e imágenes, y permite editar los archivos de configuración en el sitio. Los proyectos Java/Kotlin pliegan las rutas de paquetes por convención: `src/main/java` pasa a ser una sola raíz de código (configurable). Al leer Markdown, un índice flotante en la esquina superior derecha empieza plegado en un botón «Índice» y se abre con un clic; abierto marca la sección actual y salta a ella al hacer clic, y se repliega en el botón o se cierra (no queda nada; al reabrir el archivo vuelve el botón). El lector a pantalla completa crece con la pantalla.
- **Diferencias y código fuente**: vistas unificada / lado a lado / antes / después con resaltado de sintaxis, énfasis por palabra, contexto desplegable a demanda y búsqueda en el sitio con <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>. El diálogo de diferencias del commit añade una vista **Archivo** de solo lectura y permite copiar el contenido completo de esa versión (estrictamente por debajo de 10 MiB).
- **Panel estrecho / móvil**: el diseño se adapta al tamaño del panel, tanto en la barra lateral como en el teléfono.
- **Idiomas**: la interfaz sigue el idioma del sistema de DSH: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский y Português.
- **Menús contextuales**: clic derecho en archivos, directorios, imágenes, ramas, commits, cambios y stashes; las acciones destructivas siguen pidiendo confirmación.
