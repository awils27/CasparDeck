// hyperdeck-emu.js
import net from 'node:net';

import { FAKE_DEVICE } from './state.js';
import { parseCommand, sendMultiline } from './protocol.js';
import { ClientSession } from './session.js';
import { handleCommand } from './handlers.js';
import { log } from './log.js';

const PORT = 9993;

const server = net.createServer(socket => {
  const session = new ClientSession(socket);

  log(
    session.id,
    `Client connected from ${socket.remoteAddress} ${socket.remotePort}`,
  );

  socket.setEncoding('utf8');

  // 500 connection info on connect
  sendMultiline(socket, session.id, 500, 'connection info', [
    `protocol version: ${FAKE_DEVICE.protocolVersion}`,
    `model: ${FAKE_DEVICE.model}`,
  ]);

  let buffer = '';

  socket.on('data', data => {
  buffer += data;

  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep last partial

  for (let rawLine of lines) {
    rawLine = rawLine.replace(/\r$/, ''); // strip CR

    if (!rawLine.trim()) continue;

    const trimmedLower = rawLine.trim().toLowerCase();
    const isNoisy =
  trimmedLower.startsWith('slot info') ||
  trimmedLower.startsWith('transport info') ||
  trimmedLower.startsWith('clips count');

    // Don’t spam logs with these
    if (!isNoisy) {
      log(session.id, `RAW > "${rawLine}"`);
    }

    const parsed = parseCommand(rawLine);
    if (!parsed) {
      if (!isNoisy) {
        log(session.id, 'WARN could not parse line');
      }
      continue;
    }

    const { command, params } = parsed;

    if (!isNoisy) {
      log(
        session.id,
        `CMD > ${command} params=${JSON.stringify(
          Object.fromEntries(params),
        )}`,
      );
    }

    handleCommand(session, command, params);
  }
});


  socket.on('close', () => {
    log(session.id, 'Client disconnected');
  });

  socket.on('error', err => {
    log(session.id, 'Socket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`HyperDeck emulator listening on 0.0.0.0:${PORT}`);
});
