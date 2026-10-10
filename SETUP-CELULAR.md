# Rateatouille: ligar o banco compartilhado pelo celular (cerca de 15 min)

Tudo dá para fazer no navegador do celular (Safari ou Chrome). Toque em cada link na ordem.
Se algum botão estiver escondido, gire o celular na horizontal ou use «Ver versão para computador».

> **Nunca mande no chat:** a senha do banco, a chave **secret** (`sb_secret_...`) nem a **service_role**.
> **Pode mandar no chat:** a **Project URL** e a chave **publishable** (`sb_publishable_...`) ou **anon**. Essas duas são públicas por natureza; quem protege os dados são as regras do banco.

---

## 1. Criar a conta (2 min)

1. Abra **[supabase.com/dashboard/sign-in](https://supabase.com/dashboard/sign-in)**.
2. Toque em **Continue with GitHub** e autorize com a conta **jeffersondorighetto-star**. Não precisa do Google.
3. Se pedir para criar uma organização: nome `Jefferson`, tipo **Personal**, plano **Free ($0/month)** e toque em **Create organization**. Não pede cartão.

## 2. Criar o projeto (3 min, mais uns 2 min de espera)

1. Toque em **New project** (ou abra [supabase.com/dashboard/new](https://supabase.com/dashboard/new)).
2. Preencha:
   - **Project name:** `rateatouille`
   - **Database password:** toque em **Generate a password** e salve no **1Password** (novo item «Supabase rateatouille – banco»). Não mande essa senha para ninguém.
   - **Region:** **South America (São Paulo)**
   - Se aparecer **Enable Data API**, deixe **ligado**.
3. Toque em **Create new project** e espere a tela dizer que o projeto está pronto (1 a 2 min).

## 3. Ligar a entrada sem cadastro (1 min)

1. Abra **[Authentication › Sign In / Providers](https://supabase.com/dashboard/project/_/auth/providers)** (se perguntar, escolha o projeto `rateatouille`).
2. Ligue **Allow anonymous sign-ins** e toque em **Save changes**.

É isso que deixa as famílias entrarem só com o código do evento, sem e-mail nem senha.

## 4. Criar as tabelas e as regras (3 min)

1. Abra o script: **[supabase.sql no GitHub](https://github.com/jeffersondorighetto-star/rateio-viagem/blob/rateio-e2/supabase/supabase.sql)** e toque no ícone **Copiar** (dois quadradinhos, «Copy raw file»), no topo do arquivo.
   - Se o ícone não aparecer, abra a **[versão crua](https://raw.githubusercontent.com/jeffersondorighetto-star/rateio-viagem/rateio-e2/supabase/supabase.sql)**, toque e segure no texto, **Selecionar tudo** e **Copiar**.
2. Abra **[SQL Editor › New query](https://supabase.com/dashboard/project/_/sql/new)**.
3. Toque na área de texto, segure e **Colar**. Confira que a primeira linha começa com `-- ====` e a última fala em «RLS enabled».
4. Toque em **Run**. Se aparecer um aviso sobre operação destrutiva ou «RLS», toque em **Run this query** para confirmar. O esperado é **Success. No rows returned**.
5. Pode rodar de novo sem problema: o script não apaga nada.

## 5. Copiar o endereço e a chave pública (2 min)

1. Abra **[Settings › API Keys](https://supabase.com/dashboard/project/_/settings/api-keys)**.
2. Copie a chave **Publishable key** (começa com `sb_publishable_`). Se só existir a aba **Legacy**, copie a **anon public**.
   - **Não** copie a **Secret key** nem a **service_role**.
3. Copie a **Project URL**, que é `https://<código-do-projeto>.supabase.co`. Ela aparece no botão **Connect** no topo do projeto, ou em [Settings › Data API](https://supabase.com/dashboard/project/_/settings/api).
4. Mande no chat as duas coisas, por exemplo:
   ```
   URL: https://abcdefghijkl.supabase.co
   Chave: sb_publishable_xxxxxxxx
   ```

Pronto. A partir daqui, o bot coloca essas duas no app, testa e publica.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Erro no **Run** do SQL | Copie o texto do erro e mande no chat. Não precisa apagar nada: dá para rodar o script de novo. |
| Não acho «Allow anonymous sign-ins» | Em Authentication, procure em **Sign In / Providers** ou **Providers**. É a primeira opção da página. |
| O projeto «pausou» depois de uma semana sem uso | Abra o painel e toque em **Restore project**. Os dados não somem. |
| Mandei a chave secret ou a senha sem querer | Avise no chat. Em Settings › API Keys, gere uma chave secret nova e apague a antiga. Para a senha: Settings › Database › **Reset database password**. |
