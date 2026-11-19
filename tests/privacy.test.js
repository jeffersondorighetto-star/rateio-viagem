// Verificações de governança (revisão Astreia, 10/10/2026) que não dependem de banco nem navegador.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..'), git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }); } catch (e) { return e.stdout || ''; } };
const ignored = f => { try { execFileSync('git', ['check-ignore', '-q', f], { cwd: root }); return true; } catch (e) { return false; } };
// 5.2 .gitignore cobre fotos, planilhas, dumps e exportações, sem esconder arquivos versionados
for (const f of ['x.jpg', 'x.jpeg', 'x.heic', 'x.webp', 'x.csv', 'dump.sql', 'dump-2031.sql', 'x.backup', 'x.dump', 'exports/a.json', 'data/a.json', 'rateatouille-2031-03-05.export.json', 'racha-viagem-v3.json'])
  assert(ignored(f), '.gitignore não cobre ' + f);
for (const f of git('ls-files').split('\n').filter(Boolean)) assert(!ignored(f), 'arquivo versionado ficaria ignorado: ' + f);
// 5.3 nada de datas reais da viagem em testes/fixtures
assert.strictEqual(git('grep', '-n', '-E', '2026-10-1[0-2]', '--', 'tests', 'supabase/test').trim(), '', 'datas da viagem real em testes');
// 4.1 nunca URL pública; URL assinada de no máximo 300 s
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(!/getPublicUrl/.test(html), 'getPublicUrl no app'); const ttl = Number((/PHOTO_URL_TTL = (\d+)/.exec(html) || [])[1]); assert(ttl > 0 && ttl <= 300, 'URL assinada > 300 s');
// 2.1 sem person_diet ativa no build (só a remoção)
const sql = fs.readFileSync(path.join(root, 'supabase', 'supabase.sql'), 'utf8');
assert(!/create table[^;]*person_diet/i.test(sql) && !/grant[^;]*person_diet/i.test(sql) && /drop table if exists public\.person_diet/.test(sql), 'person_diet no build');
assert(!/cron\.schedule/.test(sql), 'expurgo agendado no build');
assert(!fs.existsSync(path.join(root, 'supabase', 'migrations', '0007_person_diet.sql')));
// 1.1 nenhuma concessão de UPDATE/INSERT por tabela inteira às tabelas sincronizadas (só por coluna)
assert(!/grant\s+(select,\s*)?(insert|update)[^(;]*\bon\s+public\.(families|people|expenses|settlement_marks|event_overrides|expense_confirmations|recipes|meal_plan|event_members)\b/i.test(sql), 'grant de tabela inteira');
// N1 aviso de CPF no campo da foto + regra de 30 dias; N2 lista por id numérico; N3 aviso de saúde na receita
const ph = html.indexOf('id="photo"'), cpf = html.indexOf('Cubra CPF e nome antes de fotografar');
assert(ph > 0 && cpf > ph && cpf - ph < 300, 'aviso de CPF junto ao campo de foto');
const rp = html.indexOf('id="recPaste"'), rh = html.indexOf('id="recPrivHint"');
assert(rp > 0 && rh > rp && rh - rp < 600 && /dado de saúde/.test(html.slice(rh, rh + 300)), 'aviso de saúde no campo de colar receita');
assert(/PHOTO_RETENTION_DAYS = 7\b/.test(html) && /apague os comprovantes até/.test(html), 'lembrete de 7 dias');
// Praia Brava: exportação sem saúde e sem foto; sync só com a chave do RLS real; consentimento e aviso fixo
assert(/function safeExportState/.test(html) && /delete m\.diet/.test(html) && /delete e\.photo/.test(html), 'export sem saúde/foto');
assert(/SYNC_ENABLED: false/.test(html) && /CFG\.SYNC_ENABLED === true/.test(html), 'sync desligado até o RLS real passar');
assert(/Retirar autorização/.test(html) && /O app ajuda a lembrar\. Quem confirma o ingrediente/.test(html), 'consentimento e aviso fixo');
assert(!/getPublicUrl|tesseract|ocr\.space|vision\.googleapis|openai/i.test(html), 'sem OCR/IA externa');
assert(/purge_event_photos/.test(sql) && /github_id bigint primary key/.test(sql) && /i\.provider_id = a\.github_id::text/.test(sql), 'retenção e lista por id no build');
assert(!/user_name/.test(sql.slice(sql.indexOf('_may_organize'), sql.indexOf('_may_organize') + 600)), 'lista não usa login');
for (const f of ['README.md', 'SETUP-CELULAR.md', 'docs/VALIDACAO.md']) assert(!/^\s*delete from storage\.objects/mi.test(fs.readFileSync(path.join(root, f), 'utf8')), f + ': delete direto em storage.objects (bloqueado no Supabase)');
for (const f of fs.readdirSync(path.join(root, 'supabase', 'migrations'))) assert(!/delete\s+from\s+storage\.objects/i.test(fs.readFileSync(path.join(root, 'supabase', 'migrations', f), 'utf8')), f + ': delete direto em storage.objects');
// 5.4 sobrenomes reais das famílias nunca no repositório. Só os SHA-256 dos nomes normalizados
// (minúsculas, sem acento) ficam aqui; cada palavra dos arquivos versionados é normalizada, hasheada e comparada.
{
  const crypto = require('crypto'), { execFileSync } = require('child_process');
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
      if (BANNED.has(crypto.createHash('sha256').update(w).digest('hex'))) bad.push(f);
    }
  }
  assert.deepStrictEqual(bad, [], 'sobrenome real de família em: ' + bad.join(', '));
}
// Hefesto: um texto só, verdadeiro, sobre onde fica a alergia (aviso do evento, rodapé e tela de dados usam a mesma frase)
{ const NOTE = 'Alergia, intolerância e dieta ficam só no aparelho onde foram digitadas: não vão para o evento compartilhado, para o servidor nem para o backup.';
  assert(html.includes(`const HEALTH_LOCAL_NOTE = '${NOTE}'`), 'frase única definida');
  assert(html.includes(`<span data-health-note>${NOTE}</span>`), 'aviso do evento usa a frase');
  assert(/footNote'\)\.textContent = [^\n]*HEALTH_LOCAL_NOTE/.test(html), 'rodapé usa a frase');
  for (const old of ['Cardápio, receitas, compras e dieta/alergia ficam', 'fotos, cardápio, receitas e dieta ficam só neste aparelho', 'Fotos, cardápio, receitas e dieta ficam só neste aparelho', '<b>Ficam só neste aparelho:</b> dieta/alergia'])
    assert(!html.includes(old), 'aviso antigo contraditório: ' + old); }
// config do cliente: só URL + chave PUBLICÁVEL; nunca chave secreta/service_role/JWT de serviço
{ const m = html.match(/SUPABASE_ANON_KEY:\s*'([^']*)'/); if (m) assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(m[1]), 'chave do cliente não é publicável');
  assert(!/sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ/.test(html), 'segredo no index.html'); }
console.log('PRIVACY/GOVERNANCE CHECKS PASSED (aviso único de onde fica a alergia, .gitignore, datas fictícias, URL assinada ≤ 300 s, sem getPublicUrl, sem person_diet/cron, grants por coluna, aviso CPF/saúde, retenção 7 dias, export sem saúde, chave de sync, consentimento, sem OCR externo, lista por id GitHub, sem sobrenomes reais)');
