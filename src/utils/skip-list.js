import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKIP_FILE = join(__dirname, '../../skip-list.json');

function extractDomain(input) {
  try {
    const url = input.includes('://') ? input : `https://${input}`;
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return input.toLowerCase().replace(/^www\./, '').replace(/\/.*$/, '').trim();
  }
}

function readSkipList() {
  try {
    if (existsSync(SKIP_FILE)) {
      return JSON.parse(readFileSync(SKIP_FILE, 'utf8'));
    }
  } catch {}
  return { domains: [], updated_at: new Date().toISOString() };
}

function writeSkipList(data) {
  writeFileSync(SKIP_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function getSkipList() {
  return readSkipList();
}

export function addDomain(raw) {
  const domain = extractDomain(raw);
  const list = readSkipList();
  if (!list.domains.includes(domain)) {
    list.domains.push(domain);
    list.updated_at = new Date().toISOString();
    writeSkipList(list);
  }
  return { domain, domains: list.domains };
}

export function removeDomain(raw) {
  const domain = extractDomain(raw);
  const list = readSkipList();
  list.domains = list.domains.filter(d => d !== domain);
  list.updated_at = new Date().toISOString();
  writeSkipList(list);
  return list.domains;
}

export function isSkippedDomain(website, email) {
  const list = readSkipList();
  if (!list.domains.length) return false;

  const websiteDomain = website ? extractDomain(website) : null;
  const emailDomain = email ? email.split('@')[1]?.toLowerCase().replace(/^www\./, '') : null;

  return list.domains.some(d => {
    if (websiteDomain && (websiteDomain === d || websiteDomain.endsWith('.' + d))) return true;
    if (emailDomain && (emailDomain === d || emailDomain.endsWith('.' + d))) return true;
    return false;
  });
}

export { extractDomain };
