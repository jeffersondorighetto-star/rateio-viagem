# Racha da Viagem · protótipo

Protótipo clicável para **planejar e dividir** uma viagem de 4 famílias: cardápio por dia, receitas que geram a lista de compras, gastos com e sem nota e o acerto final. É **um único arquivo** (`index.html`) com HTML, CSS e JS embutidos: sem servidor, sem banco de dados, sem CDN e sem dados bancários. Tudo roda no navegador e fica salvo no próprio aparelho.

## Como abrir
- Online: https://jeffersondorighetto-star.github.io/rateio-viagem/
- Local: dê dois cliques em `index.html`, ou rode `python3 -m http.server 8080` e abra `http://localhost:8080`.
- Testes da lógica: `node test.js` (4 blocos: divisão, lançamento rápido/comprovantes, planejamento e receitas).

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
- **Lançamento rápido** (`parseQuick`): uma linha, por exemplo `80 gasolina Botelho sem nota`, `churrasco 350 pago por Sena` ou `~200 gasolina Marcso` (aceita erro de digitação). Mostra uma prévia (valor, categoria, quem pagou, comprovante, estimado) antes de lançar. Tem botão de ditado por voz (pt-BR) quando o navegador suporta.
- **Comprovante**: Nota fiscal / Comprovante (Pix, cartão) / Sem nota. Dá para anexar uma **foto**, comprimida para um JPEG pequeno (~60 KB) salvo no aparelho, com aviso se o armazenamento estiver enchendo, e uma observação.
- **Confirmação**: um gasto sem nota fica “Aguardando confirmação” até **outra família** tocar em Confirmar. Fica registrado quem confirmou.
- **Estimado**: o valor aparece como “~R$” e na lista de Pendentes até ser trocado pelo valor real. Tem uma calculadora de combustível (km ÷ km/L × R$/L) com o botão “Usar valor”.
- O resumo do WhatsApp agrupa por tipo de comprovante e lista os itens não confirmados e os estimados.

## Dados de exemplo
| Família | Membros (✓ = bebe) | Observações |
|---|---|---|
| Bonifácio | Carlos ✓, Ana ✓, Pedro (adolescente), Lia (criança) | |
| Botelho | Marcos ✓, Júlia, Rafa ✓ | |
| Vasconcelos | Beto ✓, Clara ✓ (vegetariana), Davi (criança, alergia a amendoim), Nina (bebê) | |
| Sena | Tiago ✓, Bia (alergia a camarão), Leo (criança) | chegam no jantar de 28/12 |

Viagem de 26/12/2026 a 03/01/2027 (9 dias; café, almoço e jantar), com refeições em casa, fora e livres. Há 4 receitas cadastradas (Churrasco completo, Arroz carreteiro, Macarrão à bolonhesa e Café da manhã completo) já distribuídas no cardápio, incluindo o churrasco do réveillon. São 10 gastos: 2 sem nota aguardando confirmação, 1 sem nota já confirmado e 1 estimado. A caixinha é de R$ 1.200 por família. **Restaurar exemplo** (no rodapé) volta tudo ao início.

## Armazenamento
Tudo fica só no `localStorage` do navegador: dados em `racha-viagem-v3`, aba/filtros em `racha-viagem-v3-ui` e tema em `racha-viagem-v1-theme`. Nada vai para servidor nenhum. Cada aparelho tem a própria cópia; para alinhar entre as famílias, use os textos para WhatsApp. (Para editar juntos em tempo real no futuro, dá para plugar um backend usando a ponte `window.App`.)

## Visual e acessibilidade
Paleta verde-exército suave (oliva `#4F5D2F` no claro, sálvia `#A9B88A` no escuro), saldos em verde-azulado e terracota, âmbar para pendências. Tem tema claro e escuro, barra inferior com áreas de toque de 52 px (vira barra superior no desktop) e safe-area do iPhone. `node contrast.js` audita **todas as abas**: todo texto ≥ 4,5:1 (AA). A captura (`shot3.js`) checa vazamento de layout em 320, 360, 375, 390 e 430 px, inclusive com fonte mais larga.

## Como estender (onde mexer no `index.html`)
A lógica pura fica entre `// ===== LOGIC-START` e `// ===== LOGIC-END` (usada pelo `test.js`). A interface fica no segundo `<script>`.
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

## Arquivos
- `index.html`: o app inteiro
- `test.js`: testes da lógica
- `contrast.js`: auditoria de contraste WCAG (Playwright)
- `shot3.js`: capturas e auditoria de layout (`THEME=light`, `W=320 WIDE=1`)
- `shots/`: capturas
