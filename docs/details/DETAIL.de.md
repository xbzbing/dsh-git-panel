# dsh-git-panel

Ein Git-Panel im IDE-Stil für den Konversations-Arbeitsbereich: Branches und Commit-Verlauf, Stagen und Committen von Änderungen, Diffs und ein Dateibrowser in einem festen Tab, dazu eine Branch-Anzeige im zsh-Stil links neben dem Eingabefeld. Mitten im Gespräch müssen Sie nicht zu einem Terminal oder einer IDE wechseln.

## Funktionen

- **Übersicht**: Branch- und Tag-Liste, Commit-Verlaufsgraph und Commit-Details; ein Klick auf eine Datei zeigt ihren Diff in diesem Commit. Die Historie kann nach „Nachricht / Hash“ oder „Datei / Pfad“ durchsucht werden. Die Datei-/Pfadsuche findet literale Teilzeichenfolgen in historischen Pfaden ohne Unterscheidung der Groß-/Kleinschreibung englischer Buchstaben, einschließlich Dateinamen und Verzeichnisfragmenten; Autor-, Datums- und Branch-Filter lassen sich weiter kombinieren. Sie durchsucht keine Codeinhalte; gelöschte Pfade bleiben auffindbar, Umbenennungen verfolgen den alten Namen nicht automatisch, Git kann Teile der Merge- und Seitenbranch-Historie vereinfachen, und die Commit-Details zeigen weiterhin die vollständige Dateiliste.
- **Änderungen**: einzeln oder gesammelt stagen und verwerfen, Commit und **Amend**, Stash sowie Statistik der hinzugefügten·gelöschten Zeilen.
- **Häufige Git-Aktionen**: Branch wechseln, Tags anlegen und löschen, Commits per revert / reset zurücknehmen; destruktive Aktionen verlangen eine Bestätigung, Änderungen bleiben im lokalen Repository und werden nicht automatisch gepusht.
- **KI-generierte Commit-Nachrichten**: orientieren sich am Stil der vorhandenen Commits des Repositorys; das Modell folgt standardmäßig der aktuellen Sitzung und lässt sich auf der Detailseite festlegen. **Beim Generieren wird der Diff-Inhalt an den Anbieter des gewählten Modells gesendet.**
- **Git-Anzeige im Eingabefeld**: `<Repository> (<Branch>)` im zsh-Stil, grün wenn synchron, orange bei nicht committeten Änderungen; ein Klick öffnet das Panel.
- **Mehrere Repositorys**: Worktrees und eigenständige Repositorys in Unterverzeichnissen werden automatisch erkannt; nach einem Wechsel beziehen sich Übersicht, Änderungen und Eingabefeld-Anzeige auf das gewählte Repository.
- **Dateien**: den Verzeichnisbaum des Arbeitsbereichs durchsuchen und Code, Markdown (einschließlich mermaid-Diagrammen), HTML und Bilder in der Vorschau ansehen; funktioniert auch außerhalb eines Git-Repositorys. Konfigurations- und Dokumentdateien (json / yaml / xml / properties / md / txt / toml / conf / ini / cfg, `.gitignore` u. Ä.) lassen sich direkt bearbeiten und speichern.
- **Diffs und Quelltext**: Ansichten vereinheitlicht / nebeneinander / vorher / nachher mit Syntaxhervorhebung, wortgenauer Hervorhebung, bei Bedarf aufklappbarem Kontext und Suche vor Ort mit <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>.
- **Schmales Panel / Mobilgerät**: das Layout passt sich der Panelgröße an und funktioniert in der Seitenleiste wie auf dem Smartphone.
- **Sprachen**: die Oberfläche folgt der DSH-Systemsprache: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский und Português.

## Repository

Quellcode, Berechtigungen und Datengrenzen sowie Fehlermeldungen: <https://github.com/xbzbing/dsh-git-panel>
