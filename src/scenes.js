// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`). They receive the resolved fields
// and no language: errors follow the configured `language`.
// The core already plays, pauses and selects an output through the device
// features; these actions add what it cannot: a playlist by name on chosen
// outputs, a volume as a number, everything stopped at once.
// -----------------------------------------------------------------------------

import { CommandError } from './hub.js';

export const PLAY_OUTPUT_FIELDS = ['output', 'output_2', 'output_3'];

const given = (value) => typeof value === 'string' && value !== '';

export const SCENE_ACTIONS = {
  async play_playlist(hub, { fields }) {
    const outputs = PLAY_OUTPUT_FIELDS.filter((key) => given(fields[key])).map((key) =>
      hub.outputOf(fields[key]),
    );
    const playlist = await hub.playPlaylist(fields.playlist, outputs);
    return { playlist: playlist.name };
  },

  async set_volume(hub, { fields }) {
    const found = hub.find(fields.device);
    if (found?.kind === 'player') {
      await hub.setPlayerVolume(fields.volume);
    } else {
      await hub.setOutputVolume(hub.outputOf(fields.device), fields.volume);
    }
    return undefined;
  },

  async stop_all(hub, { fields }) {
    if (!['stop', 'stop_outputs_off'].includes(fields.mode)) {
      throw new CommandError('bad_command', hub.language);
    }
    await hub.stopAll(fields.mode === 'stop_outputs_off');
    return undefined;
  },
};
