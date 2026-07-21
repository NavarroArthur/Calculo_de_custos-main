# 🗄️ Sistema de Banco de Dados - Calculadora de Custos

## 📋 Visão Geral

O sistema agora inclui um banco de dados SQLite completo para armazenar todos os dados dos usuários e cálculos de beneficiamento de pescados.

## 🏗️ Arquitetura do Sistema

```
📁 Sistema Completo
├── 🗄️ database.py          # Gerenciador do banco SQLite
├── 🌐 api.py               # API REST Flask
├── 💻 web/                 # Frontend (HTML/CSS/JS)
├── 🚀 iniciar_servidor.py  # Servidor principal
└── 📦 requirements.txt     # Dependências Python
```

## 📊 Estrutura do Banco de Dados

### Tabelas Principais

#### 1. **usuarios**
```sql
- id (INTEGER PRIMARY KEY)
- nome (TEXT)
- email (TEXT UNIQUE)
- empresa (TEXT)
- telefone (TEXT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 2. **calculos**
```sql
- id (INTEGER PRIMARY KEY)
- usuario_id (INTEGER FOREIGN KEY)
- produto (TEXT)
- categoria (TEXT)
- preco_kg (REAL)
- peso_inicial (REAL)
- peso_final (REAL)
- sacos_gelo (INTEGER)
- caixas_papelao (INTEGER)
- custo_sacos_gelo (REAL)
- custo_papelao (REAL)
- custo_fita_papelao (REAL)
- diferenca_pesos (REAL)
- custo_producao (REAL)
- custo_pos_beneficiamento (REAL)
- porcentagem_beneficiamento (REAL)
- diferenca_valor (REAL)
- custos_totais (REAL)
- custo_final (REAL)
- observacoes (TEXT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 3. **configuracoes**
```sql
- id (INTEGER PRIMARY KEY)
- chave (TEXT UNIQUE)
- valor (TEXT)
- descricao (TEXT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 4. **logs_atividade**
```sql
- id (INTEGER PRIMARY KEY)
- usuario_id (INTEGER FOREIGN KEY)
- acao (TEXT)
- detalhes (TEXT)
- ip_address (TEXT)
- user_agent (TEXT)
- created_at (TIMESTAMP)
```

## 🚀 Como Usar

### 1. **Instalação e Execução**

```bash
# Instalar dependências
pip install -r requirements.txt

# Executar o sistema completo
python iniciar_servidor.py
```

### 2. **Acesso ao Sistema**

- **Frontend**: http://localhost:8000
- **API REST**: http://localhost:5000
- **Banco de dados**: `calculos_beneficiamento.db` (SQLite)

### 3. **Funcionalidades Automáticas**

- ✅ **Criação automática** de usuários
- ✅ **Salvamento automático** de cálculos
- ✅ **Carregamento automático** do histórico
- ✅ **Sincronização** entre frontend e banco
- ✅ **Modo offline** como fallback

## 🔌 API REST Endpoints

### **Usuários**
- `POST /api/usuarios` - Criar usuário
- `GET /api/usuarios/{id}` - Obter usuário

### **Cálculos**
- `POST /api/calculos` - Salvar cálculo
- `GET /api/calculos` - Listar todos os cálculos
- `GET /api/calculos/usuario/{id}` - Cálculos do usuário
- `POST /api/calcular` - Calcular sem salvar

### **Sistema**
- `GET /api/health` - Status da API
- `GET /api/estatisticas` - Estatísticas gerais
- `GET /api/configuracoes` - Configurações
- `PUT /api/configuracoes` - Atualizar configurações
- `GET /api/exportar` - Exportar dados

## 📈 Estatísticas Disponíveis

O sistema coleta automaticamente:

- **Total de usuários** cadastrados
- **Total de cálculos** realizados
- **Produtos mais utilizados**
- **Categorias mais populares**
- **Beneficiamento médio**
- **Custo médio final**
- **Ganho médio de peso**

## 💾 Backup e Exportação

### **Exportação Automática**
```bash
# Via API
curl http://localhost:5000/api/exportar?formato=json

# Via código Python
python -c "from database import DatabaseManager; db = DatabaseManager(); print(db.exportar_dados('json'))"
```

### **Formatos Suportados**
- **JSON**: Dados completos com metadados
- **CSV**: Tabela de cálculos para análise

## 🔧 Configurações do Sistema

### **Preços Padrão** (configuráveis via API)
- **Saco de gelo**: R$ 8,50
- **Caixa de papelão**: R$ 7,30
- **Fita durex**: R$ 0,34

### **Limites**
- **Histórico máximo**: 1000 cálculos
- **Backup automático**: Ativado
- **Logs de atividade**: Mantidos

## 🛠️ Manutenção

### **Verificar Status do Banco**
```python
from database import DatabaseManager
db = DatabaseManager()
stats = db.obter_estatisticas()
print(stats)
```

### **Limpar Dados Antigos**
```python
# Manter apenas últimos 100 cálculos por usuário
db.obter_calculos_usuario(usuario_id, limite=100)
```

### **Atualizar Configurações**
```python
db.atualizar_configuracao('preco_gelo', '9.0', 'Novo preço do gelo')
```

## 🔒 Segurança e Privacidade

### **Dados Armazenados**
- ✅ **Dados de produção** (pesos, preços, quantidades)
- ✅ **Resultados calculados** (custos, beneficiamento)
- ✅ **Informações do usuário** (nome, empresa, contato)
- ✅ **Logs de atividade** (ações realizadas)

### **Proteção**
- 🔐 **Dados locais** (não enviados para servidores externos)
- 🔐 **SQLite** (banco de dados local)
- 🔐 **Validação** de dados no frontend e backend
- 🔐 **Logs de auditoria** para rastreabilidade

## 📊 Relatórios e Análises

### **Relatórios Disponíveis**
1. **Relatório Individual** - PDF detalhado por cálculo
2. **Histórico Completo** - PDF com todos os cálculos
3. **Estatísticas Gerais** - Métricas do sistema
4. **Exportação CSV** - Dados para análise externa

### **Métricas Calculadas**
- **Eficiência de beneficiamento** por produto
- **Custos médios** por categoria
- **Tendências temporais** de produção
- **Comparação entre usuários** (anonimizada)

## 🚨 Solução de Problemas

### **Banco não inicializa**
```bash
# Verificar permissões
ls -la calculos_beneficiamento.db

# Recriar banco
rm calculos_beneficiamento.db
python database.py
```

### **API não responde**
```bash
# Verificar se está rodando
curl http://localhost:5000/api/health

# Reiniciar API
python api.py
```

### **Dados não aparecem**
1. Verificar console do navegador (F12)
2. Confirmar se API está funcionando
3. Verificar se usuário foi criado
4. Tentar modo offline (localStorage)

## 🎯 Próximas Funcionalidades

### **Planejadas**
- 📊 **Dashboard** com gráficos
- 📧 **Relatórios por email**
- 🔄 **Sincronização** entre dispositivos
- 📱 **App mobile** nativo
- ☁️ **Backup na nuvem**

### **Melhorias Técnicas**
- 🔍 **Busca avançada** nos cálculos
- 📈 **Análise preditiva** de custos
- 🤖 **IA para otimização** de processos
- 🔐 **Autenticação** de usuários

## 📞 Suporte

Para dúvidas ou problemas:

1. **Verificar logs** do console do navegador
2. **Consultar documentação** da API
3. **Testar endpoints** individualmente
4. **Verificar banco** de dados SQLite

---

**Versão**: 2.0.0  
**Última atualização**: 2024  
**Desenvolvido com ❤️ para a indústria pesqueira**
