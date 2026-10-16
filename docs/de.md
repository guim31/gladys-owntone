# OwnTone

Diese Integration steuert einen [OwnTone](https://owntone.github.io/owntone-server/)-Server (früher
forked-daapd) aus Gladys: den Player (Wiedergabe, Pause, weiter, Lautstärke, was läuft) und jede
Ausgabe, AirPlay- und Chromecast-Lautsprecher oder das lokale Audio, die du ein- und ausschaltest und
deren Lautstärke du Raum für Raum einstellst. Die Integration spricht mit OwnTone im lokalen Netz über seine
JSON-API und folgt jeder Änderung live über seinen WebSocket. Keine Cloud, kein Konto.

> **Getestet mit einem echten OwnTone 29.3 in Docker, ohne AirPlay- oder Chromecast-Lautsprecher:
> Rückmeldungen willkommen.** Wiedergabe, Lautstärken, Auswahl der Ausgaben, Benachrichtigungen und
> der Neustart von OwnTone wurden echt geprüft, an seiner lokalen und seiner fifo-Ausgabe.

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer.
- Ein OwnTone-Server (Version 28 oder neuer), von Gladys aus erreichbar auf dem Port seiner
  Weboberfläche, standardmäßig 3689, und auf seinem WebSocket-Port (`websocket_port` in
  `owntone.conf`, standardmäßig 3688).
- Gladys in den `trusted_networks` von `owntone.conf`, oder das `admin_password` von OwnTone in der
  Konfiguration eingetragen.

## Konfiguration

1. **Serveradresse**: die IP-Adresse oder der Hostname des Rechners, auf dem OwnTone läuft, wie für
   seine Weboberfläche. Ergänze `:Port`, wenn er nicht 3689 ist (`http://192.168.1.20:3689` geht
   auch).
2. **Port**: 3689, außer du hast `port` im Abschnitt `library` von `owntone.conf` geändert.
3. **Admin-Passwort (optional)**: nur wenn Gladys außerhalb der `trusted_networks` von OwnTone liegt.
   Standardmäßig vertraut OwnTone dem lokalen Netz und will kein Passwort.
4. **Sprache**: die Sprache der Funktionsnamen und der Texte, die die Integration schreibt.
   Funktionsnamen werden beim Hinzufügen des Geräts festgelegt.

Öffne dann den Tab **Entdecken** und füge den Player und die gewünschten Ausgaben hinzu.

## Geräte

### Player

Der Player von OwnTone, einer pro Server:

- **Lautstärke** (0 bis 100): die Gesamtlautstärke. OwnTone passt jede gewählte Ausgabe daran an.
- **Wiedergabestatus**: spielt oder nicht.
- **Wiedergabe**, **Pause**, **Vorheriger Titel**, **Nächster Titel**: Tasten.
- **Aktuelle Wiedergabe**: Titel und Interpret, mit dem Status, wenn pausiert oder gestoppt.

Diese Funktionen gehören zur Kategorie **Musik** von Gladys: Die **Musik**-Box des Dashboards steuert
den Player.

### Ausgaben

Ein Gerät pro Ausgabe von OwnTone: AirPlay- oder Chromecast-Lautsprecher, lokales Audio (ALSA,
PulseAudio), fifo.

- **Ausgewählt**: an, OwnTone spielt auf dieser Ausgabe; aus, nicht. Ein Lautsprecher, den du während
  der Wiedergabe einschaltest, kommt sofort zur Gruppe dazu.
- **Lautstärke** (0 bis 100): die Lautstärke dieser Ausgabe.

Eine Ausgabe, die OwnTone verlässt (Lautsprecher aus, nicht im Netz), erscheint als nicht ausgewählt
und behält ihr Gerät in Gladys; sie kommt von selbst wieder.

## Dashboard-Widget

**OwnTone**: was läuft (Titel, Interpret, Album), Status und Lautstärke des Players, die Ausgaben mit
ihrer Lautstärke (oder „Aus“) und vier Tasten: Wiedergabe oder Pause, weiter, leiser, lauter (in
Fünferschritten).

## Szenen-Auslöser

- **Wiedergabe gestartet**: OwnTone beginnt zu spielen. Variablen: Titel, Interpret, Album.
- **Wiedergabe gestoppt**: OwnTone hört auf zu spielen, pausiert oder gestoppt, seit mindestens
  5 Sekunden (OwnTone meldet bei jedem Titelwechsel kurz „Pause“). Filter: pausiert, gestoppt oder
  beides. Variablen: Titel, Interpret, Album.
- **Ausgabe verschwunden**: eine Ausgabe verlässt OwnTone. Filter: eine Ausgabe oder alle. Variable:
  der Name der Ausgabe.
- **Ausgabe erschienen**: eine Ausgabe kommt (wieder) zu OwnTone. Filter: eine Ausgabe oder alle.
  Variable: der Name der Ausgabe.

## Szenen-Aktionen

- **Playlist abspielen**: ersetzt die Warteschlange durch eine OwnTone-Playlist und spielt sie. Gib
  ihren Namen ein (Groß- und Kleinschreibung und Akzente egal; ein Teil des Namens reicht, wenn nur
  eine Playlist passt) oder eine URI (`library:playlist:8`, `spotify:playlist:…`, die Adresse eines
  Internetradios). Mit bis zu drei gewählten Ausgaben spielen nur diese; ohne Ausgabe bleiben die
  Ausgaben, wie sie sind. Ausgabe: der Name der gespielten Playlist.
- **Lautstärke einstellen**: einer Ausgabe (eines Raums) oder des Players (alle gewählten Ausgaben
  folgen).
- **Alles stoppen**: stoppt die Wiedergabe; oder stoppt sie und schaltet alle Ausgaben ab, was die
  AirPlay-Lautsprecher für andere Apps freigibt.

## Szenen-Beispiele

- **Mit Musik aufwachen**: werktags um 7:00 „Playlist abspielen“ `Morgen` auf dem Lautsprecher im
  Schlafzimmer, dann „Lautstärke einstellen“ dieser Ausgabe auf 25.
- **Das Haus verlassen**: wenn das Haus leer wird, „Alles stoppen“ und alle Ausgaben abschalten.
- **Das Licht folgt der Musik**: bei „Wiedergabe gestartet“ nach Sonnenuntergang das Wohnzimmer
  dimmen; bei „Wiedergabe gestoppt“ wieder aufhellen.

## Fehlerbehebung

- **„Der OwnTone-Server antwortet nicht“**: Prüfe Adresse und Port, dann ob sich die Weboberfläche
  von einem anderen Gerät im Netz öffnet.
- **„OwnTone lehnt das Passwort ab“**: Gib das `admin_password` aus `owntone.conf` ein. OwnTone
  verlangt es für jede Adresse außerhalb seiner `trusted_networks`.
- **„OwnTone lehnt Gladys ab“**: OwnTone hat kein `admin_password` und vertraut dem Netz von Gladys
  nicht: Setze eines oder füge dieses Netz zu `trusted_networks` hinzu.
- **Zustände kommen nur alle 5 Sekunden**: Der WebSocket-Port von OwnTone (3688) ist nicht
  erreichbar, oder `websocket_port` ist 0. Die Integration liest OwnTone dann alle 5 Sekunden. Die
  Protokolle melden es beim Verbinden.
- **„OwnTone konnte diese Ausgabe nicht nutzen“**: Der Lautsprecher ist aus, von einer anderen Quelle
  belegt oder verlangt ein Passwort oder einen Kopplungscode: Kopple ihn einmal über die
  Weboberfläche von OwnTone.
- **„Die Warteschlange von OwnTone ist leer“**: Wiedergabe braucht etwas in der Warteschlange: Starte
  zuerst eine Playlist.

## Grenzen

- Ein OwnTone-Server pro Integration, von Hand eingetragen (die Sandbox von Gladys hat kein eigenes
  mDNS).
- Keine Kopplung von AirPlay-Lautsprechern, die einen Code verlangen, und kein Ausgabepasswort: Mach
  das einmal in der Weboberfläche von OwnTone.
- Eine Playlist wird über Namen oder URI gewählt: kein Blättern in Bibliothek, Alben oder
  Interpreten.
- Ohne AirPlay- oder Chromecast-Lautsprecher entwickelt: Deren Verhalten stammt aus der API von
  OwnTone, nicht aus einem Test mit der Hardware. Rückmeldungen willkommen.
