// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of Gladys (German
// says "du", Spanish "usted"). Feature names follow the configured `language`
// (frozen by Gladys once a device is added); action and widget messages are
// multi-language objects, Gladys picks the user's language.
// -----------------------------------------------------------------------------

export const pick = (table, language) => table[language] ?? table.en;

// Feature names of the player.
export const PLAYER_NAMES = {
  en: {
    volume: 'Volume',
    playback_state: 'Playback state',
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous',
    next: 'Next',
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    artwork: 'Artwork',
    duration: 'Duration',
    position: 'Position',
    shuffle: 'Shuffle',
    repeat: 'Repeat',
    now_playing: 'Now playing',
  },
  fr: {
    volume: 'Volume',
    playback_state: 'État de lecture',
    play: 'Lecture',
    pause: 'Pause',
    previous: 'Précédent',
    next: 'Suivant',
    title: 'Titre',
    artist: 'Artiste',
    album: 'Album',
    artwork: 'Pochette',
    duration: 'Durée',
    position: 'Position',
    shuffle: 'Lecture aléatoire',
    repeat: 'Répétition',
    now_playing: 'En cours',
  },
  de: {
    volume: 'Lautstärke',
    playback_state: 'Wiedergabestatus',
    play: 'Wiedergabe',
    pause: 'Pause',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
    title: 'Titel',
    artist: 'Künstler',
    album: 'Album',
    artwork: 'Cover',
    duration: 'Dauer',
    position: 'Position',
    shuffle: 'Zufallswiedergabe',
    repeat: 'Wiederholung',
    now_playing: 'Aktuelle Wiedergabe',
  },
  es: {
    volume: 'Volumen',
    playback_state: 'Estado de reproducción',
    play: 'Reproducir',
    pause: 'Pausa',
    previous: 'Anterior',
    next: 'Siguiente',
    title: 'Título',
    artist: 'Artista',
    album: 'Álbum',
    artwork: 'Carátula',
    duration: 'Duración',
    position: 'Posición',
    shuffle: 'Reproducción aleatoria',
    repeat: 'Repetición',
    now_playing: 'Reproduciendo',
  },
};

// Feature names of an output (a speaker).
export const OUTPUT_NAMES = {
  en: { selected: 'Selected', volume: 'Volume' },
  fr: { selected: 'Sélectionnée', volume: 'Volume' },
  de: { selected: 'Ausgewählt', volume: 'Lautstärke' },
  es: { selected: 'Seleccionada', volume: 'Volumen' },
};

// The state of the player, or of the server.
export const STATE_LABELS = {
  en: { play: 'Playing', pause: 'Paused', stop: 'Stopped', offline: 'Offline' },
  fr: { play: 'En lecture', pause: 'En pause', stop: 'Arrêté', offline: 'Hors ligne' },
  de: { play: 'Wiedergabe', pause: 'Pausiert', stop: 'Gestoppt', offline: 'Offline' },
  es: { play: 'Reproduciendo', pause: 'En pausa', stop: 'Detenido', offline: 'Sin conexión' },
};

export const INIT_FAILED = {
  en: 'The OwnTone integration could not start. See its logs.',
  fr: "L'intégration OwnTone n'a pas pu démarrer. Consultez ses journaux.",
  de: 'Die OwnTone-Integration konnte nicht starten. Sieh in ihre Protokolle.',
  es: 'La integración OwnTone no pudo iniciarse. Consulte sus registros.',
};

// The connection status shown on the integration page.
export const STATUS_TEXT = {
  not_configured: {
    en: 'Type the address of your OwnTone server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur OwnTone dans la configuration.",
    de: 'Gib die Adresse deines OwnTone-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor OwnTone en la configuración.',
  },
  invalid_host: {
    en: 'The server address is not valid: an IP address or a host name, with :port if needed.',
    fr: "L'adresse du serveur n'est pas valide : une adresse IP ou un nom d'hôte, avec :port au besoin.",
    de: 'Die Serveradresse ist ungültig: eine IP-Adresse oder ein Hostname, bei Bedarf mit :Port.',
    es: 'La dirección del servidor no es válida: una dirección IP o un nombre de host, con :puerto si hace falta.',
  },
  unreachable: {
    en: 'The OwnTone server does not answer. Check its address, its port (3689 by default) and that it runs.',
    fr: 'Le serveur OwnTone ne répond pas. Vérifiez son adresse, son port (3689 par défaut) et qu’il tourne.',
    de: 'Der OwnTone-Server antwortet nicht. Prüfe Adresse, Port (standardmäßig 3689) und ob er läuft.',
    es: 'El servidor OwnTone no responde. Compruebe su dirección, su puerto (3689 por defecto) y que esté en marcha.',
  },
  auth: {
    en: 'OwnTone refused the password: type its admin_password in the configuration.',
    fr: 'OwnTone refuse le mot de passe : saisissez son admin_password dans la configuration.',
    de: 'OwnTone lehnt das Passwort ab: Gib sein admin_password in der Konfiguration ein.',
    es: 'OwnTone rechaza la contraseña: introduzca su admin_password en la configuración.',
  },
  forbidden: {
    en: 'OwnTone refuses Gladys: set an admin_password in owntone.conf, or trust the network of Gladys.',
    fr: 'OwnTone refuse Gladys : définissez un admin_password dans owntone.conf, ou faites confiance au réseau de Gladys.',
    de: 'OwnTone lehnt Gladys ab: Setze ein admin_password in owntone.conf oder vertraue dem Netz von Gladys.',
    es: 'OwnTone rechaza a Gladys: defina un admin_password en owntone.conf, o confíe en la red de Gladys.',
  },
};

// Why a command failed (scene actions, widget, device controls).
export const COMMAND_ERRORS = {
  not_configured: STATUS_TEXT.not_configured,
  unreachable: {
    en: 'The OwnTone server is unreachable.',
    fr: 'Le serveur OwnTone est injoignable.',
    de: 'Der OwnTone-Server ist nicht erreichbar.',
    es: 'El servidor OwnTone no está accesible.',
  },
  refused: {
    en: 'OwnTone refused the command.',
    fr: 'OwnTone a refusé la commande.',
    de: 'OwnTone hat den Befehl abgelehnt.',
    es: 'OwnTone rechazó el comando.',
  },
  output_refused: {
    en: 'OwnTone could not use this output: speaker off, busy or asking for a password?',
    fr: 'OwnTone n’a pas pu utiliser cette sortie : enceinte éteinte, occupée ou protégée par mot de passe ?',
    de: 'OwnTone konnte diese Ausgabe nicht nutzen: Lautsprecher aus, belegt oder mit Passwort?',
    es: 'OwnTone no pudo usar esta salida: ¿altavoz apagado, ocupado o con contraseña?',
  },
  auth: STATUS_TEXT.auth,
  unknown_device: {
    en: 'This device is not on the OwnTone server anymore.',
    fr: "Cet appareil n'est plus sur le serveur OwnTone.",
    de: 'Dieses Gerät ist nicht mehr auf dem OwnTone-Server.',
    es: 'Este dispositivo ya no está en el servidor OwnTone.',
  },
  bad_volume: {
    en: 'The volume must be a number from 0 to 100.',
    fr: 'Le volume doit être un nombre de 0 à 100.',
    de: 'Die Lautstärke muss eine Zahl von 0 bis 100 sein.',
    es: 'El volumen debe ser un número de 0 a 100.',
  },
  bad_command: {
    en: 'Unknown command.',
    fr: 'Commande inconnue.',
    de: 'Unbekannter Befehl.',
    es: 'Comando desconocido.',
  },
  no_playlist: {
    en: 'Type the name of an OwnTone playlist.',
    fr: "Saisissez le nom d'une playlist OwnTone.",
    de: 'Gib den Namen einer OwnTone-Playlist ein.',
    es: 'Introduzca el nombre de una lista de reproducción de OwnTone.',
  },
  playlist_not_found: {
    en: 'No OwnTone playlist has this name.',
    fr: 'Aucune playlist OwnTone ne porte ce nom.',
    de: 'Keine OwnTone-Playlist hat diesen Namen.',
    es: 'Ninguna lista de reproducción de OwnTone tiene este nombre.',
  },
  playlist_ambiguous: {
    en: 'Several OwnTone playlists match this name: type it in full.',
    fr: 'Plusieurs playlists OwnTone correspondent à ce nom : saisissez-le en entier.',
    de: 'Mehrere OwnTone-Playlists passen zu diesem Namen: Gib ihn vollständig ein.',
    es: 'Varias listas de reproducción de OwnTone coinciden con este nombre: escríbalo completo.',
  },
  empty_queue: {
    en: 'Nothing to play: the OwnTone queue is empty. Start a playlist first.',
    fr: "Rien à lire : la file d'attente d'OwnTone est vide. Lancez d'abord une playlist.",
    de: 'Nichts abzuspielen: Die Warteschlange von OwnTone ist leer. Starte zuerst eine Playlist.',
    es: 'Nada que reproducir: la cola de OwnTone está vacía. Inicie primero una lista de reproducción.',
  },
  playlist_empty: {
    en: 'This playlist has nothing OwnTone can play.',
    fr: "Cette playlist ne contient rien qu'OwnTone puisse lire.",
    de: 'Diese Playlist enthält nichts, was OwnTone abspielen kann.',
    es: 'Esta lista de reproducción no tiene nada que OwnTone pueda reproducir.',
  },
  folder_not_playable: {
    en: 'A folder cannot be played: open it and play what it holds.',
    fr: 'Un dossier ne se lit pas : ouvrez-le et lancez ce qu’il contient.',
    de: 'Ein Ordner lässt sich nicht abspielen: Öffne ihn und spiele seinen Inhalt ab.',
    es: 'Una carpeta no se puede reproducir: ábrala y reproduzca lo que contiene.',
  },
  not_playable: {
    en: 'OwnTone found nothing to play there.',
    fr: 'OwnTone n’a rien trouvé à lire ici.',
    de: 'OwnTone hat hier nichts zum Abspielen gefunden.',
    es: 'OwnTone no encontró nada que reproducir aquí.',
  },
  not_in_queue: {
    en: 'This item is no longer in the queue.',
    fr: 'Cet élément n’est plus dans la file d’attente.',
    de: 'Dieses Element ist nicht mehr in der Warteschlange.',
    es: 'Este elemento ya no está en la cola.',
  },
  no_artwork: {
    en: 'OwnTone has no cover for this item.',
    fr: 'OwnTone n’a pas de pochette pour cet élément.',
    de: 'OwnTone hat kein Cover für dieses Element.',
    es: 'OwnTone no tiene carátula para este elemento.',
  },
};

// The root folders of the catalog (Gladys 5.3 music panel).
export const CATALOG_TEXT = {
  playlists: { en: 'Playlists', fr: 'Playlists', de: 'Playlists', es: 'Listas de reproducción' },
  artists: { en: 'Artists', fr: 'Artistes', de: 'Künstler', es: 'Artistas' },
  albums: { en: 'Albums', fr: 'Albums', de: 'Alben', es: 'Álbumes' },
  files: { en: 'Files', fr: 'Fichiers', de: 'Dateien', es: 'Archivos' },
};

export const commandMessage = (code) => COMMAND_ERRORS[code] ?? COMMAND_ERRORS.refused;

// The toast of a widget button.
export const DONE_TEXT = {
  play: { en: 'Playing.', fr: 'Lecture lancée.', de: 'Wiedergabe läuft.', es: 'Reproduciendo.' },
  pause: { en: 'Paused.', fr: 'En pause.', de: 'Pausiert.', es: 'En pausa.' },
  next: { en: 'Next track.', fr: 'Titre suivant.', de: 'Nächster Titel.', es: 'Pista siguiente.' },
  volume: {
    en: 'Volume changed.',
    fr: 'Volume modifié.',
    de: 'Lautstärke geändert.',
    es: 'Volumen cambiado.',
  },
};
