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
assert(/PHOTO_RETENTION_DAYS = 30/.test(html) && /apague os comprovantes até/.test(html), 'lembrete de 30 dias');
assert(/purge_event_photos/.test(sql) && /github_id bigint primary key/.test(sql) && /i\.provider_id = a\.github_id::text/.test(sql), 'retenção e lista por id no build');
assert(!/user_name/.test(sql.slice(sql.indexOf('_may_organize'), sql.indexOf('_may_organize') + 600)), 'lista não usa login');
for (const f of ['README.md', 'SETUP-CELULAR.md', 'docs/VALIDACAO.md']) assert(!/^\s*delete from storage\.objects/mi.test(fs.readFileSync(path.join(root, f), 'utf8')), f + ': delete direto em storage.objects (bloqueado no Supabase)');
for (const f of fs.readdirSync(path.join(root, 'supabase', 'migrations'))) assert(!/delete\s+from\s+storage\.objects/i.test(fs.readFileSync(path.join(root, 'supabase', 'migrations', f), 'utf8')), f + ': delete direto em storage.objects');
console.log('PRIVACY/GOVERNANCE CHECKS PASSED (.gitignore, datas fictícias, URL assinada ≤ 300 s, sem getPublicUrl, sem person_diet/cron, grants por coluna, aviso CPF/saúde, retenção 30 dias, lista por id GitHub)');
