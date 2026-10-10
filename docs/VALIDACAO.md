# Validação com a viagem real (depois de 12/10)

Objetivo: conferir se o evento compartilhado dá **os mesmos acertos** que as famílias fizeram de verdade, usando os dados reais **só dentro do Supabase**, num evento de teste.

> **Dados reais nunca entram no repositório**: nem o JSON exportado, nem capturas com nomes, nem fixtures de teste. Os testes automáticos continuam só com dados inventados.

## Quem faz o quê
- **Jefferson:** exporta o JSON no celular dele e faz a importação num evento de teste (é o organizador).
- **Bot / Cratos:** acompanham pela conversa; recebem só os **totais e saldos por família** (números), não o arquivo.

## Passo a passo (cerca de 15 min)
1. **Exportar** (no celular onde a viagem foi lançada, modo local): Acertos › Dados › **Exportar JSON**. O arquivo `rateatouille-AAAA-MM-DD.export.json` fica no celular. Pode ter fotos e dieta: **não mande no grupo nem no chat**.
2. **Anotar o que foi acertado de verdade**: para cada família, quanto pagou ou recebeu no acerto final (Pix feitos). Uma tabela simples no Notes basta.
3. **Criar o evento de teste** (Supabase já configurado): Criar ou entrar em evento › Entrar com GitHub › nome `TESTE validação viagem` (deixe claro que é teste). Não mande o link para ninguém.
4. **Importar**: Acertos › Dados › **Importar JSON** e escolha o arquivo. Confira a prévia antes de tocar em Importar:
   - famílias, pessoas e gastos: **Arquivo = Depois**;
   - **diferença máxima ≤ R$ 0,01**;
   - se aparecer o aviso de «por porções» (o evento não usa o cardápio local), anote a diferença mostrada.
5. **Comparar**: em Acertos, compare **Quem paga quem** e os **saldos por família** com a tabela do passo 2.
   - Se a viagem foi acertada «por porções» com cardápio, rode a comparação também com **Por pessoa** e **Tudo igual** e anote qual bate.
   - Divergência acima de R$ 1,00 por família: anote família, valor no app, valor real e um palpite (gasto esquecido, estimado não corrigido, sem nota não confirmado).
6. **Conferir que nada sensível subiu**: no Supabase, Table Editor › `people` e `expenses` não devem ter dieta, alergia nem fotos (dieta e fotos ficam no aparelho nesta versão). `person_diet` deve estar vazia.
7. **Mandar no chat só os números**: por família, «app × real» e o modo de divisão. Sem nomes de pessoas.
8. **Limpar**: Acertos › Dados › **Travar evento** e depois **Sair do evento neste aparelho**. Para apagar de vez: SQL Editor › `delete from public.events where name = 'TESTE validação viagem';` (apaga em cascata famílias, pessoas, gastos e acertos desse evento). Apague também o JSON do celular se não for mais usar.

## Critério de aceite
- Contagens e total iguais na prévia; diferença máxima ≤ R$ 0,01 na conversão.
- Saldos por família iguais aos acertados de verdade (± R$ 1,00), ou divergência explicada por lançamento.
- Nenhum dado de saúde ou foto no servidor.
