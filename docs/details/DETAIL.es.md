# dsh-git-panel

Un panel de Git al estilo IDE en el espacio de trabajo de la conversación: ramas e historial de commits, preparación y commit de cambios, diferencias y un explorador de archivos en una sola pestaña fija, además de un indicador de rama al estilo zsh a la izquierda del cuadro de entrada. No hace falta cambiar a una terminal o a un IDE en mitad de la conversación.

## Funciones

- **Resumen**: lista de ramas y etiquetas, gráfico del historial de commits y detalles del commit; haz clic en un archivo para ver su diferencia en ese commit. El historial admite búsqueda por «mensaje / hash» y «archivo / ruta». La búsqueda por archivo / ruta busca subcadenas literales en las rutas históricas sin distinguir mayúsculas y minúsculas en letras inglesas, incluidos nombres de archivo y fragmentos de directorio; los filtros de autor, fecha y rama se combinan con ella. No busca el contenido del código; las rutas eliminadas siguen siendo buscables, los cambios de nombre no siguen automáticamente el nombre anterior, Git puede simplificar parte del historial de fusiones y ramas laterales, y los detalles del commit siguen mostrando la lista completa de archivos.
- **Cambios**: preparar y descartar por archivo o en lote, commit y **Amend**, stash y estadísticas de líneas añadidas·eliminadas; la lista alterna entre vista plana y de carpetas, con recuento por carpeta y preparación / descarte por carpeta — plano por defecto y configurable en la configuración del plugin.
- **Acciones de Git habituales**: cambiar de rama, crear y eliminar etiquetas, revert / reset de commits; las acciones destructivas piden confirmación y los cambios se quedan en el repositorio local, sin push automático.
- **Mensajes de commit generados con IA**: siguen el estilo de los commits existentes del repositorio; el modelo sigue la sesión actual por defecto y se puede fijar en la página de detalles. **La generación envía el contenido del diff al proveedor del modelo elegido.**
- **Indicador de Git en el cuadro de entrada**: `<repositorio> (<rama>)` al estilo zsh, verde cuando está sincronizado y naranja con cambios sin confirmar; un clic abre el panel.
- **Varios repositorios**: detecta automáticamente los worktrees y los repositorios independientes en subdirectorios; tras cambiar, el resumen, los cambios y el indicador actúan sobre el repositorio elegido.
- **Archivos**: explora el árbol de directorios del espacio de trabajo y previsualiza código, Markdown (incluidos diagramas mermaid), HTML e imágenes; también funciona fuera de un repositorio Git. Los archivos de configuración y documentación (json / yaml / xml / properties / md / txt / toml / conf / ini / cfg, `.gitignore` y similares) se pueden editar y guardar en el sitio.
- **Diferencias y código fuente**: vistas unificada / en paralelo / antes / después con resaltado de sintaxis, énfasis por palabra, expansión de contexto bajo demanda y búsqueda en el sitio con <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Panel estrecho / móvil**: el diseño se adapta al tamaño del panel, así que funciona en la barra lateral y en el teléfono.
- **Idiomas**: la interfaz sigue el idioma del sistema de DSH: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский y Português.
- **Menús contextuales**: clic derecho sobre archivos, directorios, imágenes, ramas, commits, cambios y stashes para copiar rutas, mostrarlos en el gestor de archivos, descargar / guardar como, aplicar al índice o descartar, cambiar de rama, crear etiquetas, revertir o restablecer, citar en el compositor o comprobar el remoto; las acciones destructivas piden confirmación.

## Repositorio

Código fuente, permisos y límites de datos, y reporte de problemas: <https://github.com/xbzbing/dsh-git-panel>
