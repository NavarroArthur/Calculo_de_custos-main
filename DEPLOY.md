# 🚀 Guia de Deploy — Calculadora de Custos

Este guia leva o programa do seu computador para a internet, com segurança.

## Como o sistema é dividido

O projeto tem **duas partes** que rodam em lugares diferentes:

- **Front-end (o site)** → vai para o **GitHub Pages**. É a pasta `web/` (HTML, CSS, JS). É o que o usuário abre no navegador. O GitHub Pages só serve arquivos estáticos — e o site é exatamente isso.
- **Back-end (a API + banco)** → vai para o **Railway** (ou Render). É o `api.py` + `database.py` + `calculos.py`. Roda o Python e guarda o banco.

> ⚠️ **Importante:** o GitHub Pages **não** roda Python nem hospeda banco de dados — ele só entrega arquivos prontos. Por isso a API e o banco precisam ficar num servidor de verdade (Railway/Render). Não dá para colocar o banco "no GitHub".

Os dois conversam pela internet: o site (GitHub Pages) chama a API (Railway) via `fetch`.

---

## ✅ Antes de começar

- [ ] O código está no GitHub (o `.gitignore` já ignora `*.db` e backups).
- [ ] Você tem conta no **Railway** (railway.app). Dá para entrar com o GitHub.
- [ ] Gere uma **SECRET_KEY** aleatória. No terminal:
  ```bash
  python -c "import secrets; print(secrets.token_hex(32))"
  ```
  Copie o resultado (sequência longa) e guarde.

---

## Parte 1 — Publicar a API no Railway

### 1.1 Criar o projeto
1. No Railway: **New Project → Deploy from GitHub repo** e escolha este repositório.
2. O Railway detecta o `Procfile` sozinho e sobe a API com o **gunicorn**. Não precisa configurar comando.

### 1.2 Variáveis de ambiente
No serviço → aba **Variables**, adicione:

| Variável | Valor | Para quê |
| --- | --- | --- |
| `SECRET_KEY` | (a chave aleatória gerada) | Assina os tokens de login |
| `ADMIN_SENHA` | (a senha que você quer para o admin) | Sua senha de acesso |
| `ADMIN_EMAIL` | (opcional) ex.: `voce@empresa.com` | E-mail do admin (padrão: `admin@calculadora.local`) |
| `FRONTEND_URL` | (preencha na Parte 3) | Restringe o CORS ao seu site |

> Não defina `FLASK_ENV=development` em produção (o debug fica desligado, que é o correto).

### 1.3 Banco de dados persistente (MUITO importante)
O disco do Railway é **efêmero**: a cada deploy ele é apagado, e o banco junto. Para não perder dados:

1. No serviço → **Settings → Volumes → New Volume**. Monte num caminho, ex.: **`/data`**.
2. Adicione a variável:

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | `/data/calculos_beneficiamento.db` |

   Assim o banco fica no volume persistente e sobrevive aos deploys.

### 1.4 Pegar a URL da API
Em **Settings → Networking → Generate Domain**. Vai gerar algo como:
```
https://seu-projeto.up.railway.app
```
Guarde — é o endereço da sua API.

### 1.5 Testar
Abra no navegador: `https://seu-projeto.up.railway.app/api/health`.
Deve aparecer um JSON com `"status": "ok"`. Se aparecer, a API está no ar. 🎉

> **Alternativa ao Railway:** o **Render** (render.com) funciona igual — crie um *Web Service*, aponte para o repo, use o *Start Command* `gunicorn api:app`, um **Disk** persistente para o banco, e as mesmas variáveis.

---

## Parte 2 — Publicar o site no GitHub Pages

### 2.1 Apontar o site para a API
No arquivo **`web/script.js`**, no topo, troque o placeholder pela URL do Railway (com `/api` no final):

```javascript
const PRODUCTION_API_URL = 'https://seu-projeto.up.railway.app/api'; // <-- sua URL do Railway
```

Faça o commit e o push.

### 2.2 Ligar o GitHub Pages
Este projeto já tem um workflow em `.github/workflows/deploy-pages.yml` que publica a pasta `web/` sozinho.

1. No GitHub, vá em **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Pronto. A cada push na `main`, o workflow publica o site. Você acompanha em **Actions**.

### 2.3 Pegar a URL do site
Depois do primeiro deploy, o endereço aparece em **Settings → Pages**. Para um repositório de projeto, é algo como:
```
https://navarroarthur.github.io/Calculo_de_custos-main/
```

---

## Parte 3 — Conectar os dois (fechar o CORS)

1. Volte no Railway → **Variables** e defina o `FRONTEND_URL` com a **origem** do seu site — ou seja, só `https://usuario.github.io`, **sem** o caminho do repositório:

   | Variável | Valor |
   | --- | --- |
   | `FRONTEND_URL` | `https://navarroarthur.github.io` |

   > Por que sem o `/Calculo_de_custos-main/`? Porque o CORS olha só o **domínio** (esquema + host), não o caminho. Colocar o caminho aqui quebraria a checagem.

2. O Railway reinicia a API. Agora ela só aceita chamadas vindas do seu site.

Ciclo fechado: site no GitHub Pages → API no Railway → banco no volume persistente.

---

## Parte 4 — Primeiro acesso e rotina

- **Login:** abra o site, entre com o e-mail do admin (`ADMIN_EMAIL` ou `admin@calculadora.local`) e a `ADMIN_SENHA`.
- **Backup:** em **Configurações → Backup do banco → Baixar backup (.db)**, e guarde o arquivo. Faça isso **com frequência** — é o seu seguro.

---

## 🧯 Problemas comuns

**"Failed to fetch" ao usar o site**
A API não respondeu. Cheque: (1) a `PRODUCTION_API_URL` no `script.js` está correta e com `/api` no fim? (2) `https://.../api/health` abre? (3) a `FRONTEND_URL` no Railway está com a origem certa?

**Erro de CORS no console (F12)**
A `FRONTEND_URL` está diferente da origem do site (barra a mais, http vs https, caminho junto). Use só `https://usuario.github.io`.

**O site abre mas as telas/estilos não carregam**
No GitHub Pages o site fica num subcaminho (`/nome-do-repo/`). Os arquivos do projeto usam caminhos relativos (`style.css`, `script.js`), então funcionam — mas se você adicionar links começando com `/`, eles quebram. Prefira caminhos relativos.

**Os dados sumiram depois de um deploy**
Faltou o **volume persistente** (Parte 1.3) ou a `DATABASE_URL` não aponta para dentro dele.

**Trocar a senha do admin**
Mude `ADMIN_SENHA` no Railway e faça um redeploy.

---

## 🔒 Checklist antes de divulgar a URL

- [ ] `SECRET_KEY` definida (aleatória e longa).
- [ ] `ADMIN_SENHA` definida (não é mais `admin123`).
- [ ] `FRONTEND_URL` definida com a origem do GitHub Pages (CORS restrito).
- [ ] Volume persistente + `DATABASE_URL` configurados.
- [ ] `https://.../api/health` responde e o login funciona.
- [ ] Primeiro backup baixado e guardado.

---

## 🧠 Se a empresa crescer

O SQLite é ótimo para começar. Se um dia forem muitos acessos simultâneos, o passo natural é migrar para **PostgreSQL** (o Railway oferece com um clique). Por enquanto, SQLite + volume persistente + backup regular é suficiente.
