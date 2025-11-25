// protocol.js
import { log } from './log.js';

export const CRLF = '\r\n';
export const line = (s = '') => s + CRLF;

// Very simple single-line command parser.
//
// Supports:
//   "cmd"
//   "cmd: param: value param2: value2"
//   two-word commands like "device info", "slot info", "transport info", "clips count"
export function parseCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return null;

  const lower = trimmed.toLowerCase();

  // Two-word commands we care about
  const twoWordCommands = [
    'device info',
    'slot info',
    'transport info',
    'clips count',
    'clips get',
  ];

  let command = null;
  for (const c of twoWordCommands) {
    if (lower.startsWith(c)) {
      command = c; // keep as lower case
      break;
    }
  }

  let startIndex = 0;
  if (command) {
    // Consume the same number of tokens as the two-word command
    const wordCount = command.split(' ').length;
    startIndex = wordCount;
  } else {
    // Fallback: first token is command (strip trailing ":")
    let cmdToken = tokens[0];
    command = cmdToken.replace(/:$/, '').toLowerCase();
    startIndex = 1;
  }

  const params = new Map();

  // Parse "param name: value" pairs out of remaining tokens
  let i = startIndex;
  while (i < tokens.length) {
    // Collect words until we hit one ending with ':'
    let nameParts = [];
    while (i < tokens.length && !tokens[i].endsWith(':')) {
      nameParts.push(tokens[i]);
      i++;
    }
    if (i >= tokens.length) break; // no ":" -> done

    // Add the last part which *does* end with ':'
    nameParts.push(tokens[i]);
    i++;

    const nameWithColon = nameParts.join(' ');
    const paramName = nameWithColon.replace(/:$/, '');

    if (i >= tokens.length) break;
    const value = tokens[i];
    i++;

    params.set(paramName.toLowerCase(), value);
  }

  return { command, params };
}

export function sendMultiline(
  socket,
  clientId,
  code,
  text,
  paramLines,
  options = {},
) {
  const { suppressLog = false } = options;

  if (!suppressLog) {
    log(clientId, `< ${code} ${text}:`);
  }
  socket.write(line(`${code} ${text}:`));

  for (const l of paramLines) {
    if (!suppressLog) {
      log(clientId, `< ${l}`);
    }
    socket.write(line(l));
  }
  socket.write(CRLF); // blank line terminator
}

