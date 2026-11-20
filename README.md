# Rateatouille · protótipo

Protótipo clicável para **planejar e dividir** uma viagem de 4 famílias: cardápio por dia, receitas que geram a lista de compras, gastos com e sem nota e o acerto final. É **um único arquivo** (`index.html`) com HTML, CSS e JS embutidos: sem servidor, sem banco de dados, sem CDN e sem dados bancários. Tudo roda no navegador e fica salvo no próprio aparelho.

## Como abrir
- Online: https://jeffersondorighetto-star.github.io/rateio-viagem/
- Local: dê dois cliques em `index.html`, ou rode `python3 -m http.server 8080` e abra `http://localhost:8080`.
- Testes da lógica: `npm test` (ou `node tests/test.js`) na raiz do repositório, sem dependências. São 4 blocos: divisão, lançamento rápido/comprovantes, planejamento e receitas.

## Evento compartilhado (Supabase, branch `rateio-e2`, design completo do Arquitas, alvo 22/11)
Opcional. Com `SUPABASE_URL` e `SUPABASE_ANON_KEY` em `null` (padrão), o app funciona como antes, só no aparelho.
- **Onde configurar:** bloco `window.RATEIO_CONFIG` perto do fim do `index.html` (procure `CONFIGURAÇÃO DO BANCO COMPARTILHADO`). Só a Project URL e a chave publishable/anon, que são públicas por desenho. **Nunca** a secret/service_role, a senha do banco nem o Client Secret do GitHub.
- **Banco:** migrações em ordem em `supabase/migrations/` (fonte da verdade). `supabase/supabase.sql` é **gerado** por `bash supabase/build.sh` (arquivo único para colar no SQL Editor pelo celular; idempotente, também atualiza um banco criado com o script do MVP). Passo a passo: [`SETUP-CELULAR.md`](SETUP-CELULAR.md).

| Migração | O que faz |
|---|---|
| `0001_core_tables` | eventos, segredo do código (sha256 para busca + bcrypt), membros, famílias, pessoas, gastos, acertos; `updated_at`/autoria por gatilho |
| `0002_membership_access` | papel `organizer`/`member`, status `pending`/`approved`/`revoked`, `locked` no evento; RLS: só **aprovado** lê, só aprovado com evento destravado grava; sem DELETE para clientes |
| `0003_event_rpcs` | `organizer_allowlist` (quem pode criar evento, pelo **id numérico** do GitHub = `auth.identities.provider_id`, que não muda como o login; editada só no SQL Editor), `create_event` (GitHub **e** na lista), `join_event` (fica pendente; 5 erros em 10 min bloqueiam; **sem nome do evento até aprovar**), `my_membership`, `approve_member`, `revoke_member`, `set_member_role` |
| `0004_versioning_ops` | `version` por linha + gatilho que recusa versão velha (`PT409` = HTTP 409); `rotate_code` (opção de pedir nova aprovação de todos), `lock_event`, `rename_event`; `client_ops` + `apply_ops` (lote idempotente por `op_id`, patch só dos campos alterados, devolve a linha atual em conflito) |
| `0005_confirmations_overrides` | `expense_confirmations` só-inserção (uma ativa por gasto; família do pagador não confirma; **membro só confirma pela própria família**, organizador por qualquer uma; troca de pagador/comprovante anula) e `event_overrides` (peso/preço/quantidade) |
| `0006_storage_comprovantes` | bucket privado `comprovantes`, caminho `<evento>/<gasto>.jpg`, até 150 KB, JPEG/WebP; ler/enviar: aprovados; trocar/apagar: organizador |
| `0008_realtime` | tabelas no Realtime |
| `0009_organizer_settings_roles` | configurações (datas, refeições, divisão, caixinha, pesos/preços) **só organizador** (RLS + `update_event_settings`); `set_member_role`/`revoke_member` protegem o último organizador e quem criou |
| `0010_recipes_meal_plan` | `recipes` e `meal_plan` compartilhados, com versão (aprovados editam) |
| `0011_delta_sync` | `updated_at` em tudo que sincroniza (reconexão busca só o que mudou) |
| `0013_hardening` | revisão de governança: remove `person_diet` e o expurgo de bancos antigos; **INSERT/UPDATE por coluna** (a mesma lista do `apply_ops`) em todas as tabelas; `event_members` sem UPDATE de cliente; `set_member_family` (organizador) |
| `0014_photo_retention` | `purge_event_photos(evento)` (só organizador: tira a foto dos gastos e devolve a lista de arquivos; o app apaga pela Storage API, porque o Supabase bloqueia `delete` direto em `storage.objects`) e `event_photo_status` (fotos restantes e prazo = fim + 30 dias) |

Privilégios: INSERT/UPDATE são concedidos **por coluna** (pelo PostgREST direto ninguém troca `event_id`, `id`, `created_by`, `version` no INSERT, `confirmed_*` ou a família de um membro). SELECT é por tabela, filtrado pela RLS (só aprovado do evento). Não há DELETE para clientes. `0007` e `0012` (dieta e expurgo) foram **retiradas do build**: a dieta fica só no aparelho no piloto; o modelo aprovado para o futuro está em [`docs/FUTURO-DIETA.md`](docs/FUTURO-DIETA.md) (o expurgo agendado volta junto com ele; pg_cron não roda com o projeto pausado).

- **Entrada:** famílias entram anônimas com o código de 8 caracteres (sem 0/O/1/I/L) e veem **Aguardando aprovação** (sem nome nem dados do evento) até o organizador aprovar. O organizador entra com **GitHub** e precisa estar na `organizer_allowlist`. Link `…/rateio-viagem/#CÓDIGO`.
- **Painel do organizador (Acertos › Dados):** membros com Aprovar/Recusar/Remover, **família de cada membro**, **Tornar organizador / Tirar de organizador** (o último organizador e quem criou são protegidos), **Trocar código** e **Travar/Destravar**.
- **Configurações só do organizador:** para membros, datas, refeições, modo de divisão, caixinha, pesos, preços e quantidades aparecem desabilitados com o aviso «Só o organizador muda…»; se algo forçar a mudança, ela volta ao valor do servidor com aviso.
- **Gravação com versão:** cada aparelho manda só os campos que mudou, com a versão que conhecia (`apply_ops`). Campos diferentes: as duas edições ficam. **Mesmo campo: vale o servidor** + aviso. Repetir a mesma operação (resposta perdida) não duplica (`op_id`). Reconexão busca só as linhas com `updated_at` novo (5 s de folga).
- **Sincroniza:** evento e configurações, pesos/preços/quantidades, famílias, pessoas (só primeiro nome, tipo, bebe, chegada/saída), gastos, confirmações, acertos, **receitas e cardápio**. A lista de compras é calculada em cada aparelho a partir disso. Exclusão é lógica (`deleted_at`).
- **Comprovantes (fotos):** no evento, a foto é redesenhada no canvas (sem EXIF/GPS) e enviada como JPEG ≤ 150 KB para `<evento>/<gasto>.jpg`; sem internet fica numa fila no IndexedDB e sobe quando a conexão volta. Ver: URL assinada de **5 min** (nunca URL pública). Membro envia; só o organizador troca ou apaga. No modo local nada muda.
- **Retenção dos comprovantes:** regra de 30 dias. Junto ao botão Foto: «Cubra CPF e nome antes de fotografar». Depois da data de fim, o organizador vê «apague os comprovantes até DD/MM» com **Apagar agora** (também em Acertos › Dados, com a regra escrita no painel); apaga só as fotos daquele evento. Na colagem de receita, aviso para tirar nomes e dado de saúde.
- **Fica só no aparelho:** **dieta/alergia**.
- **Sem internet:** pílula «Offline» + aviso; o que for lançado fica pendente e é enviado quando a conexão volta, mesclando campo a campo.
- **Dados:** Exportar JSON, Importar JSON (só organizador, com prévia e tolerância R$ 0,01) e «Trazer os dados deste aparelho». `?offline=1` abre a versão local intacta. Validação com a viagem real: [`docs/VALIDACAO.md`](docs/VALIDACAO.md).

## Navegação (barra inferior)
| Aba | O que tem |
|---|---|
| **Início** | Total ao vivo, cartão **Pendente** (sem nota sem confirmação e valores estimados), **Lançamento rápido**, **Próximas refeições** (quem cozinha, alertas de dieta, botão Modo cozinha) e gráfico por categoria. |
| **Planejar** | **Cardápio** (grade dias × refeições + detalhe do dia), **Receitas** (colar e interpretar), **Compras** (lista, custo por prato, prévia por família, planejado × real, preços) e **Pessoas** (tipo, bebe, dieta, chegada/saída, peso da porção). |
| **Gastos** | Formulário completo (comprovante, foto, estimado, calculadora de combustível, itens comprados) e lista com filtros Todas / Pendentes / Sem nota. |
| **Acertos** | Escolha da divisão (com diferença contra “tudo igual”), **Quem paga quem**, saldos por família e pessoa, caixinha, modo surpresa e resumo para WhatsApp. |

## Regras de divisão (`computeSplit` + `splitWeights`)
Três modos, escolhidos em **Acertos → Como dividir**:
- **Por porções (justo)**, o padrão: Comida e Mercado divididos pelas **porções consumidas** de cada pessoa (refeições em que está presente × peso: adulto 1, adolescente 1,2, criança 0,5, bebê 0; refeições “livre” não contam). Álcool só entre quem bebe, proporcional aos **dias presentes**. Combustível igual por pessoa.
- **Por pessoa**: Comida, Mercado e Combustível iguais entre todos; Álcool só entre quem bebe.
- **Tudo igual**: tudo dividido igualmente, inclusive Álcool.

Em todos os modos, **saldo = pago − parte**. A soma dos saldos é zero. **Quem paga quem** (`settle`) é guloso: o maior devedor paga ao maior credor, com no máximo n−1 transferências. Gastos **sem nota ainda não confirmados** entram no acerto por padrão. Dá para tirá-los com o botão “Incluir não confirmados no acerto” (`countedExpenses`).

## Receitas → cardápio → lista de compras
1. **Colar receita** (Planejar → Receitas): cole o texto como veio do WhatsApp ou de um site e toque em **Interpretar**. O parser pt-BR (`parseRecipe` / `parseIngredient`, sem API externa) extrai:
   - **título** e **rendimento** (“rende 6 porções”, “serve 4”, “(serve 10 pessoas)”, “6 a 8” vira 7; 4 se não achar, com aviso);
   - **ingredientes**: frações (`1/2`, `½`, `1 e 1/2`, `1 1/2`, “meia”, “uma”), faixas (`2 a 3` vira 2,5), unidades (g, kg, ml, l, xícara, colher de sopa/chá/café, copo, lata, pacote/saco, caixa, dente, unidade, maço, pitada, dúzia, fatia…), conectores “de/do/da” e “a gosto” / “q.b.” (sem quantidade);
   - **modo de preparo**: as linhas depois de “Modo de preparo” (numeração removida), ou linhas que não são ingrediente.
2. **Conversão para base** (g / ml / un): xícara 240 ml, colher de sopa 15 ml, colher de chá 5 ml. Para sólidos medidos em volume, usa a tabela `DENSITY` (arroz 0,77 g/ml, açúcar 0,8, farinha 0,53, feijão, sal, queijo ralado, manteiga…). Latas e pacotes usam `CAN` e `PACK` (molho 340 g, creme de leite 200 g, macarrão 500 g…).
3. **Confiança**: a tabela editável marca em **âmbar** as linhas sem quantidade entendida (preencha a quantidade, ou deixe vazio para “a gosto”) e com borda âmbar as medidas aproximadas (densidade desconhecida). Cada linha mostra o texto original, o valor convertido e o item da lista (ou “item novo · preço estimado”).
4. **Itens e preços**: os nomes são ligados ao catálogo `ITEMS` (seção, embalagem e preço estimado) por `ITEM_SYNONYMS`. Nomes desconhecidos viram itens novos (seção pelo `SECTION_WORDS`, preço por kg/L/un em `SECTION_PRICE`). Todos os preços podem ser editados em Compras → Preços e quantidades.
5. **No cardápio**: em cada refeição “em casa”, adicione uma ou mais receitas. Cada receita é **escalada para as porções ponderadas de quem está presente** naquela refeição (`fator = porções / rendimento`).
6. **Lista de compras** (`shoppingList`): soma todos os ingredientes escalados mais os básicos (água e gelo por pessoa-dia, cerveja por bebedor-dia), arredonda para **embalagens** (pacote de 5 kg, lata, dúzia, maço…) e mostra o custo estimado. Também mostra o **custo por prato** e por porção, a **prévia por família** e o **planejado × real**. Os “Itens comprados” anotados nos gastos (ex.: `picanha 2 kg, carvão, cerveja 2 fardos`) são abatidos e geram o “falta comprar”. **O que comprar hoje** filtra só os próximos 2 dias (antes da viagem: os 2 primeiros dias). Copiar ou WhatsApp geram uma lista com ☐.

### Toques extras
- **Modo cozinha**: tela cheia com letra grande, a receita escalada para quem está naquela refeição (mostra a unidade original, ex. “3 ½ xícaras (≈ 650 g)”), checklist de ingredientes e passos, família que cozinha e que limpa, alertas de dieta e **tela sempre ligada** (Wake Lock, quando o navegador suporta).
- **Escala da cozinha** (`kitchenRota`): para cada refeição em casa, escolhe a família que **cozinha** e a que **limpa**, equilibrando pelo peso de porções de cada família (quem come mais trabalha mais). Aparece como a letra da família na grade, no detalhe do dia e em Próximas refeições.
- **Dieta por pessoa** (vegetariano, sem lactose, sem glúten, alergias em texto livre): cada refeição com receita em conflito ganha um ponto âmbar na grade e um alerta dizendo quem, o motivo e o ingrediente (`dietConflicts`, `mealConflicts`).
- **Custo por porção** de cada receita na biblioteca.

## Gastos sem nota
- **Lançamento rápido** (`parseQuick`): uma linha, por exemplo `80 gasolina família B sem nota`, `churrasco 350 pago pela família D` ou `~200 gasolina Marcso` (aceita erro de digitação). Mostra uma prévia (valor, categoria, quem pagou, comprovante, estimado) antes de lançar. Tem botão de ditado por voz (pt-BR) quando o navegador suporta.
- **Comprovante**: Nota fiscal / Comprovante (Pix, cartão) / Sem nota. Dá para anexar uma **foto**, comprimida para um JPEG pequeno (~60 KB) salvo no aparelho, com aviso se o armazenamento estiver enchendo, e uma observação.
- **Confirmação**: um gasto sem nota fica “Aguardando confirmação” até **outra família** tocar em Confirmar. Fica registrado quem confirmou.
- **Estimado**: o valor aparece como “~R$” e na lista de Pendentes até ser trocado pelo valor real. Tem uma calculadora de combustível (km ÷ km/L × R$/L) com o botão “Usar valor”.
- O resumo do WhatsApp agrupa por tipo de comprovante e lista os itens não confirmados e os estimados.

## Dados de exemplo
Tudo inventado: famílias, nomes e dietas são fictícios.

| Família | Membros (✓ = bebe) | Observações |
|---|---|---|
| Família A | Carlos ✓, Ana ✓, Pedro (adolescente), Lia (criança) | |
| Família B | Marcos ✓, Júlia, Rafa ✓ | |
| Família C | Beto ✓, Clara ✓ (vegetariana, fictício), Davi (criança, alergia a kiwi, fictício), Nina (bebê) | |
| Família D | Tiago ✓, Bia (alergia a abacaxi, fictício), Leo (criança) | chegam no jantar de 28/12 |

Viagem de 26/12/2026 a 03/01/2027 (9 dias; café, almoço e jantar), com refeições em casa, fora e livres. Há 4 receitas cadastradas (Churrasco completo, Arroz carreteiro, Macarrão à bolonhesa e Café da manhã completo) já distribuídas no cardápio, incluindo o churrasco do réveillon. São 10 gastos: 2 sem nota aguardando confirmação, 1 sem nota já confirmado e 1 estimado. A caixinha é de R$ 1.200 por família. **Restaurar exemplo** (no rodapé) volta tudo ao início.

## Armazenamento
Tudo fica só no `localStorage` do navegador. Nada vai para servidor nenhum. Cada aparelho tem a própria cópia; para alinhar entre as famílias, use os textos para WhatsApp. (Para editar juntos em tempo real no futuro, dá para plugar um backend usando a ponte `window.App`.)

| Chave | Conteúdo |
|---|---|
| `racha-viagem-v3` | dados da viagem (famílias, gastos, cardápio, receitas, preços) |
| `racha-viagem-v3-ui` | aba, sub-aba e filtros abertos |
| `racha-viagem-v1-theme` | tema claro/escuro |

> As chaves mantêm o prefixo antigo `racha-viagem` (nome anterior do protótipo) **de propósito**, para não perder dados já salvos nos aparelhos. O nome oficial agora é **Rateatouille**. Para renomear as chaves, troque `KEY`, `UI_KEY` e `THEME_KEY` no script de UI. Os dados antigos não são migrados.

## Visual e acessibilidade
Paleta verde-exército suave (oliva `#4F5D2F` no claro, sálvia `#A9B88A` no escuro), saldos em verde-azulado e terracota, âmbar para pendências. Tem tema claro e escuro, barra inferior com áreas de toque de 52 px (vira barra superior no desktop) e safe-area do iPhone. `npm run test:contrast` audita **todas as abas**: todo texto ≥ 4,5:1 (AA). A captura (`npm run shots`) checa vazamento de layout em 320, 360, 375, 390 e 430 px, inclusive com fonte mais larga.

## Como estender (onde mexer no `index.html`)
A lógica pura fica entre `// ===== LOGIC-START` e `// ===== LOGIC-END` (usada por `tests/test.js`). A interface fica no segundo `<script>`.
- **Categoria de gasto**: `CATEGORIES` (`label`, `icon`, `color`, `scope: 'all' | 'drinkers'`).
- **Regras de divisão**: `splitWeights(state, category, people, P)` (pesos por modo) e `SPLIT_MODES`. **Pesos das porções**: `MEMBER_TYPES` (ou edite em Pessoas).
- **Refeições / modos**: `MEALS`, `MEAL_ORDER`, `MODES`. **Presença**: `presenceRange`. **Porções**: `portions(state)`.
- **Parser de receitas**: unidades em `UNIT_RE` / `UNIT_LABEL` / `VOL_ML`, frações em `FRAC` / `WORDNUM`, densidades em `DENSITY`, latas e pacotes em `CAN` / `PACK`, líquidos em `LIQUIDS` / `LIQUID_WORDS`.
- **Catálogo de compras**: `ITEMS` (nome, seção, unidade, embalagem, preço), `ITEM_SYNONYMS`, `SECTIONS`, `STAPLES`, `RESTAURANT_DEFAULT`. Itens novos: `customDef`, `SECTION_WORDS`, `SECTION_PRICE`.
- **Dieta**: `DIET` (palavras que conflitam com cada restrição). **Escala da cozinha**: `kitchenRota`.
- **Lançamento rápido**: palavras em `CAT_WORDS`, `PROOF_WORDS`, `EST_WORDS`, `STOP`.
- **Textos de WhatsApp**: `summaryText` e `shoppingText`. **Moeda**: `brl(n)`.
- **Dados de exemplo**: `example()` e `SEED_RECIPES` no script de UI.
- Ao mudar o formato do estado, troque `KEY` para não carregar dados antigos.

## Estrutura do repositório
```
index.html          o app inteiro (HTML + CSS + JS, publicado no GitHub Pages)
README.md           este arquivo
.nojekyll           serve os arquivos como estão no Pages
package.json        scripts npm (sem dependências de produção)
.gitignore          ignora node_modules/, shots/ e *.png
tests/test.js       testes da lógica (Node puro)
tests/contrast.js   auditoria de contraste WCAG AA em todas as abas (Playwright)
tests/overflow.js   auditoria de texto vazando / cortado em várias larguras (Playwright)
tests/shot3.js      capturas das telas + auditoria de layout, salvas em shots/ (ignorada pelo git)
tests/sync.test.js  modo compartilhado com servidor falso em memória (vários aparelhos, aprovação, versões, offline)
tests/fake-core.js  servidor falso que imita o supabase.sql (usado pelos testes de sync e e2e)
tests/e2e/          ponta a ponta com 2–3 celulares (Playwright) contra backend falso
supabase/migrations/ migrações em ordem; supabase/build.sh gera supabase/supabase.sql
supabase/test/      stub do Supabase, testes de RLS (psql) e supabase-js contra PostgREST local
docs/VALIDACAO.md   roteiro de validação com os dados reais da viagem (só fora do repositório)
```

## Como rodar os testes
- `node tests/sync.test.js`: mapeamento estado ⇄ linhas (sem vazar dieta/foto local) e motor de sincronização contra `tests/fake-core.js`: allowlist, pendente sem nome, configurações só do organizador, promover/rebaixar ao vivo, confirmação pela própria família, receitas/cardápio e lista de compras iguais, **3 aparelhos com edições intercaladas** (um offline por rodada), **reconexão por delta**, **replay idempotente** com respostas perdidas, fila de fotos (offline, URL de 5 min, troca/apagar só organizador), travar/remover/trocar código.
- `node tests/e2e/shared.e2e.js`: ponta a ponta no Chrome a 375 px com 3 celulares e backend falso (configurações só leitura para membro, família do membro, promover/rebaixar, **foto com EXIF chega ao bucket sem EXIF**, URL assinada ≤ 5 min, foto offline no IndexedDB, organizador apaga comprovante): login GitHub (simulado) e criar evento, importar, entrar por link, código errado, **Aguardando aprovação**, organizador aprova, lançar e ver ao vivo, acerto, offline + conflito no mesmo campo (aviso), travar/destravar, `?offline=1`, trocar código (link antigo falha; aprovado volta a aguardar), remover membro; contraste AA e overflow em todas as telas novas. Também: aviso de CPF junto à foto, aviso de saúde na receita e o lembrete de 30 dias que apaga só as fotos do evento.
- `PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash supabase/test/run.sh`: gera o `supabase.sql`, roda 3 vezes num Postgres local com stub do Supabase (idempotência, inclusive com dados), atualiza um banco criado pelo script do MVP e roda `rls_test.sql` (312 verificações, incluindo a matriz de isolamento: 2 eventos × de fora/pendente/revogado/organizador do outro/membro dos dois × todas as tabelas, bucket e RPCs; grants por coluna; allowlist; ausência de `person_diet`) e testa a atualização a partir do rascunho que tinha dieta.
- `NODE_PATH=<dir com @supabase/supabase-js> node supabase/test/postgrest.test.js`: supabase-js 2.117.3 + motor do app contra PostgREST 12 local com o SQL real (ver `supabase/test/README.md`).

Os comandos rodam na raiz do repositório.
- **Lógica** (sem instalar nada, só Node 18+): `npm test`
- **Navegador** (contraste, vazamento de layout, capturas): precisam do `playwright-core` (devDependency) e de um Chrome/Chromium instalado.
  ```
  npm install
  CHROME_PATH=/caminho/do/chrome npm run test:contrast   # padrão: /usr/bin/google-chrome
  npm run test:overflow
  npm run shots            # opções: THEME=light, W=320 WIDE=1 (fonte mais larga), URL=https://… (testar a versão online)
  ```

Todos os dados do app são de exemplo (nomes fictícios de famílias e pessoas, valores inventados). Não há chaves, tokens nem dados bancários.
