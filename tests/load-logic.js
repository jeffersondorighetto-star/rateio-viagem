// Carrega as funções puras do index.html (entre LOGIC-START e LOGIC-END) e devolve as que forem pedidas.
const fs = require('fs'), path = require('path');
module.exports = function load(names) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const src = html.split('// ===== LOGIC-START')[1].split('// ===== LOGIC-END')[0];
  return new Function(src.replace(/^[^\n]*\n/, '') + `\nreturn {${names.join(',')}};`)();
};
