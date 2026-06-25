# q-records storemanager v2

## Ziel
- **Leichtgewichtige Version des bestehenden q-records-storemanagers**: Reduzierte Komplexität durch Entfernung redundanter Module, optimierter Speicherverbrauch durch effiziente Datenstrukturen und Caching-Strategien für schnellere Deployment-Zeiten (< 5 Minuten) und einfachere Wartung mit weniger Abhängigkeiten
- **Multi-Tenant-Fähigkeit für mehrere Record Stores**: Zentrale Verwaltung verschiedener unabhängiger Plattenläden über eine einzige Instanz (z. B. Standorte A, B, C mit separaten Beständen und Konfigurationen). Datensilos zwischen Mandanten sind vollständig isoliert, während Ressourcen wie Datenbank-Connections und Server-Kapazität effizient geteilt werden. Skalierbar von 2 bis 50+ Läden pro Instanz ohne Performance-Degradation
- **Benutzerverwaltung**: Verwaltung von Benutzerkonten und Berechtigungen für den Zugriff auf die Live-Bestandsansicht (Real-Time Stock View) und persönliche Wunschlisten. Ermöglicht verschiedene Benutzerrollen (z.B. Administrator, Mitarbeiter, Kunde) mit unterschiedlichen Zugriffsebenen und Funktionen. Unterstützt Authentifizierung und Autorisierung zur Sicherung von sensiblen Bestandsdaten und persönlichen Kundenlisten.

## Funktionen

- **Inventarliste / Artikelverwaltung**: Zentrale Verwaltung aller Artikel mit Kategorisierung, Lagerverwaltung und Bestandsverfolgung in Echtzeit
- **Vollständige Discogs-Integration**: Automatische Datensynchronisation mit Discogs für aktuelle Preise, Cover-Bilder und Metadaten
- **Artikel-Ankauf**: Integrierte Discogs-Suche zur schnellen Artikelidentifikation mit automatischer Preisberechnung basierend auf Marktvergleichen und Lagerhaltungskosten
- **Artikel-Verkauf**: Flexible Verkaufsabwicklung mit Kundenhistorie und Verkaufsanalytik
- **Zahlungsintegration**: Anbindung an PayPal und weitere POS-Systeme (SumUp, Square, etc.) für verschiedene Zahlungsmethoden
- **Barcode-Scanner-Integration**: Schnelle Erfassung von Artikeln durch Barcode-Scan zur Beschleunigung von Ankauf und Verkauf
- **Batch-Ankauf mit Etikettendruck**: Massenverarbeitung von Ankäufen mit automatischer Etikettenerstellung für schnellere Bestandsverwaltung
- **Bestands-Übersicht mit permanenten Links**: Öffentlich teilbare Bestands-URL für Kunden und digitale Kataloge
- **Soziale Medien Integration**: Automatisierte Werbung und Katalogverwaltung für Instagram und Facebook zur Reichweitensteigerung

## Artikel

Artikel können sein:
- **Schallplatten** (Vinyl in verschiedenen Formaten: LP, 12-Zoll-Alben; EP, 7-Zoll-Singles; Single, 7-Zoll-Einzeltitel) – das Kernprodukt für Sammler und Liebhaber analoger Musik
- **CDs** (Audio-CDs mit Standard-Kapazität; Box-Sets mit mehreren Discs und umfangreichen Begleitmaterialien) – beliebter für digitale Sammlungen und moderne Künstler
- **Andere Tonträger** (Kassetten für Vintage-Liebhaber; DAT und MiniDisc als semi-professionelle Formate; digitale Formate wie FLAC oder WAV zum Download oder auf USB-Speichern) – spezialisierte Medien für Enthusiasten und Archivierung
- **Zubehör** (Schutzhüllen und Sleeves zum Schutz vor Beschädigungen; Nadeln und Stylus-Ersatzteile für Tonabnehmer; Reinigungsmittel, Reinigungstücher und Bürsten zur Wartung; Ständer, Wandhalterungen und Displayständer zur Präsentation; sowie weiteres Zubehör wie Adapter, Kabel, Antistatic-Bags und Datenblätter für Tonträger)

### Artikelstatus

- 10: Wunschliste
- 20: im Lager
- 30: Verliehen
- 40: Verkauft
- 50: Gelöscht

### zustand

Artikel können verschiedene Zustände haben, die direkten Einfluss auf die automatische Preisberechnung nehmen. Die Zustände werden in zwei Kategorien unterteilt: `condition_record` erfasst den Zustand der Schallplatte oder CD selbst (Kratzer, Verschleiß, Spielbarkeit, Verformungen), während `condition_cover` den Zustand der Hülle oder des Covers dokumentiert (Beschädigungen, Verschleiß, Wasserflecken, Farbverlauf, fehlende Inserts). Diese differenzierte Bewertung ermöglicht eine präzisere Preisgestaltung, da viele Käufer zwischen dem Zustand des Tonträgers und seiner Verpackung unterscheiden. Ein Exemplar kann beispielsweise eine unversehrte CD mit exzellentem Sound haben, aber ein beschädigtes oder fadenscheiniges Cover aufweisen – was sich deutlich auf den Marktwert auswirkt. Die Bewertung orientiert sich am Discogs Standard, der etablierte Kategorien wie „Mint", „Near Mint", „Very Good Plus", „Very Good", „Good Plus", „Good", „Fair" und „Poor" vorsieht.

### preistabelle

In der Preistabelle wird die recordId gespeichert, der Ankaufspreis, die conditions und der (empfohlene) Verkaufspreis. Beim Ankauf, ob Batch oder einzeln, werden pro Artikel eine Zeile eingetragen. Diese beinhaltet dann auch den Zustand des Artikels (nach Discogs-Standard wie „Mint", „Very Good" oder „Good") und den aktuellen Status (z.B. „in Bestand", „verkauft", „reserviert"). Ein optionales Bemerkungsfeld ermöglicht zusätzliche Notizen, etwa zu Mängeln wie Kratzer oder fehlenden Inserts, die nicht standardisiert erfasst sind.

Die Unterscheidung der Artikel soll über einen Hash nach den Kriterien artist, title, country, year und label erfolgen. Dieser Ansatz vermeidet redundante Einträge für identische Releases, erfasst aber gleichzeitig alle verschiedenen Pressungen einer Platte – beispielsweise die Original-Pressung aus Japan neben der europäischen Variante. Dadurch wird sichergestellt, dass der Katalog sowohl übersichtlich als auch vollständig bleibt und Sammler zwischen wertvollen Erstauflagen und späteren Wiederveröffentlichungen unterscheiden können.


### Artikeldaten

- Alle relevanten Daten von Discogs (Künstlerinformationen, Veröffentlichungsdaten, Tracklisten, Cover-Bilder, Preishistorien und Zustandsbewertungen) automatisch übernehmen und strukturiert in der Datenbank speichern
- Discogs-Daten wahlweise im effizienten Batch-Modus (für größere Datenmengen und regelmäßige Synchronisationen) oder im Einzelmodus (für spontane Abfragen und manuelle Updates) aktualisieren und dabei Duplikate vermeiden
- Artikelzustand speichern
- Preisberechnung für den Ankauf aus dem bestehenden Q-Records Storemanager übernehmen und optimieren

### Wunschlisten

Wunschlisten ermöglichen Benutzern, eine Benachrichtigung per E-Mail zu erhalten, wenn ein gewünschtes Album im Store angekauft wurde.

Wunschlisten können erstellt werden für:

- Künstler (Beatles, Depeche Mode, ...)
- Label (Parlophone, Jet Records, ...)
- Titel
- Land

Der Benutzer wählt einen Filter über diese Felder (Künstler ist erforderlich, die übrigen sind optionale Zusatzfilter).

Wenn das Album im Store ankommt (Ankauf oder Rückkehr aus Vermietung), wird der Benutzer per E-Mail benachrichtigt, dass der Artikel verfügbar ist.

## Discogs

- Discogs-Integration über deren API und Seller API
- Kauf und Verkauf von Alben über die Discogs API
- Bestandssynchronisation zwischen Storemanager und Discogs