// casparClient.js
import net from 'node:net';
import { log } from './log.js';

// Simple AMCP client with request/response queue.
class CasparClient {
  constructor({ host = '127.0.0.1', port = 5250 } = {}) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = '';
    this.queue = []; // [{ resolve, reject, responseType }]
    this.connected = false;
    this.connecting = null;
  }

    /**
   * Parse Caspar INFO XML for a given channel/layer to get real playback time.
   *
   * Returns:
   *   {
   *     timecode: "HH:MM:SS:FF" | null,
   *     elapsedSeconds: number | null,
   *     totalSeconds: number | null,
   *     fps: number | null
   *   }
   */
  async getLayerStatus({ channel = 1, layer = 1 } = {}) {
  const resp = await this.sendRaw(`INFO ${channel}-${layer}`, 'multi');
  const lines = resp.split(/\r?\n/).filter(Boolean);

  if (lines.length === 0) {
    log('caspar', 'INFO response empty');
    return null;
  }

  const statusLine = lines.shift(); // e.g. "201 INFO OK"
  log('caspar', `< ${statusLine}`);

  const xml = lines.join('\n');
  // Optional: if you want to see the XML, you can log it once
  // log('caspar', `< ${xml}`);

  // --- Parse clip name ---
  const nameMatch = xml.match(/<name>([^<]+)<\/name>/);
  const clipName = nameMatch ? nameMatch[1] : null;

  // --- Parse time values (seconds) ---
  // In your sample:
  //   <time>3.0864...</time>   <-- current position
  //   <time>329.8461...</time> <-- total duration
  const timeMatches = [...xml.matchAll(/<time>([\d.]+)<\/time>/g)];
  const currentTimeSec = timeMatches[0] ? parseFloat(timeMatches[0][1]) : null;
  const totalTimeSec   = timeMatches[1] ? parseFloat(timeMatches[1][1]) : null;

  // --- Parse FPS from streams_0 (file fps) ---
  // <streams_0>
  //    <fps>30</fps>
  //    <fps>1</fps>
  // </streams_0>
  let fps = null;
  const fpsMatch = xml.match(
    /<streams_0>[\s\S]*?<fps>(\d+)<\/fps>\s*<fps>(\d+)<\/fps>/
  );
  if (fpsMatch) {
    const num = parseInt(fpsMatch[1], 10);
    const den = parseInt(fpsMatch[2], 10);
    if (den) fps = num / den;
  }

  const loopMatch   = xml.match(/<loop>(true|false)<\/loop>/);
  const pausedMatch = xml.match(/<paused>(true|false)<\/paused>/);

  return {
    clipName,
    currentTimeSec,
    totalTimeSec,
    fps,
    loop:   loopMatch   ? loopMatch[1] === 'true' : null,
    paused: pausedMatch ? pausedMatch[1] === 'true' : null,
  };
}

  static secondsToTimecode(seconds, fps) {
    // Convert seconds + fps to HH:MM:SS:FF
    if (seconds == null) return null;
    const roundedFps = Math.round(fps || 25);
    if (roundedFps <= 0) return null;

    const totalFrames = Math.floor(seconds * roundedFps);
    const frameRem = totalFrames % roundedFps;
    const totalSeconds = Math.floor(totalFrames / roundedFps);

    const pad2 = n => String(n).padStart(2, '0');

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}:${pad2(frameRem)}`;
  }

  async ensureConnected() {
    if (this.connected && this.socket) return;
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection(
        { host: this.host, port: this.port },
        () => {
          this.socket = socket;
          this.connected = true;
          this.connecting = null;
          this.buffer = '';
          log('caspar', `Connected to CasparCG at ${this.host}:${this.port}`);
          resolve();
        },
      );

      socket.setEncoding('utf8');

      socket.on('data', chunk => this.onData(chunk));
      socket.on('error', err => {
        log('caspar', 'Socket error:', err.message);
        this.connected = false;
        this.socket = null;
        const pending = this.queue.shift();
        if (pending) pending.reject(err);
      });
      socket.on('close', () => {
        log('caspar', 'Connection closed');
        this.connected = false;
        this.socket = null;
      });
    });

    return this.connecting;
  }

  // Generic response parser that can handle:
  // - single-line replies (LOAD/PLAY/STOP/PAUSE)
  // - two-line replies (CINF)
  // - multi-line replies ending with a blank line (CLS, etc.)
  onData(chunk) {
    this.buffer += chunk;

    while (this.queue.length > 0) {
      const pending = this.queue[0];
      const { responseType } = pending;

      if (responseType === 'multi') {
        // Multi-line response terminated by blank line
        const idx = this.buffer.search(/\r?\n\r?\n/);
        if (idx === -1) break;

        const resp = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx).replace(/^\r?\n\r?\n/, '');

        this.queue.shift();
        pending.resolve(resp);
      } else if (responseType === 'two') {
        // Need at least two lines
        const firstNL = this.buffer.indexOf('\n');
        if (firstNL === -1) break;
        const secondNL = this.buffer.indexOf('\n', firstNL + 1);
        if (secondNL === -1) break;

        const resp = this.buffer.slice(0, secondNL + 1);
        this.buffer = this.buffer.slice(secondNL + 1);

        this.queue.shift();
        pending.resolve(resp);
      } else {
        // 'single' – resolve on first line
        const idx = this.buffer.indexOf('\n');
        if (idx === -1) break;

        const resp = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);

        this.queue.shift();
        pending.resolve(resp);
      }
    }
  }

  async sendRaw(command, responseType = 'single') {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, responseType });
      log('caspar', `> ${command}`);
      this.socket.write(command + '\r\n');
    });
  }

  // --- High-level helpers ---

  // Get list of clips from Caspar.
  // Returns array of clip names (strings).
  async listClips() {
    const resp = await this.sendRaw('CLS', 'multi');
    const lines = resp.split(/\r?\n/).filter(Boolean);

    if (lines.length === 0) return [];

    // First line is status, eg "201 CLS OK"
    const statusLine = lines.shift();
    log('caspar', `< ${statusLine}`);

    const clips = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let name;

      if (trimmed.startsWith('"')) {
        const endQuote = trimmed.indexOf('"', 1);
        if (endQuote > 1) {
          name = trimmed.slice(1, endQuote);
        } else {
          name = trimmed.slice(1).split(/\s+/)[0];
        }
      } else {
        name = trimmed.split(/\s+/)[0];
      }

      if (name) {
        clips.push(name);
      }
    }

    return clips;
  }

  // Clip info via CINF
  //
  // Example from your log:
  // 201 CINF OK
  // "FNAFCOUNTDOWN"  MOVIE  1148012508 20250124204929 35926 1001/60000
  //
  // Returns:
  // {
  //   fps: number | null,
  //   frames: number | null,
  //   durationTc: "HH:MM:SS:FF" | null,
  //   videoFormat: "1080p25" | null
  // }
  async getClipInfo(name) {
    const resp = await this.sendRaw(`CINF "${name}"`, 'two');
    const lines = resp.split(/\r?\n/).filter(Boolean);

    if (lines.length < 2) {
      log('caspar', `CINF response too short for "${name}": ${resp}`);
      return {
        fps: null,
        frames: null,
        durationTc: null,
        videoFormat: null,
      };
    }

    const statusLine = lines[0];
    const infoLine = lines[1].trim();
    log('caspar', `< ${statusLine}`);
    log('caspar', `< ${infoLine}`);

    const tokens = infoLine.split(/\s+/);

    // tokens in your example:
    // [ '"FNAFCOUNTDOWN"', 'MOVIE', '1148012508', '20250124204929', '35926', '1001/60000' ]
    let fps = null;
    let frames = null;

    if (tokens.length >= 2) {
      const timebase = tokens[tokens.length - 1]; // e.g. "1001/60000"
      if (/^\d+\/\d+$/.test(timebase)) {
        const [num, den] = timebase.split('/').map(n => parseInt(n, 10));
        if (num && den) {
          // 1001/60000 seconds per frame => fps = 60000/1001
          fps = den / num;
        }
      }

      // second last token is the frame count (35926 in your example)
      const frameToken = tokens[tokens.length - 2];
      if (/^\d+$/.test(frameToken)) {
        frames = parseInt(frameToken, 10);
      }
    }

    let durationTc = null;
    if (fps && frames != null) {
      durationTc = CasparClient.framesToTimecode(frames, fps);
    }

    const videoFormat = CasparClient.guessVideoFormatFromFps(fps);

    return {
      fps,
      frames,
      durationTc,
      videoFormat,
    };
  }

  static framesToTimecode(frames, fps) {
    if (!fps || frames == null) return null;

    const roundedFps = Math.round(fps);
    if (roundedFps <= 0) return null;

    const totalSeconds = Math.floor(frames / roundedFps);
    const frameRem = frames % roundedFps;

    const pad2 = n => String(n).padStart(2, '0');

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}:${pad2(frameRem)}`;
  }

  static guessVideoFormatFromFps(fps) {
    if (!fps) return null;
    const f = Math.round(fps);

    if (f === 25) return '1080p25';
    if (f === 24) return '1080p24';
    if (f === 30) return '1080p30';
    if (f === 50) return '1080p50';
    if (f === 60) return '1080p60';

    // Fallback – still something sensible
    return `1080p${f}`;
  }

  async loadClip(name, { channel = 1, layer = 1 } = {}) {
    const cmd = `LOAD ${channel}-${layer} "${name}"`;
    await this.sendRaw(cmd, 'single');
  }

  async playClip(name, { channel = 1, layer = 1 } = {}) {
    const baseCmd = `PLAY ${channel}-${layer}`;
    const cmd = name ? `${baseCmd} "${name}"` : baseCmd;
    await this.sendRaw(cmd, 'single');
  }

  async stop({ channel = 1, layer = 1 } = {}) {
    const cmd = `STOP ${channel}-${layer}`;
    await this.sendRaw(cmd, 'single');
  }

  async pause({ channel = 1, layer = 1 } = {}) {
    const cmd = `PAUSE ${channel}-${layer}`;
    await this.sendRaw(cmd, 'single');
  }
}

export const casparClient = new CasparClient({
  host: process.env.CASPAR_HOST || '127.0.0.1',
  port: process.env.CASPAR_PORT ? Number(process.env.CASPAR_PORT) : 5250,
});
