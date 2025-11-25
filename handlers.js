// handlers.js
import { FAKE_DEVICE, FAKE_SLOT, CLIPS, setClipsFromCaspar, getClipById } from './state.js';
import { line, sendMultiline } from './protocol.js';
import { log } from './log.js';
import { casparClient } from './casparClient.js';

const CLIP_REFRESH_INTERVAL_MS = 15000; // e.g. 15 seconds
let lastClipsRefresh = 0;

// Ensure we have an up-to-date clip list from Caspar.
// If Caspar is unreachable, we keep whatever is already in CLIPS (fake or previous).
function refreshClipsFromCaspar(clientId, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastClipsRefresh < CLIP_REFRESH_INTERVAL_MS) {
    return;
  }

  lastClipsRefresh = now;

  (async () => {
    try {
      const names = await casparClient.listClips();
      if (!names || names.length === 0) {
        log(clientId, 'Caspar returned no clips; keeping existing CLIPS');
        return;
      }

      const detailed = [];

      for (const name of names) {
        try {
          const info = await casparClient.getClipInfo(name);
          detailed.push({
            name,
            ...info, // fps, frames, durationTc, videoFormat (when available)
          });
        } catch (err) {
          log(clientId, `ERROR CINF for "${name}": ${err.message}`);
          detailed.push({ name });
        }
      }

      setClipsFromCaspar(detailed);
      log(clientId, `Refreshed ${detailed.length} clips from Caspar (with CINF)`);
    } catch (err) {
      log(clientId, `ERROR refreshing clips from Caspar: ${err.message}`);
    }
  })();
}

const TC_REFRESH_INTERVAL_MS = 1000;

function refreshTimecodeFromCaspar(session) {
  const now = Date.now();
  if (
    session.lastTcRefreshMs &&
    now - session.lastTcRefreshMs < TC_REFRESH_INTERVAL_MS
  ) {
    return; // too soon – reuse last known TC
  }
  session.lastTcRefreshMs = now;

  const id = session.id;

  // Fire-and-forget: we never await inside the HyperDeck command path
  (async () => {
    try {
      const status = await casparClient.getLayerStatus({ channel: 1, layer: 1 });
      if (status.timecode) {
        session.displayTimecode = status.timecode;
        session.timelineTimecode = status.timecode;

        // Optional: you can also update clip fps/duration here if you want:
        // session.currentClipFps = status.fps || session.currentClipFps;
        // if (status.totalSeconds != null && status.fps) {
        //   session.currentClipFramesTotal =
        //     Math.floor(status.totalSeconds * status.fps);
        // }
      }
    } catch (err) {
      log(id, `ERROR fetching timecode from Caspar: ${err.message}`);
    }
  })();
}

// Main HyperDeck command handler
export function handleCommand(session, command, params) {
  const { socket, id } = session;

  const ok = () => {
    log(id, '< 200 ok');
    socket.write(line('200 ok'));
  };

  switch (command) {
    case 'ping': {
      ok();
      break;
    }

    case 'quit': {
      ok();
      socket.end();
      break;
    }

    case 'device info': {
      sendMultiline(socket, id, 204, 'device info', [
        `protocol version: ${FAKE_DEVICE.protocolVersion}`,
        `model: ${FAKE_DEVICE.model}`,
        `unique id: ${FAKE_DEVICE.uniqueId}`,
        `slot count: ${FAKE_DEVICE.slotCount}`,
        `software version: ${FAKE_DEVICE.softwareVersion}`,
        `name: ${FAKE_DEVICE.name}`,
      ]);
      break;
    }

    case 'slot info': {
      sendMultiline(socket, id, 202, 'slot info', [
        `slot id: ${FAKE_SLOT.slotId}`,
        `slot name: ${FAKE_SLOT.slotName}`,
        `device name: ${FAKE_SLOT.deviceName}`,
        `status: ${FAKE_SLOT.status}`,
        `volume name: ${FAKE_SLOT.volumeName}`,
        `recording time: ${FAKE_SLOT.recordingTime}`,
        `video format: ${FAKE_SLOT.videoFormat}`,
        `blocked: ${FAKE_SLOT.blocked ? 'true' : 'false'}`,
        `remaining size: ${FAKE_SLOT.remainingSize}`,
        `total size: ${FAKE_SLOT.totalSize}`,
      ],
    { suppressLog: true },);
      break;
    }

    case 'disk':
    case 'disk list': {
      refreshClipsFromCaspar(id);

      const lines = [
        `slot id: ${FAKE_SLOT.slotId}`,
        // {Clip ID}: {Name} {File format} {Video format} {Duration timecode}
        ...CLIPS.map(
          clip =>
            `${clip.index}: ${clip.name} ${clip.fileFormat} ${clip.videoFormat} ${clip.durationTc}`,
        ),
      ];

      sendMultiline(socket, id, 206, 'disk list', lines);
      break;
    }

    case 'remote': {
      if (params.size === 0) {
        // Query current remote state
        sendMultiline(socket, id, 210, 'remote info', [
          `enabled: ${session.remoteEnabled ? 'true' : 'false'}`,
          `override: ${session.remoteOverride ? 'true' : 'false'}`,
        ]);
      } else {
        if (params.has('enable')) {
          session.remoteEnabled = params.get('enable') === 'true';
        }
        if (params.has('override')) {
          session.remoteOverride = params.get('override') === 'true';
        }
        ok();
      }
      break;
    }

    case 'notify': {
      if (params.size === 0) {
        sendMultiline(socket, id, 209, 'notify', [
          `transport: ${session.notify.transport ? 'true' : 'false'}`,
          `slot: ${session.notify.slot ? 'true' : 'false'}`,
          `remote: ${session.notify.remote ? 'true' : 'false'}`,
          `configuration: ${
            session.notify.configuration ? 'true' : 'false'
          }`,
        ]);
      } else {
        for (const [key, value] of params.entries()) {
          if (key in session.notify) {
            session.notify[key] = value === 'true';
          }
        }
        ok();
      }
      break;
    }

    case 'play': {
      if (!session.ensureRemoteAllowed()) return;

      // Determine target clip
      if (params.has('clip id')) {
        session.currentClipIndex = Number(params.get('clip id')) || 1;
      } else if (session.currentClipIndex == null) {
        session.currentClipIndex = 1;
      }

      // Refresh clip list so we know Caspar has it
      refreshClipsFromCaspar(id);

      const clip = getClipById(session.currentClipIndex);
      if (clip) {
        // Strip extension for Caspar if present
const casparName = clip.name
  .replace(/^"+|"+$/g, '')      // strip leading/trailing quotes, just in case
  .replace(/\.[^.]+$/, '');     // strip file extension

  casparClient
    .playClip(casparName)
    .catch(err => {
      log(id, `ERROR sending PLAY to Caspar: ${err.message}`);
    });}

      if (params.has('speed')) {
        session.playSpeed = Number(params.get('speed'));
      } else {
        session.playSpeed = 100;
      }
      if (params.has('loop')) {
        session.loop = params.get('loop') === 'true';
      }
      if (params.has('single clip')) {
        session.singleClip = params.get('single clip') === 'true';
      }

      session.transportStatus = 'play';

      refreshTimecodeFromCaspar(session);
      ok();
      break;
    }

case 'stop': {
  if (!session.ensureRemoteAllowed()) return;

  // 1) Update our internal transport state
  session.transportStatus = 'stopped';
  session.playSpeed = 0;

  // 2) Immediately acknowledge to the ATEM
  ok(); // ✅ ATEM gets its 200 ok right away

  // 3) Fire-and-forget call to Caspar
  casparClient
    .pause() // or .stop() – see next section
    .catch(err => {
      log(id, `ERROR sending PAUSE to Caspar: ${err.message}`);
    });

  break;
}

    case 'transport info': {
      const clipId =
        session.currentClipIndex != null ? session.currentClipIndex : 'none';
      
      refreshTimecodeFromCaspar(session);

      sendMultiline(socket, id, 208, 'transport info', [
        `status: ${session.transportStatus}`,
        `speed: ${session.playSpeed}`,
        `slot id: ${FAKE_SLOT.slotId}`,
        `slot name: ${FAKE_SLOT.slotName}`,
        `device name: ${FAKE_SLOT.deviceName}`,
        `clip id: ${clipId}`,
        `single clip: ${session.singleClip ? 'true' : 'false'}`,
        `display timecode: ${session.displayTimecode}`,
        `timecode: ${session.timelineTimecode}`,
        `video format: ${FAKE_SLOT.videoFormat}`,
        `loop: ${session.loop ? 'true' : 'false'}`,
        `timeline: 0`,
        `input video format: ${FAKE_SLOT.videoFormat}`,
        `dynamic range: Rec709`,
        `reference locked: false`,
      ],
    { suppressLog: true },);
      break;
    }

    case 'clips count': {
      refreshClipsFromCaspar(id);

      sendMultiline(
        socket,
        id,
        214,
        'clips count',
        [`clip count: ${CLIPS.length}`],
        { suppressLog: true},
      );
      break;
    }

    case 'clips get': {
      refreshClipsFromCaspar(id);

      // Determine which clips to return
      let startId = 1;
      if (params.has('clip id')) {
        startId = Number(params.get('clip id')) || 1;
      }

      let maxCount = CLIPS.length - (startId - 1);
      if (params.has('count')) {
        const requested = Number(params.get('count')) || 0;
        if (requested > 0 && requested < maxCount) {
          maxCount = requested;
        }
      }

      if (startId < 1) startId = 1;
      if (startId > CLIPS.length) {
        sendMultiline(socket, id, 205, 'clips info', ['clip count: 0']);
        break;
      }

      const selected = CLIPS.slice(startId - 1, startId - 1 + maxCount);

      const lines = [
        `clip count: ${CLIPS.length}`,
        ...selected.map(
          clip =>
            `${clip.index}: ${clip.name} ${clip.startTc} ${clip.durationTc}`,
        ),
      ];

      sendMultiline(socket, id, 205, 'clips info', lines);
      break;
    }

        case 'goto': {
      // ATEM uses: "goto: clip id: N"
      if (params.has('clip id')) {
        const clipId = Number(params.get('clip id')) || 0;

        refreshClipsFromCaspar(id);

        const clip = getClipById(clipId);
        if (clip) {
          session.currentClipIndex = clipId;

          const casparName = clip.name
            .replace(/^"+|"+$/g, '')   // strip any quotes
            .replace(/\.[^.]+$/, '');  // strip extension

          // Fire-and-forget: don't block the HyperDeck reply on Caspar
          casparClient
            .loadClip(casparName)
            .catch(err => {
              log(id, `ERROR sending LOAD to Caspar: ${err.message}`);
            });
        } else {
          log(id, `WARN: goto requested invalid clip id ${clipId}`);
        }
      }

      // Goto positions but doesn't play
      session.transportStatus = 'stopped';
      session.playSpeed = 0;
      session.displayTimecode = '00:00:00:00';
      session.timelineTimecode = '00:00:00:00';

      ok(); // ✅ always reply quickly to ATEM
      break;
    }


    default: {
      log(id, `Unknown command: ${command}, sending 103 unsupported`);
      socket.write(line('103 unsupported'));
    }
  }
}
