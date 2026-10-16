// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `player`, "OwnTone".
//
// What plays (title, artist and album), a status list (state, volume), the
// outputs in a list (name, kind, a badge: their volume when selected, "Off"
// otherwise), and four buttons: play or pause, next, volume down and up.
// Budget: 2 texts, 1 status, 1 card list, 4 buttons (the core drops a fifth
// button). No button opens a form: Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { outputKind } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { DONE_TEXT, STATE_LABELS, pick } from './texts.js';

export { WIDGET_KEY };

export const VOLUME_STEP = 5;

export const TEXT = {
  unavailable: {
    en: 'The OwnTone server is unavailable.',
    fr: 'Le serveur OwnTone est indisponible.',
    de: 'Der OwnTone-Server ist nicht erreichbar.',
    es: 'El servidor OwnTone no está disponible.',
  },
  nothing: {
    en: 'Nothing in the queue',
    fr: "Rien dans la file d'attente",
    de: 'Nichts in der Warteschlange',
    es: 'Nada en la cola',
  },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  off: { en: 'Off', fr: 'Éteinte', de: 'Aus', es: 'Apagada' },
  play: { en: 'Play', fr: 'Lire', de: 'Abspielen', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  volume_down: { en: 'Volume −', fr: 'Volume −', de: 'Leiser', es: 'Volumen −' },
  volume_up: { en: 'Volume +', fr: 'Volume +', de: 'Lauter', es: 'Volumen +' },
};

export const WIDGET_ACTIONS = ['play_pause', 'next', 'volume_down', 'volume_up'];

const COLORS = {
  play: WIDGET_COLORS.SUCCESS,
  pause: WIDGET_COLORS.WARNING,
  stop: WIDGET_COLORS.NEUTRAL,
};

const button = (lang, key, icon, label = key) => ({
  type: 'button',
  label: pick(TEXT[label], lang),
  icon,
  action: { key },
});

/**
 * @param {object} hub
 * @param {{ language?: string }} request
 */
export function buildContent(hub, { language = 'en' } = {}) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (!hub.online) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.unavailable, lang) }],
    };
  }
  const { player, item, outputs } = hub.model;
  const state = player.state;
  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: (item?.title || item?.artist || pick(TEXT.nothing, lang)).slice(0, 40),
    },
  ];
  const caption = [item?.title ? item.artist : '', item?.album].filter(Boolean).join(' · ');
  if (caption !== '') {
    components.push({ type: 'text', variant: 'caption', text: caption.slice(0, 80) });
  }
  components.push({
    type: 'status',
    items: [
      {
        label: pick(TEXT.state, lang),
        value: pick(STATE_LABELS, lang)[state],
        color: COLORS[state],
      },
      {
        label: pick(TEXT.volume, lang),
        value: player.volume === null ? '–' : `${player.volume} %`,
        icon: 'volume-2',
      },
    ],
  });
  // A list holds 8 rows: the selected outputs first.
  const rows = [...outputs.values()].sort((a, b) => Number(b.selected) - Number(a.selected));
  if (rows.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: rows.slice(0, 8).map((output) => ({
        title: hub.outputName(output).slice(0, 60),
        subtitle: outputKind(output),
        badge: output.selected
          ? {
              text: output.volume === null ? '–' : `${output.volume} %`,
              color: WIDGET_COLORS.SUCCESS,
            }
          : { text: pick(TEXT.off, lang), color: WIDGET_COLORS.NEUTRAL },
      })),
    });
  }
  components.push(
    state === 'play'
      ? button(lang, 'play_pause', 'pause', 'pause')
      : button(lang, 'play_pause', 'play', 'play'),
    button(lang, 'next', 'skip-forward'),
    button(lang, 'volume_down', 'volume-1'),
    button(lang, 'volume_up', 'volume-2'),
  );
  return { ttl_seconds: state === 'play' ? 30 : 120, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (a widget action receives no language: all four). */
    async action(hub, { actionKey }) {
      try {
        switch (actionKey) {
          case 'play_pause': {
            const playing = hub.model.player.state === 'play';
            await hub.playPause();
            return playing ? DONE_TEXT.pause : DONE_TEXT.play;
          }
          case 'next':
            await hub.command('next');
            return DONE_TEXT.next;
          case 'volume_down':
          case 'volume_up': {
            if (!hub.online) {
              throw new CommandError(hub.client ? 'unreachable' : 'not_configured', hub.language);
            }
            const step = actionKey === 'volume_up' ? VOLUME_STEP : -VOLUME_STEP;
            const volume = Math.max(0, Math.min(100, (hub.model.player.volume ?? 50) + step));
            await hub.setPlayerVolume(volume);
            return DONE_TEXT.volume;
          }
          default:
            throw new Error(`Unknown widget action ${actionKey}`);
        }
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
    },
  },
};
