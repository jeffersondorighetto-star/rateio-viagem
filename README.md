# Racha da Viagem · protótipo

Protótipo clicável para dividir os gastos de uma viagem entre 4 famílias. É **um único arquivo** (`index.html`) com HTML, CSS e JS embutidos: sem servidor, sem banco de dados, sem CDN e sem dados bancários. Tudo roda no navegador e fica salvo no próprio aparelho.

## Como abrir
- Dê dois cliques em `index.html` (abre em qualquer navegador moderno, celular ou computador), **ou**
- sirva a pasta: `python3 -m http.server 8080` e abra `http://localhost:8080`.
- Teste da lógica: `node test.js` (deve terminar com `ALL TESTS PASSED`).

## Regras de divisão
- **Comida, Mercado e Combustível** (`scope: 'all'`): divididos igualmente entre **todas as pessoas** das 4 famílias.
- **Álcool** (`scope: 'drinkers'`): dividido só entre as pessoas marcadas como **"bebe"**. Se ninguém estiver marcado, aparece um aviso e o valor é dividido entre todos (para a conta continuar fechando).
- **Saldo** de cada pessoa = `pago − parte devida`. Positivo = recebe; negativo = deve. Saldo da família = soma dos membros. A soma de todos os saldos é sempre zero.
- **Quem paga quem** (`settle`): algoritmo guloso; a cada passo, o maior devedor paga ao maior credor o menor dos dois valores. Gera no máximo 3 transferências entre as 4 famílias. Valores arredondados em centavos.

## Famílias pré-preenchidas (dados de exemplo)
| Família | Membros (✓ = bebe) |
|---|---|
| Família Bonifácio | Carlos ✓, Ana ✓, Pedro, Lia |
| Família Botelho | Marcos ✓, Júlia, Rafa ✓ |
| Família Vasconcelos | Beto ✓, Clara ✓, Davi, Nina |
| Família Sena | Tiago ✓, Bia, Leo |

São 7 despesas de exemplo (R$ 3.180 no total) e caixinha de R$ 900 por família. Nomes de família e membros e o botão "bebe" podem ser editados no card **Famílias e membros**, onde também dá para adicionar e remover membros. Se você remover alguém que pagou despesas, o app pede confirmação e remove essas despesas junto.

## Funcionalidades
- **Total ao vivo** (card de resumo, e total compacto na barra fixa ao rolar): o valor anima a cada mudança e mostra a média por pessoa, o número de despesas, o número de pessoas e quantas bebem.
- **Nova despesa**: valor, categoria em botões grandes, quem pagou (agrupado por família) e descrição opcional. Tem **atalhos rápidos** (Mercado, Gasolina, Churrasco, Pedágio…). **Toque numa despesa** para editar; o ✕ exclui.
- **Quem paga quem**: lista família → família com o mínimo de transferências. O botão ✓ marca uma transferência como paga (fica salvo em `settled`; se os saldos mudarem e o valor mudar, a marcação deixa de valer).
- **Saldo por família e pessoa**: pago, parte e saldo, com cores (verde recebe, vermelho deve). Toque na família para ver cada membro.
- **Gastos por categoria**: gráfico de rosca em SVG puro, com legenda, valores, % e barras.
- **Sobra da viagem**: valor que cada família põe na caixinha. Mostra uma barra de progresso do gasto contra o orçamento, quanto sobra ou falta, e para cada família `contribuição − parte devida` (recebe de volta ou completa).
- **Modo surpresa**: sorteia quem paga a próxima. Peso de cada pessoa = `1 + 4 × max(0, parte − pago) / média por pessoa`, então quem pagou menos que a sua parte tem mais chance. O nome gira rapidamente e para no sorteado, e as maiores chances aparecem em %.
- **Compartilhar resumo**: texto pronto para WhatsApp (negrito com `*`) com totais, categorias, saldos, transferências e caixinha. Transferências pagas aparecem com "✓ pago". Tem botões **Copiar**, **Compartilhar** (`navigator.share`, ou cópia se não houver) e **WhatsApp** (`https://wa.me/?text=…`).
- **Visual**: verde-exército suave com um destaque oliva, ícones SVG de traço único, números tabulares alinhados à direita, verde/vermelho suaves para saldos, contraste AA nos dois temas, validação de valor, estados vazios, safe-area do iPhone. Tema claro/escuro (segue o sistema; botão no topo), layout mobile-first (390px+) e duas colunas no desktop.

## Armazenamento
Tudo fica só no `localStorage` do navegador (chave `racha-viagem-v1`; o tema fica em `racha-viagem-v1-theme`). Nada é enviado para servidor nenhum. **Restaurar exemplo** apaga as alterações e recarrega os dados de exemplo. Como os dados ficam por aparelho e navegador, cada pessoa vê a própria cópia. Para combinar entre famílias, use o **resumo para WhatsApp**.

> **Futuro: sincronização compartilhada.** Se um dia quiserem editar juntos em tempo real, dá para plugar um backend (ex.: Firebase Firestore, com um documento por viagem e despesas como mapa por id, última gravação vence). A ponte `window.App` (`getState`, `replaceState`, `onLocalChange`) já existe para isso. Hoje não há nenhum serviço externo.

## Visual e acessibilidade
Paleta verde-exército suave: oliva `#4F5D2F` como destaque no tema claro, sálvia `#A9B88A` no escuro, superfícies `#F4F6EE`/`#E8ECDD` (claro) e `#1A1D16`/`#23271E` (escuro). Saldos usam verde-azulado (a receber) e terracota (a pagar), distintos do oliva. Categorias com tons terrosos: oliva, sálvia, ardósia e terracota (famílias: oliva, cáqui, ardósia, terracota). Todas as cores são variáveis CSS (`--cat-*`, `--fam-*`) e mudam com o tema. O contraste foi auditado com `node contrast.js`: todo texto ≥ 4,5:1 (AA) nos dois temas, e elementos gráficos ≥ 3:1.

## Como estender (onde mexer no `index.html`)
A lógica pura fica entre `// ===== LOGIC-START` e `// ===== LOGIC-END` (o `test.js` usa esse trecho).
- **Nova categoria**: adicione uma entrada em `CATEGORIES` (`label`, `icon` (chave do mapa de ícones `P`), `color`, `scope: 'all' | 'drinkers'`). O gráfico, os botões, a legenda e o resumo se atualizam sozinhos.
- **Mudar a regra de divisão**: em `computeSplit(state)`, no trecho que escolhe `group` (lista de quem divide cada despesa). Exemplo: criar um novo `scope` como `'adults'` com um novo flag nos membros, ou dividir por família em vez de por pessoa.
- **Algoritmo de acerto**: `settle(entities)`. Funciona com famílias ou pessoas: `settle(split.persons)` gera o acerto pessoa a pessoa.
- **Caixinha**: `kitty(state, split)`.
- **Peso do modo surpresa**: `surpriseWeights(split)` (constantes `1` e `4`) e `weightedPick`.
- **Texto do WhatsApp**: `summaryText(state, split, xfers, k)`.
- **Moeda/formatação**: `brl(n)`. Troque `'pt-BR'`/`'BRL'` (ex.: `'en-US'`/`'USD'`). Para ler valores digitados, use `parseMoney` no script de UI.
- **Famílias, membros e despesas de exemplo / renomear padrão**: função `example()` no script de UI. Cores: `FAMILY_COLORS` e `CATEGORIES[].color` apontam para variáveis CSS (`--fam-1..4`, `--cat-*`) definidas em `:root` e `[data-theme="dark"]`. Para usar mais ou menos de 4 famílias, edite `example()`; o restante se adapta.
- **Atalhos rápidos**: array `QUICK` (`[rótulo, categoria, descrição]`).
- **Visual**: variáveis CSS em `:root` (claro) e `[data-theme="dark"]` (escuro).
- Ao mudar o formato do estado, troque a chave `KEY` (ex.: `racha-viagem-v2`) para não carregar dados antigos incompatíveis.

## Arquivos
- `index.html`: o app inteiro
- `contrast.js`: auditoria de contraste WCAG (Playwright)
- `test.js`: teste da lógica (`node test.js`)
- `README.md`: este arquivo
- `screenshot-*.png`: capturas mobile e desktop
