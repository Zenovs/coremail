// ─── Profil-Export/-Import (v7.3.0) ──────────────────────────────────────────
// Konten + Kategorien (Sidebar-Aufteilung) + Signaturen + Microsoft-Token in eine
// verschlüsselte Datei packen, um CoreMail auf einem neuen Rechner einzurichten.
//
// Sicherheitsmodell:
//  - Beim Export wird ein zufälliges Einmal-Passwort erzeugt (125 Bit). Es wird
//    nirgends gespeichert, nur einmal angezeigt.
//  - Schlüssel = scrypt(Passwort, Salt) → AES-256-GCM. Der Header (inkl. Ablauf-
//    zeit) ist als AAD authentifiziert: wer expiresAt im Klartext-Header ändert,
//    bricht die Entschlüsselung.
//  - Die Datei ist 5 Minuten gültig. Der Import prüft die Ablaufzeit vor UND nach
//    der Entschlüsselung (Kopie im verschlüsselten Inhalt).
//  - Einmalig: Der importierende Rechner merkt sich die exportId und lehnt jede
//    weitere Verwendung derselben Datei/desselben Passworts ab; die Datei wird
//    nach dem Import standardmässig gelöscht.
//
// Ohne Electron-/IO-Abhängigkeit, damit testbar (tests/profileTransfer.test.js).

const crypto = require('crypto');

const PROFILE_FORMAT = 'coremail-profile';
const PROFILE_VERSION = 1;
const PROFILE_VALIDITY_MS = 5 * 60 * 1000;
// Toleranz für leicht abweichende Uhren zwischen altem und neuem Rechner
const CLOCK_SKEW_MS = 2 * 60 * 1000;

// Ohne verwechselbare Zeichen (0/O, 1/I) — 32 Zeichen = 5 Bit pro Zeichen,
// 25 Zeichen = 125 Bit Zufall
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASSWORD_GROUPS = 5;
const PASSWORD_GROUP_LEN = 5;

const DEFAULT_KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 };
// Grenzen für KDF-Parameter aus der Datei — schützt vor absichtlich riesigen
// Werten, die den Import-Rechner lahmlegen würden.
const KDF_LIMITS = { minLogN: 14, maxLogN: 20, r: 8, maxP: 4 };

class ProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function generateOneTimePassword() {
  const groups = [];
  for (let g = 0; g < PASSWORD_GROUPS; g++) {
    let s = '';
    for (let i = 0; i < PASSWORD_GROUP_LEN; i++) {
      s += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
    }
    groups.push(s);
  }
  return groups.join('-');
}

// Eingabe tolerant machen: Kleinbuchstaben, Leerzeichen, Bindestriche egal
function normalizePassword(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validateKdf(kdf) {
  if (!kdf || kdf.name !== 'scrypt') throw new ProfileError('INVALID_FILE', 'Unbekanntes Verschlüsselungsverfahren');
  const { N, r, p, salt } = kdf;
  const logN = Math.log2(N);
  if (!Number.isInteger(logN) || logN < KDF_LIMITS.minLogN || logN > KDF_LIMITS.maxLogN
      || r !== KDF_LIMITS.r || !Number.isInteger(p) || p < 1 || p > KDF_LIMITS.maxP
      || typeof salt !== 'string' || Buffer.from(salt, 'base64').length < 16) {
    throw new ProfileError('INVALID_FILE', 'Ungültige Verschlüsselungsparameter');
  }
}

function deriveKey(password, kdf) {
  const { N, r, p } = kdf;
  const salt = Buffer.from(kdf.salt, 'base64');
  return new Promise((resolve, reject) => {
    crypto.scrypt(normalizePassword(password), salt, 32, { N, r, p, maxmem: 256 * N * r + 32 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// Feste Feldreihenfolge → reproduzierbare AAD, unabhängig vom JSON-Parser
function headerAad(h) {
  return Buffer.from(JSON.stringify([
    h.format, h.version, h.exportId, h.createdAt, h.expiresAt,
    h.kdf.name, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt
  ]), 'utf8');
}

async function encryptProfile(payload, password, { now = Date.now(), validityMs = PROFILE_VALIDITY_MS, kdf = DEFAULT_KDF } = {}) {
  const header = {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportId: crypto.randomUUID(),
    createdAt: now,
    expiresAt: now + validityMs,
    kdf: { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p, salt: crypto.randomBytes(16).toString('base64') },
  };
  const key = await deriveKey(password, header.kdf);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(headerAad(header));
  const inner = JSON.stringify({ exportId: header.exportId, expiresAt: header.expiresAt, data: payload });
  const ciphertext = Buffer.concat([cipher.update(inner, 'utf8'), cipher.final()]);
  key.fill(0);
  return {
    ...header,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

// Header lesen + Plausibilität prüfen (ohne Passwort) — für die Anzeige im
// Import-Dialog. Wirft ProfileError.
function parseProfileFile(text) {
  let file;
  try { file = JSON.parse(text); } catch (_) {
    throw new ProfileError('INVALID_FILE', 'Keine gültige CoreMail-Profildatei');
  }
  if (!file || file.format !== PROFILE_FORMAT) throw new ProfileError('INVALID_FILE', 'Keine gültige CoreMail-Profildatei');
  if (file.version !== PROFILE_VERSION) throw new ProfileError('INVALID_FILE', 'Profildatei stammt aus einer nicht unterstützten CoreMail-Version');
  if (typeof file.exportId !== 'string' || !Number.isFinite(file.createdAt) || !Number.isFinite(file.expiresAt)
      || typeof file.iv !== 'string' || typeof file.tag !== 'string' || typeof file.ciphertext !== 'string') {
    throw new ProfileError('INVALID_FILE', 'Profildatei ist beschädigt');
  }
  validateKdf(file.kdf);
  return file;
}

// Zeit- und Einmaligkeitsprüfung — vor dem (teuren) Entschlüsseln
function checkProfileUsable(file, { now = Date.now(), usedIds = [] } = {}) {
  if (usedIds.includes(file.exportId)) {
    throw new ProfileError('ALREADY_USED', 'Diese Profildatei wurde bereits importiert und ist nicht mehr gültig');
  }
  if (now > file.expiresAt) {
    throw new ProfileError('EXPIRED', 'Die Profildatei ist abgelaufen (nur 5 Minuten gültig). Bitte auf dem alten Rechner neu exportieren.');
  }
  if (file.createdAt > now + CLOCK_SKEW_MS || file.expiresAt - file.createdAt > PROFILE_VALIDITY_MS) {
    throw new ProfileError('INVALID_TIME', 'Die Zeitangaben der Profildatei sind ungültig. Stimmt die Uhrzeit auf beiden Rechnern?');
  }
}

async function decryptProfile(file, password, { now = Date.now(), usedIds = [] } = {}) {
  checkProfileUsable(file, { now, usedIds });
  const key = await deriveKey(password, file.kdf);
  let inner;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
    decipher.setAAD(headerAad(file));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(file.ciphertext, 'base64')), decipher.final()]);
    inner = JSON.parse(plain.toString('utf8'));
  } catch (_) {
    // GCM-Fehler: falsches Passwort ODER manipulierte Datei — bewusst nicht unterschieden
    throw new ProfileError('WRONG_PASSWORD', 'Falsches Passwort oder beschädigte Datei');
  } finally {
    key.fill(0);
  }
  if (!inner || inner.exportId !== file.exportId || inner.expiresAt !== file.expiresAt || !inner.data) {
    throw new ProfileError('INVALID_FILE', 'Profildatei ist beschädigt');
  }
  return inner.data;
}

// Gleiches Konto auf beiden Rechnern erkennen (z.B. schon von Hand erfasst)
function accountIdentity(acc) {
  if (!acc) return null;
  if (acc.type === 'microsoft') {
    const email = (acc.microsoft?.email || '').toLowerCase();
    return email ? `ms:${email}` : null;
  }
  const host = (acc.imap?.host || '').toLowerCase();
  const user = (acc.imap?.username || '').toLowerCase();
  return host && user ? `imap:${user}@${host}` : null;
}

// Importiertes Profil mit dem bestehenden zusammenführen. Bestehende Konten,
// die im Profil nicht vorkommen, bleiben erhalten; gleiche Konten (gleiche id
// oder gleicher Login) werden durch die Profil-Version ersetzt und behalten
// ihre lokale id, damit Caches/Regeln weiter passen.
function mergeProfile(existing, imported) {
  const ex = {
    accounts: Array.isArray(existing?.accounts) ? existing.accounts : [],
    categories: Array.isArray(existing?.categories) ? existing.categories : [],
    signatures: existing?.signatures && typeof existing.signatures === 'object' ? existing.signatures : {},
  };
  const imp = {
    accounts: Array.isArray(imported?.accounts) ? imported.accounts.filter(a => a && typeof a.id === 'string') : [],
    categories: Array.isArray(imported?.categories) ? imported.categories.filter(c => c && typeof c.id === 'string') : [],
    signatures: imported?.signatures && typeof imported.signatures === 'object' ? imported.signatures : {},
    msalCaches: imported?.msalCaches && typeof imported.msalCaches === 'object' ? imported.msalCaches : {},
  };

  // Kategorien: gleiche id oder gleicher Name → bestehende id behalten
  const categories = ex.categories.map(c => ({ ...c }));
  const catIdMap = {};
  for (const cat of imp.categories) {
    const idx = categories.findIndex(c => c.id === cat.id
      || (c.name || '').trim().toLowerCase() === (cat.name || '').trim().toLowerCase());
    if (idx >= 0) {
      catIdMap[cat.id] = categories[idx].id;
      categories[idx] = { ...categories[idx], ...cat, id: categories[idx].id };
    } else {
      catIdMap[cat.id] = cat.id;
      categories.push({ ...cat });
    }
  }
  const fallbackCat = categories.find(c => c.id === 'other')?.id || categories[0]?.id || 'other';

  const accounts = ex.accounts.map(a => ({ ...a }));
  const accIdMap = {};
  let added = 0;
  let updated = 0;
  for (const acc of imp.accounts) {
    const ident = accountIdentity(acc);
    const idx = accounts.findIndex(a => a.id === acc.id || (ident && accountIdentity(a) === ident));
    const categoryId = catIdMap[acc.categoryId] || (categories.some(c => c.id === acc.categoryId) ? acc.categoryId : fallbackCat);
    if (idx >= 0) {
      const localId = accounts[idx].id;
      accIdMap[acc.id] = localId;
      accounts[idx] = { ...acc, id: localId, categoryId };
      updated++;
    } else {
      accIdMap[acc.id] = acc.id;
      accounts.push({ ...acc, categoryId });
      added++;
    }
  }

  const signatures = { ...ex.signatures };
  for (const [accId, sig] of Object.entries(imp.signatures)) {
    if (accIdMap[accId]) signatures[accIdMap[accId]] = sig;
  }
  const msalCaches = {};
  for (const [accId, blob] of Object.entries(imp.msalCaches)) {
    if (accIdMap[accId] && typeof blob === 'string' && blob) msalCaches[accIdMap[accId]] = blob;
  }

  return {
    accounts, categories, signatures, msalCaches,
    importedAccountIds: Object.values(accIdMap),
    stats: { added, updated, categories: imp.categories.length },
  };
}

module.exports = {
  PROFILE_FORMAT, PROFILE_VERSION, PROFILE_VALIDITY_MS, ProfileError,
  generateOneTimePassword, normalizePassword, encryptProfile, parseProfileFile,
  checkProfileUsable, decryptProfile, mergeProfile, accountIdentity,
};
