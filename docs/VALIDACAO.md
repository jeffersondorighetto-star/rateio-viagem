# Validação com a viagem real (depois de 12/10)

Objetivo: conferir se o evento compartilhado dá **os mesmos acertos** que as famílias fizeram de verdade, usando os dados reais **só dentro do Supabase**, num evento de teste.

> **Dados reais nunca entram no repositório**: nem o JSON exportado, nem capturas com nomes, nem fixtures de teste. Os testes automáticos continuam só com dados inventados.

## Quem faz o quê
- **Jefferson:** exporta o JSON no celular dele e faz a importação num evento de teste (é o organizador).
- **Bot / Cratos:** acompanham pela conversa; recebem só **totais e saldos das famílias A, B, C e D** (números), não o arquivo nem nomes. A correspondência «A = qual família» fica só com o Jefferson.

## Passo a passo (cerca de 15 min)
1. **Exportar** (no celular onde a viagem foi lançada, modo local): Acertos › Dados › **Exportar JSON**. O arquivo `rateatouille-AAAA-MM-DD.export.json` fica no celular. Pode ter fotos e dieta: **não mande no grupo nem no chat**.
2. **Anotar o que foi acertado de verdade**: para cada família, quanto pagou ou recebeu no acerto final (Pix feitos). Uma tabela simples no Notes basta, já com as famílias rotuladas **A, B, C e D** (sem sobrenome).
3. **Criar o evento de teste** (Supabase já configurado): Criar ou entrar em evento › Entrar com GitHub › nome `TESTE validação viagem` (deixe claro que é teste). Não mande o link para ninguém.
4. **Importar**: Acertos › Dados › **Importar JSON** e escolha o arquivo. Confira a prévia antes de tocar em Importar:
   - famílias, pessoas e gastos: **Arquivo = Depois**;
   - **diferença máxima ≤ R$ 0,01**;
   - se aparecer o aviso de «por porções» (o evento não usa o cardápio local), anote a diferença mostrada.
5. **Comparar**: em Acertos, compare **Quem paga quem** e os **saldos por família** com a tabela do passo 2.
   - Se a viagem foi acertada «por porções» com cardápio, rode a comparação também com **Por pessoa** e **Tudo igual** e anote qual bate.
   - Divergência acima de R$ 1,00 por família: anote família, valor no app, valor real e um palpite (gasto esquecido, estimado não corrigido, sem nota não confirmado).
6. **Conferir que nada sensível subiu**: no Supabase, Table Editor › `people` e `expenses` não devem ter dieta nem alergia (a dieta fica só no aparelho; **não existe tabela de dieta** no banco). Na importação, as fotos antigas do JSON ficam só no aparelho (não sobem para o bucket).
7. **Mandar no chat só os números**: «Família A: app R$ x × real R$ y» (e B, C, D) e o modo de divisão. Sem nomes de pessoas nem de famílias.
8. **Limpar no mesmo dia** (o plano Free não tem backup e guarda log de API por 1 dia): Acertos › Dados › **Travar evento** e depois **Sair do evento neste aparelho**. Depois, no SQL Editor:
   ```sql
   -- 1) comprovantes do evento (o Storage não apaga em cascata)
   delete from storage.objects where bucket_id = 'comprovantes'
     and name like (select id::text from public.events where name = 'TESTE validação viagem') || '/%';
   -- 2) o evento (apaga em cascata famílias, pessoas, gastos, receitas, cardápio, confirmações e acertos)
   delete from public.events where name = 'TESTE validação viagem';
   -- 3) conferir: tudo 0
   select (select count(*) from public.events where name = 'TESTE validação viagem') as eventos,
          (select count(*) from public.people p where not exists (select 1 from public.events e where e.id = p.event_id)) as pessoas_orfas,
          (select count(*) from storage.objects o where o.bucket_id = 'comprovantes'
             and not exists (select 1 from public.events e where o.name like e.id::text || '/%')) as fotos_orfas;
   ```
   Se o SQL Editor recusar o `delete` em `storage.objects`, apague pela tela: Storage › `comprovantes` › pasta do evento › Delete. Apague também o JSON do celular se não for mais usar.

## Critério de aceite
- Contagens e total iguais na prévia; diferença máxima ≤ R$ 0,01 na conversão.
- Saldos por família iguais aos acertados de verdade (± R$ 1,00), ou divergência explicada por lançamento.
- Nenhum dado de saúde no servidor; no fim, 0 linhas do evento em `people`, `expenses` e `storage.objects`.
- No chat, só números das famílias A–D.
