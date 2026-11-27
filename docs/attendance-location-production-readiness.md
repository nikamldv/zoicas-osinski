# Produktionscheckliste Anwesenheit und optionale Standortfreigabe

## Status

Die Anwesenheitsfunktion und die Standort-Simulation wurden technisch im isolierten Testsystem geprüft. Die Standort-Simulation ist kein GPS-Produktivfeature. Diese Checkliste ist eine technische Vorbereitung und keine Freigabe zur Verarbeitung realer Standortdaten.

## Technische Restpunkte

- Die Sitzungsprüfung lehnt ungültige Sitzungen ab; ein beschleunigter Laufzeittest für den tatsächlichen Ablauf der konfigurierten Session-TTL steht noch aus.
- Die Standort-Simulation ist ausdrücklich auf `.env.test`, Datenbank `zoicas_osinski_test` und Port `3001` begrenzt.
- Der aktuelle Admin-Kartenbereich ist eine schematische HTML/CSS-Visualisierung mit relativer Markerpositionierung. Er ist keine geographisch präzise Karte.
- Keine reale Browser-Geolocation, keine Hintergrundortung und keine externe Karten- oder Telemetrieintegration sind vorhanden.

## Checkliste vor Produktionsfreigabe

### Infrastruktur

- [ ] Öffentliches HTTPS am finalen Hostnamen getestet.
- [ ] Reverse Proxy korrekt konfiguriert; Node-Prozess ausschließlich hinter dem Proxy erreichbar.
- [ ] `PUBLIC_BASE_URL` und `TRUSTED_ORIGINS` verwenden ausschließlich die freigegebenen HTTPS-Ursprünge.
- [ ] `COOKIE_SECURE=true`, `HttpOnly` und `SameSite=Strict` wirksam geprüft.
- [ ] HSTS erst nach erfolgreichem HTTPS-End-to-End-Test aktiviert.

### Datenbank und Sicherung

- [ ] Produktiv-, Test- und Recovery-Datenbank sind getrennt.
- [ ] Migrationen wurden vorab gesichert, geprüft und kontrolliert ausgeführt.
- [ ] Backup und isolierter Restore wurden vor Freigabe erfolgreich getestet.
- [ ] Least-Privilege-Konten verwenden kein `CREATE`, `ALTER`, `DROP` oder globale Rechte.
- [ ] Standortbezogene Tabellen werden erst nach separater rechtlicher Freigabe produktiv migriert.

### Berechtigung und Löschung

- [ ] ADMIN-Zugriff auf Anwesenheit und mögliche Live-Standorte serverseitig getestet.
- [ ] CUSTOMER und MANAGER erhalten keinen Zugriff auf Admin-Standortansichten.
- [ ] Employee Ownership, Assignment-Prüfung, Same-Origin-Schutz und Rate Limits sind im Produktivkontext erneut getestet.
- [ ] Aktuelle Standortdaten werden bei Stop, Ablauf und Ende eines Einsatzes gelöscht.
- [ ] Es gibt keine Standort-Historie, keine Rohkoordinaten in Audit-Metadaten und kein Standortmonitoring.

### Datenschutz und Betrieb

- [ ] Entwurf `attendance-location-privacy-draft-de.md` durch Legal/DPO geprüft und angepasst.
- [ ] Erforderliche Betriebsratsbeteiligung abgeschlossen.
- [ ] DPIA-Screening abgeschlossen; bei hohem Risiko DPIA dokumentiert.
- [ ] Beschäftigteninformation vor Aktivierung ausgehändigt.
- [ ] Monitoring protokolliert nur Betriebszustände und Fehler, keine Standortwerte.
- [ ] Support-, Incident- und Löschprozess dokumentiert.

## Rollback

Bei einem Sicherheits-, Datenschutz- oder Betriebsproblem:

1. Standortfreigabe serverseitig deaktivieren; Anwesenheit ohne Standort bleibt nutzbar.
2. Öffentliche Zugriffe auf eine mögliche Kartenansicht sperren.
3. Aktuelle Standortwerte nach dem bestätigten Löschkonzept entfernen.
4. Berechtigungen, Audit-Ereignisse und betroffene Sessions prüfen.
5. Erst nach Ursachenanalyse, Freigabe und erneutem isolierten Test wieder aktivieren.

## Bekannter Release-Blocker

Die Bereinigung historisch getrackter privater Dokumentpfade in der Git-Historie ist weiterhin zurückgestellt. Vor einer öffentlichen Veröffentlichung ist dafür ein eigener, kontrollierter Freigabe- und Bereinigungsprozess erforderlich.
