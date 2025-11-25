// state.js

// Fake device/slot/clip state (for now)

export const FAKE_DEVICE = {
  protocolVersion: '1.11',
  model: 'HyperDeck Studio Mini',
  uniqueId: 'CASPARDECK-0001',
  slotCount: 1,
  softwareVersion: '8.0',
  name: 'CasparDeck',
};

export const FAKE_SLOT = {
  slotId: 1,
  slotName: 'slot1',
  deviceName: 'internal',
  status: 'mounted', // "empty", "mounting", "error", "mounted"
  volumeName: 'CASPAR',
  recordingTime: 3600, // seconds – arbitrary
  videoFormat: '1080p25', // default; can make this configurable later
  blocked: false,
  remainingSize: 500_000_000_000,
  totalSize: 1_000_000_000_000,
};

// Dynamic clip list. Will be replaced by Caspar contents.
// We seed with a couple of fake entries so things still work
// even if Caspar is offline.
export let CLIPS = [
];

// entries: array of
//   { name, fps?, frames?, durationTc?, videoFormat? }
// or plain strings (name only) for backward compatibility
export function setClipsFromCaspar(entries) {
  CLIPS = entries.map((entry, i) => {
    const name = typeof entry === 'string' ? entry : entry.name;

    const durationTc =
      typeof entry === 'object' && entry.durationTc
        ? entry.durationTc
        : '00:00:10:00'; // fallback

    const videoFormat =
      typeof entry === 'object' && entry.videoFormat
        ? entry.videoFormat
        : '1080p30'; // fallback (your current default)

    const fps =
      typeof entry === 'object' && typeof entry.fps === 'number'
        ? entry.fps
        : null;

    const frames =
      typeof entry === 'object' && typeof entry.frames === 'number'
        ? entry.frames
        : null;

    return {
      index: i + 1,
      name,
      fileFormat: 'QuickTimeProRes', // always report ProRes to ATEM
      videoFormat,
      durationTc,
      startTc: '00:00:00:00',
      fps,
      frames,
    };
  });
}



export function getClipById(id) {
  return CLIPS.find(c => c.index === id) || null;
}
