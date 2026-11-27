# Entwurf Datenschutzinformation Anwesenheit und optionale Standortfreigabe

## Zweck und Geltungsbereich

Dieser Entwurf beschreibt eine künftig mögliche Verarbeitung im Zusammenhang mit der manuellen Erfassung von Arbeitsbeginn und Arbeitsende sowie einer optionalen, aktiv gestarteten Standortfreigabe. Er ist vor einer produktiven Aktivierung durch die Geschäftsführung, eine Datenschutzfachperson und gegebenenfalls den Betriebsrat zu prüfen. Er stellt keine Rechtsberatung dar und bestätigt keine Rechtsgrundlage.

Die aktuell produktive Anwendung darf keine tatsächlichen GPS-Daten verarbeiten. Die vorhandene Standortfunktion ist ausschließlich eine technische Simulation im isolierten Testsystem.

## Arbeitsbeginn und Arbeitsende ohne Standortdaten

Für die Anwesenheitserfassung werden nur die manuelle Bestätigung durch die beschäftigte Person, Zeitpunkt von Check-in und Check-out, der zugeordnete Einsatz beziehungsweise Auftrag, die Mitarbeiterkennung, ein optionaler Hinweis sowie der erzeugte Arbeitszeitnachweis verarbeitet. Die Erfassung bleibt auch dann möglich, wenn kein Standort verfügbar ist. Eine fehlende Standortfreigabe darf nicht automatisch zur Ablehnung einer plausiblen Arbeitszeit führen.

Zweck ist die organisatorische Zuordnung von Arbeitszeiten zu Einsätzen, die Einsatzplanung, die Abrechnung und die nachvollziehbare Dokumentation betrieblicher Arbeitsleistungen. Vor dem produktiven Start ist zu dokumentieren, welche dieser Zwecke erforderlich sind, welche Rechtsgrundlage tragfähig ist und ob arbeitsrechtliche Regelungen gelten.

## Optionale Standortfreigabe

Eine künftige Standortfreigabe darf nur nach einer gesonderten Freigabe eingeführt werden. Sie muss aktiv durch die beschäftigte Person gestartet und jederzeit manuell beendet werden können. Sie darf nicht automatisch nach Login, im Hintergrund oder nach Ende eines Einsatzes starten. Das Beenden einer Standortfreigabe darf die Arbeitszeit nicht automatisch beenden.

Der vorgesehene Zweck wäre ausschließlich eine aktuelle Einsatzkoordination während eines offenen, zugewiesenen Einsatzes. Eine Routenaufzeichnung, Bewegungsverlauf, Leistungskontrolle außerhalb des Einsatzes oder dauerhafte Überwachung sind nicht vorgesehen. Vor Freigabe ist nachzuweisen, dass eine weniger eingriffsintensive Alternative nicht ausreicht.

## Datenkategorien

| Verarbeitung | Datenkategorien |
| --- | --- |
| Anwesenheit | Mitarbeiterkennung, Einsatz- und Auftragsbezug, Check-in, Check-out, optionale manuelle Hinweise, Status, Arbeitszeitnachweis |
| Optionale Standortfreigabe | Mitarbeiterkennung, zugeordneter Einsatz, aktueller Standort, Genauigkeit, Zeitpunkt der Aktualisierung, Freigabestatus, Ablaufzeitpunkt |
| Sicherheits- und Prüfprotokolle | Ereignistyp, Zeit, berechtigte Rolle, betroffene technische Entität; keine Rohkoordinaten in Audit-Metadaten |

Es sind keine Standortverläufe oder Routen zu speichern. Ein Standortdatensatz darf nur den aktuellen, für einen aktiven Einsatz erforderlichen Wert enthalten.

## Zugriff und Berechtigungen

| Rolle | Zulässiger Zugriff |
| --- | --- |
| Beschäftigte Person | Eigene Anwesenheit; eigener Freigabestatus; Start und Ende einer eigenen, optionalen Freigabe |
| ADMIN | Anwesenheitsübersicht und – nur nach gesonderter Freigabe – aktuelle Standorte zugewiesener aktiver Einsätze |
| MANAGER | Keine zusätzlichen Rechte; bleibt auf bestehende Mitarbeiterrechte beschränkt |
| CUSTOMER | Kein Zugriff auf Anwesenheit oder Standortdaten |

Zugriffe sind serverseitig zu prüfen. Clientseitige Menüs oder ausgeblendete Buttons sind keine Berechtigungskontrolle.

## Löschung und Aufbewahrung

Für aktuelle Standortdaten gilt als technisches Minimum:

- Löschung beim manuellen Stoppen der Freigabe;
- automatische Löschung beim Ablauf der Freigabe oder bei Ende des aktiven Einsatzes;
- keine Standort-Historie;
- keine Rohkoordinaten in Audit-Protokollen.

Die Aufbewahrungsfrist für Anwesenheits- und Arbeitszeitdaten muss getrennt festgelegt werden. Sie richtet sich nach dem dokumentierten Zweck sowie arbeits-, steuer- und handelsrechtlichen Pflichten. Die konkrete Frist, ein Löschkonzept, Sperrfristen und ein Verfahren für Auskunfts- und Löschanfragen sind vor Produktivbetrieb durch Legal/DPO festzulegen.

## Erforderlichkeit und Verhältnismäßigkeit

Vor einer realen Standortverarbeitung ist mindestens zu beantworten:

1. Welcher konkrete Einsatzprozess kann ohne Standort nicht zuverlässig organisiert werden?
2. Reichen Terminplanung, telefonische Abstimmung, Check-in ohne Standort oder eine manuelle Einsatzbestätigung aus?
3. Ist die Freigabe zeitlich auf aktive Einsätze begrenzt?
4. Welche Folgen hätte eine Ablehnung der Freigabe für Beschäftigte?
5. Ist die Genauigkeit auf das erforderliche Minimum begrenzt?
6. Wer benötigt die Information konkret und wie wird Missbrauch erkannt?

Wenn ein milderes Mittel den Zweck erfüllt, darf eine kontinuierliche Standortfreigabe nicht aktiviert werden.

## Art 13 DSGVO Information – Inhalte zur Prüfung

Vor einer Aktivierung müssen Beschäftigte in klarer Sprache mindestens über Verantwortliche Stelle, Kontakt Datenschutz, Zwecke, Rechtsgrundlage, Datenkategorien, Empfänger, Speicherdauer, Rechte, Beschwerderecht, mögliche Pflicht zur Bereitstellung und die Folgen einer Nichtbereitstellung informiert werden. Für eine Standortfreigabe sind außerdem Aktivierung, Deaktivierung, keine Hintergrundortung, keine Routenhistorie, technische Ablaufzeit und manuelle Alternative ausdrücklich zu erklären.

## DPIA Screening Checkliste

| Prüffrage | Vor Aktivierung zu dokumentieren |
| --- | --- |
| Systematische Überwachung Beschäftigter? | Ja/Nein, Begründung |
| Umfang, Dauer und räumlicher Bereich begrenzt? | Ja/Nein, technische Nachweise |
| Besonders schutzwürdige Orte oder Zeiten betroffen? | Risikoanalyse und Schutzmaßnahmen |
| Kombination mit Leistungs- oder Verhaltenskontrolle möglich? | Verbot, technische und organisatorische Kontrollen |
| Hohe Risiken trotz Maßnahmen möglich? | DPIA erforderlich, gegebenenfalls Aufsichtsbehörde einbeziehen |
| Datenschutz-Folgenabschätzung abgeschlossen? | Freigabe durch zuständige Stelle erforderlich |

## Betriebsrat Checkliste

Vor Einsatz im Betrieb ist zu klären, ob ein Betriebsrat besteht und ob Mitbestimmungsrechte betroffen sind. Zu dokumentieren sind mindestens Zweck, betroffene Personengruppen, Aktivierungslogik, Empfänger, Speicherfristen, Auswertungsausschlüsse, manuelle Alternative, Kontrollrechte und Beschwerdeweg. Ohne erforderliche Beteiligung darf keine produktive Aktivierung erfolgen.

## Freigabevoraussetzungen

Eine reale Standortfunktion darf erst aktiviert werden, wenn alle folgenden Punkte schriftlich bestätigt sind:

- dokumentierter betrieblicher Zweck und Verhältnismäßigkeitsentscheidung;
- geprüfte Rechtsgrundlage;
- aktualisierte Beschäftigteninformation;
- festgelegtes Lösch- und Berechtigungskonzept;
- DPIA-Screening und gegebenenfalls DPIA;
- DPO/Legal-Freigabe;
- Betriebsratsbeteiligung, sofern anwendbar;
- HTTPS- und Produktionssicherheitsprüfung;
- dokumentierter Rollback- und Incident-Prozess.
