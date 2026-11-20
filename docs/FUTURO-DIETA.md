# Dieta e alergia no servidor — modelo FUTURO (não ativo)

> Situação no piloto (24 a 30/10): **a dieta fica só no aparelho**. Não há tabela de dieta no banco
> (`person_diet` foi retirada do build; a `0013_hardening.sql` a remove de bancos que já a tinham).
> Revisão de governança: Astreia, 10/10/2026 (achados 2.1 a 2.9).

Este arquivo guarda o modelo que a governança aprovou para quando a dieta for ao servidor. Não é SQL ativo.
Antes de ligar, precisa de: migração nova, testes no Supabase real e nova revisão.

## Campos
- `person_id`.
- `restricoes`: lista fechada — vegetariano, vegano, sem lactose, sem glúten.
- `alergias`: lista fechada — amendoim, castanhas, leite, ovo, soja, trigo, peixe, crustáceos e frutos do mar, gergelim, outro (falar com o responsável).
- `grave boolean`: só para o aviso "não servir nem traços".
- Sem texto livre, sem sintoma, sem remédio, sem diagnóstico, sem data de nascimento.

## Consentimento
- Dado pelo **responsável da família da pessoa** (`event_members.family_id = people.family_id`, com papel de responsável), em caixa própria e destacada.
- Registra `consent_by`, `consent_at`, `consent_text_version` (ex.: `dieta-v1`) e a finalidade fixa. Linha sem versão do texto é recusada.
- Texto v1: "Autorizo mostrar as restrições marcadas de <primeiro nome> a quem organiza a comida deste evento, só para evitar ingredientes. Os dados são apagados quando o evento for travado ou até 3 dias depois do fim, e posso retirar quando quiser."

## Revogação
- RPC `revoke_diet(event, person)`, chamável pelo responsável ou pelo organizador: DELETE físico na hora.

## Visibilidade
- Linha completa só para o organizador e a própria família.
- As outras famílias veem só o alerta da refeição ("restrição: amendoim"), sem o nome da pessoa.

## Retenção e expurgo
- Apagar em `lock_event` ou em D+3 depois de `end_date`, o que vier primeiro.
- Gatilho: `people.deleted_at` preenchido apaga a dieta da pessoa.
- O app chama o expurgo quando o organizador abre o evento depois de `end_date`.
- `pg_cron` diário só como reforço: **o cron não roda com o projeto pausado** (o plano Free pausa após 7 dias sem uso),
  então ele não pode ser a única garantia. Por isso o expurgo agendado também saiu do build atual e volta junto com este modelo.
- Plano Free: sem backup automático, log de API por 1 dia. No Pro, o expurgo vale "até 7 dias depois" (backup).

## Testes exigidos quando voltar
- Membro aprovado sem papel de responsável grava dieta → 42501; família A grava dieta de criança da família B → 42501.
- Valor fora da lista → erro de check; linha sem `consent_text_version` → recusada.
- Depois de `revoke_diet`, nenhuma linha da pessoa existe (nem para o organizador).
- Depois de `lock_event`, 0 linhas de dieta do evento; `cron.job` com `rateio_purge_health` = 1 linha.
- Membro de outra família sem papel de cozinha lê 0 linhas.
- `summaryText` e `shoppingText` não contêm a alergia, "alergia" nem "veg" (já existe em `tests/test.js`).
