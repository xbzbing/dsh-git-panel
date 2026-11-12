# dsh-git-panel

Ein Git-Panel im IDE-Stil für den Konversations-Arbeitsbereich: Branches und Commit-Verlauf, Stagen und Committen von Änderungen, Diffs und ein Dateibrowser in einem festen Tab, dazu eine Branch-Anzeige im zsh-Stil links neben dem Eingabefeld. Mitten im Gespräch müssen Sie nicht zu einem Terminal oder einer IDE wechseln.

## Repository

Quellcode, Berechtigungen und Datengrenzen sowie Fehlermeldungen: <https://github.com/xbzbing/dsh-git-panel>

## Funktionen

- **Übersicht**: Branch- und Tag-Liste, Commit-Verlaufsgraph und Commit-Details; ein Klick auf eine Datei zeigt ihren Diff. Die Historie lässt sich nach „Nachricht / Hash“ oder „Datei / Pfad“ durchsuchen, zusammen mit Autor-, Datums- und Branch-Filtern. Die Spalte für die relative Zeit richtet sich nach der Oberflächensprache, und ein schmales Panel blendet zuerst den Autor, dann den Hash aus.
- **Änderungen**: einzeln oder gesammelt stagen und verwerfen, Commit und **Amend**, Stash, Statistik hinzugefügter·gelöschter Zeilen; die Liste wechselt zwischen flacher Ansicht und Ordnerbaum, inklusive Stagen und Verwerfen je Ordner.
- **Häufige Git-Aktionen**: Branch wechseln, Tags anlegen und löschen, revert / reset; destruktive Aktionen verlangen eine Bestätigung, und nichts wird automatisch gepusht.
- **KI-generierte Commit-Nachrichten**: orientieren sich am Stil der vorhandenen Commits des Repositorys; das Modell folgt standardmäßig der aktuellen Sitzung und lässt sich auf der Detailseite festlegen. **Beim Generieren wird der Diff-Inhalt an den Anbieter des gewählten Modells gesendet.**
- **Git-Anzeige im Eingabefeld**: `<Repository> (<Branch>)` im zsh-Stil, grün wenn synchron, orange bei nicht committeten Änderungen; ein Klick öffnet das Panel.
- **Mehrere Repositorys**: Worktrees und eigenständige Repositorys in Unterverzeichnissen werden automatisch erkannt; nach einem Wechsel beziehen sich Übersicht, Änderungen und Anzeige auf das gewählte Repository.
- **Dateibrowser**: Code, Markdown (inklusive mermaid-Diagrammen), HTML und Bilder in der Vorschau ansehen und Konfigurationsdateien direkt bearbeiten. Java/Kotlin-Projekte falten Paketpfade nach Konvention: `src/main/java` wird zu einer Quellwurzel (in den Einstellungen abschaltbar).
- **Diffs und Quelltext**: Ansichten vereinheitlicht / nebeneinander / vorher / nachher mit Syntaxhervorhebung, wortgenauer Hervorhebung, aufklappbarem Kontext und Suche vor Ort mit <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Schmales Panel / Mobilgerät**: das Layout passt sich der Panelgröße an und funktioniert in der Seitenleiste wie auf dem Smartphone.
- **Sprachen**: die Oberfläche folgt der DSH-Systemsprache: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский und Português.
- **Kontextmenüs**: Rechtsklick auf Dateien, Verzeichnisse, Bilder, Branches, Commits, Änderungen und Stashes; destruktive Aktionen fragen weiterhin nach.
