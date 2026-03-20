import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '../../.engine-state.json');

function readState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  // Default: OFF
  return { enabled: false, updated_at: new Date().toISOString() };
}

function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function isEngineEnabled() {
  return readState().enabled === true;
}

export function setEngineState(enabled) {
  const state = { enabled: !!enabled, updated_at: new Date().toISOString() };
  writeState(state);
  return state;
}

export function getEngineState() {
  return readState();
}
