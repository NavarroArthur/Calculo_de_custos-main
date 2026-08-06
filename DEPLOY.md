# 🚀 Guia de Deploy — Calculadora de Custos

Publica o programa na internet, com segurança. A escolha aqui:

- **Site (pasta `web/`)** → **GitHub Pages** (arquivos estáticos).
- **API + banco (`api.py`, `database.py`, `calculos.py`)** → **PythonAnywhere** (grátis, sempre no ar, com armazenamento que persiste — o SQLite sobrevive).

> Os dois conversam pela internet: o site (GitHub Pages) chama a API (PythonAnywhere) via `fetch`.
> *(Alternativas para a API: Render ou Railway. Mas no plano grátis deles o disco é efêmero/precisa pagar. O PythonAnywhere guarda os dados de graça.)*

Troque **`SEU_USUARIO`** pelo seu nome de usuário do PythonAnywhere em todos os lugares.

---

## Parte 1 — Subir a API no PythonAnywhere

### 1.1 Criar a conta
Crie uma conta **grátis (Beginner)** em **pythonanywhere.com**.

### 1.2 Baixar o código (via Git)
No menu **Consoles → Bash**, abra um terminal e rode:
```bash
git clone https://github.com/NavarroArthur/Calculo_de_custos-main.git
```

### 1.3 Criar o ambiente virtual e instalar as dependências
Ainda no Bash:
```bash
mkvirtualenv --python=/usr/bin/python3.10 calc-env
pip install -r Calculo_de_custos-main/requirements.txt
```
Guarde o nome do ambiente: **`calc-env`**.

### 1.4 Criar o Web app
1. Vá na aba **Web → Add a new web app**.
2. Em framework, escolha **Manual configuration** (não escolha "Flask") → **Python 3.10**.

### 1.5 Configurar o Web app
Na página do Web app, preencha:

- **Source code:** `/home/SEU_USUARIO/Calculo_de_custos-main`
- **Working directory:** `/home/SEU_USUARIO/Calculo_de_custos-main`
- **Virtualenv:** `/home/SEU_USUARIO/.virtualenvs/calc-env`

### 1.6 Editar o arquivo WSGI (é aqui que a mágica acontece)
Clique no link do **WSGI configuration file** (algo como `/var/www/SEU_USUARIO_pythonanywhere_com_wsgi.py`). **Apague tudo** e coloque:

```python
import os
import sys

# --- Variáveis de ambiente (segredos ficam AQUI, no servidor, fora do Git) ---
os.environ['SECRET_KEY'] = 'COLE_AQUI_UMA_CHAVE_ALEATORIA_LONGA'
os.environ['ADMIN_SENHA'] = 'a-senha-que-voce-quer'
os.environ['ADMIN_EMAIL'] = 'voce@exemplo.com'  # opcional
os.environ['FRONTEND_URL'] = 'https://navarroarthur.github.io'
# Caminho ABSOLUTO do banco (garante que ele persista sempre no mesmo lugar)
os.environ['DATABASE_URL'] = '/home/SEU_USUARIO/Calculo_de_custos-main/calculos_beneficiamento.db'
# (OPCIONAL) Monitoramento de erros no Sentry. Deixe comentado se não usar.
# os.environ['SENTRY_DSN'] = 'https://...ingest.sentry.io/...'

# --- Deixa o Python achar o api.py ---
caminho = '/home/SEU_USUARIO/Calculo_de_custos-main'
if caminho not in sys.path:
    sys.path.insert(0, caminho)

# --- Carrega o app Flask ---
from api import app as application
```

> Para gerar a `SECRET_KEY`, rode no seu PC: `python -c "import secrets; print(secrets.token_hex(32))"` e cole o resultado.

### 1.7 Recarregar e testar
1. Volte na aba **Web** e clique no botão verde **Reload**.
2. Abra no navegador: `https://SEU_USUARIO.pythonanywhere.com/api/health`
3. Deve aparecer `{"status": "ok", ...}`. Se aparecer, a API e o banco estão no ar. 🎉

> Se der erro, veja o **Error log** (link na aba Web) — ele mostra a linha exata do problema.

---

## Parte 2 — Publicar o site no GitHub Pages

### 2.1 Apontar o site para a API
No **`web/script.js`**, no topo, troque o placeholder pela URL do PythonAnywhere (com `/api` no fim):
```javascript
const PRODUCTION_API_URL = 'https://SEU_USUARIO.pythonanywhere.com/api';
```
Faça `commit` e `push` (pelo terminal do VS Code):
```bash
git add web/script.js
git commit -m "Aponta o site para a API no PythonAnywhere"
git push
```

### 2.2 Ligar o GitHub Pages
Este projeto já tem o workflow `.github/workflows/deploy-pages.yml` que publica a pasta `web/`.
1. No GitHub, vá em **Settings → Pages**.
2. Em **Source**, escolha **GitHub Actions**.
3. A cada `push` na `main`, o site é publicado. Acompanhe na aba **Actions**.

### 2.3 Pegar a URL do site
Em **Settings → Pages**, aparece algo como:
```
https://navarroarthur.github.io/Calculo_de_custos-main/
```

---

## Parte 3 — Conferir a conexão (CORS)

No arquivo WSGI (Parte 1.6), o `FRONTEND_URL` deve ser a **origem** do site — só `https://navarroarthur.github.io`, **sem** o `/Calculo_de_custos-main/`. Se você já colocou certo, ótimo. Se mudar, edite o WSGI e clique em **Reload** de novo.

> Por quê sem o caminho? O CORS olha só o domínio (esquema + host), não o caminho.

---

## Parte 4 — Primeiro acesso e rotina

- **Login:** abra o site, entre com o e-mail do admin e a `ADMIN_SENHA` que você pôs no WSGI.
- **Backup:** em **Logs → Backup do banco → Baixar backup (.db)**. Faça isso com frequência e guarde a cópia **fora** do servidor (no seu PC).

---

## 🧯 Parte 5 — Recuperação (restaurar um backup)

Um backup que você nunca restaurou é só esperança. Teste o processo **antes** de precisar dele.

O backup é uma cópia do arquivo `.db`. Para voltar a partir de um backup:

1. **Pare a API.** Na aba **Web** do PythonAnywhere, o app não pode estar escrevendo no banco durante a troca. (Localmente, é só não estar com o servidor rodando.)
2. **Rode o script de restauração**, passando o arquivo de backup:
   ```bash
   python restaurar_backup.py caminho/do/backup.db
   ```
   Ele confere a integridade do backup (`PRAGMA integrity_check`), **salva o banco atual** como `pre_restauracao_<data>.db` (rede de segurança), copia o backup por cima e confere a integridade de novo. Se o backup estiver corrompido, ele **aborta** sem tocar no banco atual.
3. **Suba a API de novo** (botão **Reload** na aba Web) e confirme em `/api/health` e no login.

> Teste isto pelo menos uma vez com um backup real, restaurando num arquivo de lado
> (`python restaurar_backup.py backup.db` apontando `DATABASE_URL` para um `.db` de teste),
> para ter certeza de que sabe fazer o caminho de volta.

---

## 🔄 Como atualizar o sistema depois

Quando você mudar o código no PC e der `push` no GitHub:

- **Site:** o GitHub Pages atualiza sozinho (o workflow roda no push).
- **API:** entre no **Bash** do PythonAnywhere e rode:
  ```bash
  cd Calculo_de_custos-main
  git pull
  ```
  Depois vá na aba **Web** e clique em **Reload**.

---

## 🧯 Problemas comuns

**"Failed to fetch" no site**
A API não respondeu. Cheque: (1) `PRODUCTION_API_URL` no `script.js` está certa e com `/api`? (2) `https://SEU_USUARIO.pythonanywhere.com/api/health` abre? (3) fez **Reload** no PythonAnywhere?

**Erro de CORS no console (F12)**
O `FRONTEND_URL` (no WSGI) está diferente da origem do site. Use só `https://navarroarthur.github.io` e dê Reload.

**"Something went wrong" / erro 500 no PythonAnywhere**
Veja o **Error log** na aba Web — a última linha diz o que quebrou (caminho errado no WSGI, dependência faltando, etc.).

**A conta grátis "expira"**
No plano grátis, o PythonAnywhere pede para você **renovar o web app a cada ~3 meses** (é um clique na aba Web). Só isso.

---

## 🔒 Checklist antes de divulgar a URL

- [ ] `SECRET_KEY` no WSGI (aleatória e longa).
- [ ] `ADMIN_SENHA` no WSGI (não é mais `admin123`).
- [ ] `FRONTEND_URL` no WSGI = origem do GitHub Pages.
- [ ] `DATABASE_URL` no WSGI = caminho absoluto do `.db`.
- [ ] `https://.../api/health` responde e o login funciona.
- [ ] Primeiro backup baixado e guardado **fora** do servidor.
- [ ] Restauração testada ao menos uma vez (`restaurar_backup.py` num `.db` de teste).
- [ ] Senha do admin forte (mín. 8, não é só números nem uma senha óbvia).
- [ ] (Opcional) `SENTRY_DSN` no WSGI, se quiser monitorar erros.
