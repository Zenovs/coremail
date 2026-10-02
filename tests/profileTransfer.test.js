// Tests für Profil-Export/-Import (lib/profileTransfer.js) — v7.3.0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROFILE_VALIDITY_MS, generateOneTimePassword, normalizePassword, encryptProfile,
  parseProfileFile, decryptProfile, mergeProfile,
} = require('../lib/profileTransfer');

// Kleines N, damit die Tests schnell laufen (liegt noch innerhalb der Grenzen)
const FAST_KDF = { name: 'scrypt', N: 2 ** 14, r: 8, p: 1 };
const T0 = Date.UTC(2026, 9, 2, 8, 0, 0);
const PAYLOAD = {
  accounts: [{ id: 'acc_1', name: 'Arbeit', categoryId: 'work', imap: { host: 'imap.x.ch', username: 'a@x.ch', password: 'geheim' } }],
  categories: [{ id: 'work', name: 'Arbeit', color: '#3b82f6' }],
  signatures: {},
  msalCaches: {},
};

const roundtrip = async (opts = {}) => {
  const pw = generateOneTimePassword();
  const file = await encryptProfile(PAYLOAD, pw, { now: T0, kdf: FAST_KDF });
  return { pw, file: parseProfileFile(JSON.stringify(file)), ...opts };
};

test('Einmal-Passwort: Format, Alphabet, Zufälligkeit', () => {
  const pw = generateOneTimePassword();
  assert.match(pw, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){4}$/);
  assert.notEqual(pw, generateOneTimePassword());
  assert.equal(normalizePassword(' abcde-fghjk '), 'ABCDEFGHJK');
});

test('Roundtrip: richtiges Passwort innerhalb der 5 Minuten', async () => {
  const { pw, file } = await roundtrip();
  assert.equal(file.expiresAt - file.createdAt, PROFILE_VALIDITY_MS);
  assert.ok(!JSON.stringify(file).includes('geheim'), 'Klartext darf nicht in der Datei stehen');
  const data = await decryptProfile(file, pw.toLowerCase().replace(/-/g, ' '), { now: T0 + 4 * 60 * 1000 });
  assert.deepEqual(data, PAYLOAD);
});

test('Nach 5 Minuten abgelaufen — auch mit richtigem Passwort', async () => {
  const { pw, file } = await roundtrip();
  await assert.rejects(decryptProfile(file, pw, { now: T0 + PROFILE_VALIDITY_MS + 1 }), { code: 'EXPIRED' });
});

test('Ablaufzeit im Header verlängern bricht die Entschlüsselung', async () => {
  const { pw, file } = await roundtrip();
  // Angreifer schiebt das Gültigkeitsfenster 30 Minuten nach hinten
  const shift = 30 * 60 * 1000;
  const tampered = { ...file, createdAt: file.createdAt + shift, expiresAt: file.expiresAt + shift };
  await assert.rejects(decryptProfile(tampered, pw, { now: T0 + shift + 60 * 1000 }), { code: 'WRONG_PASSWORD' });
});

test('Falsches Passwort wird abgelehnt', async () => {
  const { file } = await roundtrip();
  await assert.rejects(decryptProfile(file, generateOneTimePassword(), { now: T0 }), { code: 'WRONG_PASSWORD' });
});

test('Bereits verwendete Datei ist nutzlos', async () => {
  const { pw, file } = await roundtrip();
  await assert.rejects(decryptProfile(file, pw, { now: T0, usedIds: [file.exportId] }), { code: 'ALREADY_USED' });
});

test('Datei aus der Zukunft / überlange Gültigkeit wird abgelehnt', async () => {
  const { pw, file } = await roundtrip();
  await assert.rejects(decryptProfile(file, pw, { now: T0 - 10 * 60 * 1000 }), { code: 'INVALID_TIME' });
});

test('parseProfileFile: Müll und überzogene KDF-Parameter abgelehnt', async () => {
  assert.throws(() => parseProfileFile('kein json'), { code: 'INVALID_FILE' });
  assert.throws(() => parseProfileFile('{"format":"x"}'), { code: 'INVALID_FILE' });
  const { file } = await roundtrip();
  assert.throws(() => parseProfileFile(JSON.stringify({ ...file, kdf: { ...file.kdf, N: 2 ** 30 } })), { code: 'INVALID_FILE' });
});

test('mergeProfile: neue Konten hinzu, gleiche Konten ersetzt mit lokaler id', () => {
  const existing = {
    accounts: [
      { id: 'acc_local', name: 'alt', categoryId: 'work', imap: { host: 'IMAP.x.ch', username: 'A@x.ch', password: 'alt' } },
      { id: 'acc_keep', name: 'bleibt', categoryId: 'other' },
    ],
    categories: [{ id: 'work', name: 'Arbeit' }, { id: 'other', name: 'Sonstiges' }],
    signatures: {},
  };
  const imported = {
    accounts: [
      { id: 'acc_1', name: 'neu', categoryId: 'cat_w', imap: { host: 'imap.x.ch', username: 'a@x.ch', password: 'neu' } },
      { id: 'acc_ms', type: 'microsoft', categoryId: 'cat_gone', microsoft: { email: 'b@y.ch' } },
    ],
    categories: [{ id: 'cat_w', name: 'wireon', color: '#f0f' }, { id: 'work', name: 'Arbeit', color: '#00f' }],
    signatures: { acc_1: { enabled: true } },
    msalCaches: { acc_ms: '{"tok":1}' },
  };
  const r = mergeProfile(existing, imported);
  assert.deepEqual(r.stats, { added: 1, updated: 1, categories: 2 });
  const replaced = r.accounts.find(a => a.id === 'acc_local');
  assert.equal(replaced.imap.password, 'neu');
  assert.equal(replaced.categoryId, 'cat_w');
  assert.ok(r.accounts.some(a => a.id === 'acc_keep'));
  assert.equal(r.accounts.find(a => a.id === 'acc_ms').categoryId, 'other');
  assert.equal(r.categories.find(c => c.id === 'work').color, '#00f');
  assert.deepEqual(r.signatures, { acc_local: { enabled: true } });
  assert.deepEqual(r.msalCaches, { acc_ms: '{"tok":1}' });
  assert.deepEqual(r.importedAccountIds.sort(), ['acc_local', 'acc_ms']);
});
