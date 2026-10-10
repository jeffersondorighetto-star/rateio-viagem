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

## 2. Criar o projeto (3 min; a espera de 1 a 2 min dá para usar no passo 3)

1. Toque em **New project** (ou abra [supabase.com/dashboard/new](https://supabase.com/dashboard/new)).
2. Preencha:
   - **Project name:** `rateatouille`
   - **Database password:** toque em **Generate a password** e salve no **1Password** (novo item «Supabase rateatouille – banco»). Não mande essa senha para ninguém.
   - **Region:** **South America (São Paulo)**
   - Se aparecer **Enable Data API**, deixe **ligado**.
3. Toque em **Create new project**. Enquanto ele fica pronto (1 a 2 min), já pode seguir para o passo 3.

## 3. Ligar as entradas: famílias sem cadastro e organizador com GitHub (5 min)

As famílias entram só com o código (login anônimo) e ficam **aguardando** até você aprovar. Você, organizador, entra com o GitHub: assim o evento não se perde se trocar de celular e só você aprova quem entra.

1. Abra **[Authentication › Sign In / Providers](https://supabase.com/dashboard/project/_/auth/providers)** (se perguntar, escolha o projeto `rateatouille`).
2. Ligue **Allow anonymous sign-ins** e toque em **Save changes**.
3. Na mesma página, toque em **GitHub** e deixe esta aba aberta. Copie o **Callback URL (for OAuth)** que aparece ali (termina em `/auth/v1/callback`).
4. Em outra aba, abra **[GitHub › New OAuth App](https://github.com/settings/applications/new)** e preencha:
   - **Application name:** `Rateatouille`
   - **Homepage URL:** `https://jeffersondorighetto-star.github.io/rateio-viagem/`
   - **Authorization callback URL:** cole o Callback URL do passo 3
   - Toque em **Register application**.
5. Na página do app no GitHub: copie o **Client ID**; toque em **Generate a new client secret** e copie o segredo (ele só aparece uma vez; se quiser, guarde no 1Password como «GitHub OAuth Rateatouille»).
6. Volte à aba do Supabase (GitHub): ligue **Enable Sign in with GitHub**, cole **Client ID** e **Client Secret** e toque em **Save**.

> O **Client Secret** do GitHub vai **só** nesse campo do painel do Supabase. **Não mande no chat** e não coloque em nenhum arquivo.

## 4. Endereços permitidos para voltar do login (1 min)

1. Abra **[Authentication › URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration)**.
2. **Site URL:** `https://jeffersondorighetto-star.github.io/rateio-viagem/` e toque em **Save changes**.
3. Em **Redirect URLs**, toque em **Add URL**, cole `https://jeffersondorighetto-star.github.io/rateio-viagem/**` e salve.

## 5. Criar as tabelas e as regras (3 min)

1. Abra o script: **[supabase.sql no GitHub](https://github.com/jeffersondorighetto-star/rateio-viagem/blob/rateio-e2/supabase/supabase.sql)** e toque no ícone **Copiar** (dois quadradinhos, «Copy raw file»), no topo do arquivo.
   - Se o ícone não aparecer, abra a **[versão crua](https://raw.githubusercontent.com/jeffersondorighetto-star/rateio-viagem/rateio-e2/supabase/supabase.sql)**, toque e segure no texto, **Selecionar tudo** e **Copiar**.
2. Abra **[SQL Editor › New query](https://supabase.com/dashboard/project/_/sql/new)**.
3. Toque na área de texto, segure e **Colar**. Confira que a primeira linha começa com `-- ====` e a última fala em «RLS enabled».
4. Toque em **Run**. Se aparecer um aviso sobre operação destrutiva ou «RLS», toque em **Run this query** para confirmar. O esperado é **Success. No rows returned**.
   O script cria também o espaço privado de fotos **comprovantes** (Storage) e as regras de dieta, que o app ainda não usa.
5. Pode rodar de novo sem problema: o script não apaga nada.

## 6. Copiar o endereço e a chave pública (1 min)

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

## Depois de publicado: primeiro uso (2 min)

1. Abra o app, toque em **Criar ou entrar em evento › Entrar com GitHub** e autorize.
2. Crie o evento e toque em **Enviar link** para o grupo das famílias.
3. Quem abrir o link fica **Aguardando aprovação**. Você aprova em **Acertos › Dados › Membros**.
4. Fim da viagem e acerto feito: **Travar evento** (fica só leitura). Link vazou: **Trocar código**.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Erro no **Run** do SQL | Copie o texto do erro e mande no chat. Não precisa apagar nada: dá para rodar o script de novo. |
| No login com GitHub aparece «redirect_uri» ou volta para a página errada | Confira o **Authorization callback URL** no GitHub (passo 3.4) e as **Redirect URLs** (passo 4). |
| «Provider is not enabled» ao entrar com GitHub | No passo 3.6, ligue **Enable Sign in with GitHub** e salve. |
| Não acho «Allow anonymous sign-ins» | Em Authentication, procure em **Sign In / Providers** ou **Providers**. É a primeira opção da página. |
| O projeto «pausou» depois de uma semana sem uso | Abra o painel e toque em **Restore project**. Os dados não somem. |
| Mandei a chave secret, o Client Secret do GitHub ou a senha sem querer | Avise no chat. Chave secret: Settings › API Keys, gere nova e apague a antiga. Client Secret: no app OAuth do GitHub, gere outro, apague o antigo e cole o novo no Supabase. Senha: Settings › Database › **Reset database password**. |
