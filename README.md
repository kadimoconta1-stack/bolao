# Bolão de Placar Exato (Next.js + Supabase + Telegram)

Este é um sistema moderno, seguro e responsivo para gerenciamento de bolões de placar exato de futebol. Desenvolvido para dispensar servidores próprios (no-serverless backend manual), rodando inteiramente na **Vercel** (frontend) e no **Supabase** (banco de dados PostgreSQL + Edge Functions seguras).

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS v4, HTML5 Semântico.
- **Segurança & Backend:** Supabase PostgreSQL com Row Level Security (RLS) habilitado em todas as tabelas.
- **Regras de Negócio e Ações Sensíveis:** Supabase Edge Functions escritas em TypeScript rodando sobre Deno.
- **Automação de Moderadores:** Telegram Bot API (com webhook e botões interativos para aprovação direta pelo celular).
- **Hospedagem Front:** Vercel.

---

## 📁 Estrutura de Pastas Principal

```text
├── app/                  # Páginas do frontend (App Router)
│   ├── admin-[slug]/     # Painel de administração oculto por slug
│   ├── consulta/         # Consulta pública de palpites por código
│   ├── transparencia/    # Quadro de transparência pública dos palpites pagos
│   ├── lib/              # Inicializador da conexão com Supabase Client
│   ├── globals.css       # Folha de estilos globais (design system e temas)
│   └── page.tsx          # Tela pública principal e formulário
├── supabase/
│   ├── migrations/       # Scripts SQL das tabelas, índices, RLS e Views
│   └── functions/        # Deno Edge Functions
│       ├── get-captcha/       # Geração de captcha criptográfico de uso único
│       ├── register-bet/      # Validação rigorosa e criação de palpites pendentes
│       ├── telegram-webhook/  # Recebimento de callbacks do Telegram (Aprovar/Recusar)
│       └── admin-actions/     # Operações do admin (Login, Config, Lançar Placar)
├── .env.example          # Exemplo de chaves necessárias
└── README.md             # Guia de implantação do sistema
```

---

## 🚀 Instalação e Execução Local

### 1. Clonar e Instalar Dependências
```bash
# Instalar os pacotes do Next.js
npm install
```

### 2. Configurar o Banco de Dados no Supabase
1. Crie um projeto gratuito ou pago no [Supabase](https://supabase.com).
2. Acesse a aba **SQL Editor** do painel do seu projeto.
3. Copie as queries do arquivo [01_schema.sql](file:///c:/Users/Matheus/Downloads/bolao%20placar%20exato/supabase/migrations/01_schema.sql) e clique em **Run** para criar a estrutura de tabelas, índices e views seguras.

### 3. Configurar as Variáveis de Ambiente locais
Crie um arquivo `.env.local` na raiz do projeto contendo as credenciais de seu projeto Supabase e as senhas do admin (use o `.env.example` como molde).
> ⚠️ **IMPORTANTE:** A senha do admin no banco de dados deve ser salva como hash SHA-256 no campo `ADMIN_PASSWORD_HASH`. Exemplo: se sua senha for `admin123`, salve o hash `24078914ba08bd23d65aa5f1865673a3d7c49cc3a3630a9e70192e2ec77f27e1`.

### 4. Deploy das Supabase Edge Functions
Se estiver utilizando a **Supabase CLI**, faça o deploy das funções diretamente para a sua instância:
```bash
# Efetuar login no Supabase via terminal
supabase login

# Inicializar link com seu projeto
supabase link --project-ref seu-project-ref-id

# Configurar as variáveis seguras no ambiente Deno do Supabase
supabase secrets set TELEGRAM_BOT_TOKEN="seu_token" TELEGRAM_ADMIN_CHAT_ID="seu_chat_id" TELEGRAM_WEBHOOK_SECRET="seu_secret" ADMIN_PASSWORD_HASH="seu_hash"

# Deploy de todas as funções
supabase functions deploy get-captcha
supabase functions deploy register-bet
supabase functions deploy telegram-webhook
supabase functions deploy admin-actions
```

### 5. Rodar o Frontend Localmente
```bash
npm run dev
```
Acesse `http://localhost:3000` no seu navegador.

---

## 🤖 Configurando o Webhook do Telegram

Para permitir que você aprove ou recuse palpites clicando nos botões interativos diretamente do Telegram:

1. Fale com o [@BotFather](https://t.me/BotFather) no Telegram e digite `/newbot` para gerar seu bot e obter o Token.
2. Inicie uma conversa com seu bot clicando em "Começar" ou enviando `/start`.
3. Pegue seu Chat ID usando bots de auditoria como o `@userinfobot`.
4. Faça uma requisição GET no navegador para a API do Telegram registrando o webhook apontando para a sua Edge Function:
   ```text
   https://api.telegram.org/bot<SEU_BOT_TOKEN>/setWebhook?url=https://<SEU_PROJETO_SUPABASE>.supabase.co/functions/v1/telegram-webhook?secret=<TELEGRAM_WEBHOOK_SECRET>
   ```
5. Você receberá uma confirmação `{"ok":true,"result":true,"description":"Webhook was set"}`.

---

## 📈 Comandos de Produção do Frontend

```bash
# Testar a compilação do Next.js e TypeScript
npm run build

# Executar linter para validação de erros de formatação
npm run lint
```

---

## 🔒 Regras de Segurança Implementadas

1. **Privacidade Total:** A tabela principal `bets` está protegida por RLS. Visitantes comuns não possuem permissão de SELECT direta. Toda consulta por código passa pela View segura `public_bets_consultation`, que omite totalmente as colunas de nome e telefone.
2. **Prevenção de Duplicidades:** Se o mesmo telefone tentar enviar exatamente o mesmo palpite de placar na mesma rodada, o backend intercepta a ação e retorna o código do palpite já existente ao invés de duplicar.
3. **Bloqueio de Pendentes:** Enquanto um usuário tiver um palpite em estado `PENDING` (aguardando pagamento), o backend bloqueia novas inserções daquele mesmo número para evitar abuse do sistema.
4. **Captcha Server-side:** Os captchas são gerados com tokens assinados com expiração de 5 minutos e marcados como utilizados após a primeira tentativa. A resposta correta nunca é exposta no HTML.
5. **Prevenção de Double-Click:** O botão de envio do formulário é desabilitado instantaneamente ao clicar para evitar registros múltiplos acidentais.
