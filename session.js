// session.js
import { line } from './protocol.js';
import { log } from './log.js';

let NEXT_CLIENT_ID = 1;

export class ClientSession {
  constructor(socket) {
    this.socket = socket;
    this.id = NEXT_CLIENT_ID++;

    // Remote state
    this.remoteEnabled = true;
    this.remoteOverride = true;

    // Transport state
    this.transportStatus = 'stopped'; // "preview", "stopped", "play", ...
    this.playSpeed = 0; // percent
    this.currentClipIndex = null;
    this.singleClip = true;
    this.loop = false;
    this.displayTimecode = '00:00:00:00';
    this.timelineTimecode = '00:00:00:00';
    this.lastTcRefreshMs = 0;
    this.lastTimecodeRefresh = 0;

    // NEW: timing/clip properties
    this.currentClipFps = null;
    this.currentClipFramesTotal = null;
    this.playStartWallTimeMs = null;  // wall-clock ms when last PLAY started
    this.playStartFrame = 0;          // frame index at PLAY start

    this.notify = {
      transport: false,
      slot: false,
      remote: false,
      configuration: false,
    };
  }

  ensureRemoteAllowed() {
    if (!this.remoteEnabled && !this.remoteOverride) {
      log(this.id, '< 111 remote control disabled');
      this.socket.write(line('111 remote control disabled'));
      return false;
    }
    return true;
  }
}
