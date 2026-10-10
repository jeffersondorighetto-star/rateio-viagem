// Sobrenomes reais das famílias nunca no repositório (governança 5.4). Só os SHA-256 dos nomes normalizados
// (minúsculas, sem acento) ficam aqui; cada palavra dos arquivos versionados é normalizada, hasheada e comparada.
const fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const BANNED = new Set([
  '13fddfce82e8c4e48203b5d1e549fec5b3a1dcba6fadb94711e7842822da2cb3',
  '518ac56ab13f9c685a86079bb4379b941443cf93a4299ff98f71834310e2801d',
  '26ada9053e0416e7a5e30c7e3cf3b00a9df1e760ebce66a6e79d54e8b6d1bca2',
  '08673858c9cdae9dd7d9dcb6db090706f3cde09cdad64e870794d366a37001cb']);
const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const bad = [];
for (const f of files) {
  let buf; try { buf = fs.readFileSync(path.join(root, f)); } catch (e) { continue; }
  if (buf.includes(0)) continue; // binário
  const seen = new Set();
  for (const w of norm(buf.toString('utf8')).split(/[^a-z0-9]+/)) {
    if (!w || seen.has(w)) continue; seen.add(w);
    if (BANNED.has(crypto.createHash('sha256').update(w).digest('hex'))) { bad.push(f); break; }
  }
}
assert.deepStrictEqual(bad, [], 'sobrenome real de família em: ' + bad.join(', '));
console.log(`SURNAME CHECK PASSED (${files.length} arquivos versionados, sem sobrenomes reais)`);
