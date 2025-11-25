// log.js
function ts() {
  return new Date().toISOString();
}

// Simple structured logger
export function log(clientId, ...args) {
  console.log(`[${ts()}] [client ${clientId}]`, ...args);
}
