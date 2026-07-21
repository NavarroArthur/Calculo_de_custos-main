# 🚀 Guia de Deploy - Railway

## Configuração para deploy do backend completo

### 1. Preparar arquivos para Railway

Criar `Procfile`:
```
web: python api.py
```

Criar `runtime.txt`:
```
python-3.11.0
```

Atualizar `requirements.txt`:
```
Flask==2.3.3
Flask-CORS==4.0.0
```

### 2. Configurar variáveis de ambiente

No Railway, adicionar:
- `PORT`: 8000
- `FLASK_ENV`: production
- `DATABASE_URL`: sqlite:///calculos_beneficiamento.db

### 3. Deploy no Railway

1. Acesse [railway.app](https://railway.app)
2. Conecte com GitHub
3. Selecione seu repositório
4. Railway detectará automaticamente Python
5. Deploy automático

### 4. Atualizar frontend

No `web/script.js`, linha 9:
```javascript
const API_BASE_URL = 'https://seu-projeto.railway.app/api';
```

### 5. Banco de dados persistente

Railway oferece volumes persistentes para SQLite:
- Adicionar `railway.toml`:
```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "python api.py"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10

[[services]]
source = "."

[services.variables]
PORT = "8000"
FLASK_ENV = "production"
```
