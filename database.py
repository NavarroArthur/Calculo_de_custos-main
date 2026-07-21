#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🐟 Sistema de Banco de Dados - Calculadora de Custos
Beneficiamento de Pescados

Banco de dados SQLite para armazenar cálculos e dados dos usuários
"""

import sqlite3
import json
import os
import shutil
from datetime import datetime
from typing import List, Dict, Optional, Tuple

class DatabaseManager:
    def __init__(self, db_path: str = None):
        """
        Inicializa o gerenciador do banco de dados
        
        Args:
            db_path: Caminho para o arquivo do banco de dados SQLite
        """
        # Usar caminho padrão ou variável de ambiente
        if db_path is None:
            db_path = os.environ.get('DATABASE_URL', 'calculos_beneficiamento.db')
            # Remover prefixo sqlite:/// se presente
            if db_path.startswith('sqlite:///'):
                db_path = db_path[10:]
        
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """Inicializa o banco de dados criando as tabelas necessárias"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # Tabela de usuários/sessões
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS usuarios (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome TEXT,
                    email TEXT UNIQUE,
                    empresa TEXT,
                    telefone TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Tabela de cálculos
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS calculos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    usuario_id INTEGER,
                    produto TEXT NOT NULL,
                    categoria TEXT NOT NULL,
                    preco_kg REAL NOT NULL,
                    peso_inicial REAL NOT NULL,
                    peso_final REAL NOT NULL,
                    sacos_gelo INTEGER NOT NULL,
                    caixas_papelao INTEGER NOT NULL,
                    
                    -- Resultados calculados
                    custo_sacos_gelo REAL NOT NULL,
                    custo_papelao REAL NOT NULL,
                    custo_fita_papelao REAL NOT NULL,
                    diferenca_pesos REAL NOT NULL,
                    custo_producao REAL NOT NULL,
                    custo_pos_beneficiamento REAL NOT NULL,
                    porcentagem_beneficiamento REAL NOT NULL,
                    diferenca_valor REAL NOT NULL,
                    custos_totais REAL NOT NULL,
                    custo_final REAL NOT NULL,
                    
                    -- Metadados
                    observacoes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
                )
            ''')
            
            # Tabela de configurações do sistema
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS configuracoes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chave TEXT UNIQUE NOT NULL,
                    valor TEXT NOT NULL,
                    descricao TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Tabela de logs de atividade
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS logs_atividade (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    usuario_id INTEGER,
                    acao TEXT NOT NULL,
                    detalhes TEXT,
                    ip_address TEXT,
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
                )
            ''')
            
            # Tabela de produtos (cada produto tem seu preço por Kg)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS produtos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome TEXT UNIQUE NOT NULL,
                    preco_kg REAL NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Tabela de histórico de preços: 1 linha por alteração de preço de um produto
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS historico_precos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    produto_id INTEGER NOT NULL,
                    preco_anterior REAL,
                    preco_novo REAL NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (produto_id) REFERENCES produtos (id)
                )
            ''')

            # Tabela de histórico de validades: 1 linha por alteração de validade
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS historico_validades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    produto_id INTEGER NOT NULL,
                    validade_anterior TEXT,
                    validade_nova TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (produto_id) REFERENCES produtos (id)
                )
            ''')

            # Histórico UNIFICADO de alterações do produto (audit log):
            # cada linha registra QUAL campo mudou (preco/validade/lote/fabricacao),
            # o valor antigo e o novo. Substitui as tabelas separadas acima.
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS historico_produto (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    produto_id INTEGER NOT NULL,
                    campo TEXT NOT NULL,
                    valor_anterior TEXT,
                    valor_novo TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (produto_id) REFERENCES produtos (id)
                )
            ''')

            # Migração: adiciona as colunas de perfil na tabela produtos, se faltarem
            self._migrar_colunas_produtos(cursor)
            # Migração: adiciona a coluna de senha na tabela usuarios (para login)
            self._migrar_usuarios_senha(cursor)

            # Inserir configurações padrão
            self._insert_default_configurations(cursor)
            # Inserir produtos padrão (só entram na primeira vez)
            self._insert_default_produtos(cursor)
            # Migração única: unifica os históricos antigos (preços/validades) no novo formato
            self._migrar_historico_unificado(cursor)

            # Criar índices para melhor performance
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_calculos_usuario_id ON calculos(usuario_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_calculos_created_at ON calculos(created_at)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_calculos_produto ON calculos(produto)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_usuario_id ON logs_atividade(usuario_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs_atividade(created_at)')
            
            conn.commit()
            print("Banco de dados inicializado com sucesso!")
            
        except Exception as e:
            print(f"❌ Erro ao inicializar banco de dados: {e}")
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def _insert_default_configurations(self, cursor):
        """Insere configurações padrão do sistema"""
        configuracoes_padrao = [
            ('preco_gelo', '8.5', 'Preço unitário dos sacos de gelo'),
            ('preco_papelao', '7.3', 'Preço unitário das caixas de papelão'),
            ('preco_fita', '0.34', 'Preço unitário das fitas durex'),
            ('versao_sistema', '2.0.0', 'Versão atual do sistema'),
            ('max_calculos_historico', '1000', 'Máximo de cálculos no histórico'),
            ('backup_automatico', 'true', 'Ativar backup automático'),
        ]
        
        for chave, valor, descricao in configuracoes_padrao:
            cursor.execute('''
                INSERT OR IGNORE INTO configuracoes (chave, valor, descricao)
                VALUES (?, ?, ?)
            ''', (chave, valor, descricao))

    def _insert_default_produtos(self, cursor):
        """Insere os produtos padrão (só entram na primeira vez, com preço 0)."""
        produtos_padrao = [
            "Filé de merluza", "Filé de Panga Com", "Filé de Panga Premium",
            "Filé de Saithe", "Filé de Polaca", "Posta de Cação", "Posta de Salmão",
            "Filé de Tilápia", "Tentáculos de Lula", "Anéis de Lula", "Camarão sete barbas",
        ]
        for nome in produtos_padrao:
            # INSERT OR IGNORE: se o nome já existe (UNIQUE), não faz nada
            cursor.execute(
                'INSERT OR IGNORE INTO produtos (nome, preco_kg) VALUES (?, 0)', (nome,)
            )

    # ----------------------------------------------------------------------
    # Migração e CRUD de produtos
    # ----------------------------------------------------------------------
    # Colunas de "perfil" acrescentadas depois da versão inicial da tabela produtos.
    COLUNAS_PERFIL_PRODUTO = {
        'validade': 'TEXT',
        'fornecedor': 'TEXT',
        'categoria': 'TEXT',
        'lote': 'TEXT',
        'fabricacao': 'TEXT',
        'observacoes': 'TEXT',
    }
    # Whitelist dos campos que o usuário pode editar (usada para montar o UPDATE com segurança).
    CAMPOS_EDITAVEIS_PRODUTO = ['nome', 'preco_kg', 'validade', 'fornecedor',
                                'categoria', 'lote', 'fabricacao', 'observacoes']

    def _migrar_colunas_produtos(self, cursor):
        """Adiciona as colunas de perfil na tabela produtos, se ainda não existirem.
        O SQLite não tem 'ADD COLUMN IF NOT EXISTS', então checamos o schema antes."""
        cursor.execute('PRAGMA table_info(produtos)')
        existentes = {linha[1] for linha in cursor.fetchall()}  # linha[1] = nome da coluna
        for nome, tipo in self.COLUNAS_PERFIL_PRODUTO.items():
            if nome not in existentes:
                cursor.execute(f'ALTER TABLE produtos ADD COLUMN {nome} {tipo}')

    def _migrar_historico_unificado(self, cursor):
        """Migração ÚNICA: copia os históricos antigos (preços e validades) para a
        tabela unificada historico_produto. Guardada por uma flag em configuracoes
        para não rodar de novo."""
        cursor.execute("SELECT valor FROM configuracoes WHERE chave = 'migrou_historico_unificado'")
        if cursor.fetchone():
            return  # ja migrado

        # Copia o histórico de preços antigo
        cursor.execute('SELECT produto_id, preco_anterior, preco_novo, created_at FROM historico_precos')
        for pid, ant, nov, dt in cursor.fetchall():
            cursor.execute(
                'INSERT INTO historico_produto (produto_id, campo, valor_anterior, valor_novo, created_at) VALUES (?, ?, ?, ?, ?)',
                (pid, 'preco', None if ant is None else str(ant), str(nov), dt))

        # Copia o histórico de validades antigo
        cursor.execute('SELECT produto_id, validade_anterior, validade_nova, created_at FROM historico_validades')
        for pid, ant, nov, dt in cursor.fetchall():
            cursor.execute(
                'INSERT INTO historico_produto (produto_id, campo, valor_anterior, valor_novo, created_at) VALUES (?, ?, ?, ?, ?)',
                (pid, 'validade', ant, nov, dt))

        # Marca como migrado para não repetir
        cursor.execute(
            "INSERT OR REPLACE INTO configuracoes (chave, valor, descricao) "
            "VALUES ('migrou_historico_unificado', 'true', 'Historico unificado ja migrado')")

    def _migrar_usuarios_senha(self, cursor):
        """Adiciona a coluna senha_hash na tabela usuarios, se ainda não existir."""
        cursor.execute('PRAGMA table_info(usuarios)')
        existentes = {linha[1] for linha in cursor.fetchall()}
        if 'senha_hash' not in existentes:
            cursor.execute('ALTER TABLE usuarios ADD COLUMN senha_hash TEXT')

    # ----------------------------------------------------------------------
    # Autenticação e backup
    # ----------------------------------------------------------------------
    def obter_usuario_por_email(self, email: str):
        """Retorna o usuário (id, nome, email, senha_hash) pelo e-mail, ou None."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute('SELECT id, nome, email, senha_hash FROM usuarios WHERE email = ?', (email,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def definir_senha_usuario(self, usuario_id: int, senha_hash: str):
        """Grava o hash da senha de um usuário (nunca a senha em texto puro)."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute(
                'UPDATE usuarios SET senha_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (senha_hash, usuario_id))
            conn.commit()
        finally:
            conn.close()

    def criar_backup(self, pasta: str = 'backups') -> str:
        """Copia o arquivo do banco para a pasta de backups, com data/hora no nome.
        Retorna o caminho do arquivo criado."""
        os.makedirs(pasta, exist_ok=True)
        nome = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        destino = os.path.join(pasta, nome)
        # copy2 preserva metadados (data de modificacao etc.)
        shutil.copy2(self.db_path, destino)
        return destino

    def listar_produtos(self):
        """Retorna todos os produtos (perfil completo), em ordem alfabética."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute('''
                SELECT id, nome, preco_kg, validade, fornecedor, categoria, lote, fabricacao, observacoes
                FROM produtos ORDER BY nome
            ''')
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def obter_produto(self, produto_id):
        """Retorna um único produto (perfil completo) ou None se não existir."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute('''
                SELECT id, nome, preco_kg, validade, fornecedor, categoria, lote, fabricacao, observacoes
                FROM produtos WHERE id = ?
            ''', (produto_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def criar_produto(self, nome, preco_kg=0, validade=None, fornecedor=None,
                      categoria=None, lote=None, fabricacao=None, observacoes=None):
        """Cria um novo produto. Levanta ValueError se o nome já existir."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO produtos (nome, preco_kg, validade, fornecedor, categoria, lote, fabricacao, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (nome, preco_kg, validade, fornecedor, categoria, lote, fabricacao, observacoes))
            produto_id = cursor.lastrowid
            conn.commit()
            return produto_id
        except sqlite3.IntegrityError:
            raise ValueError("Já existe um produto com esse nome")
        finally:
            conn.close()

    def atualizar_produto(self, produto_id, **campos):
        """Atualiza os campos informados de um produto.
        Se o preço mudar, registra a alteração em historico_precos automaticamente."""
        # Mantém só os campos permitidos e realmente enviados (não-None)
        campos = {k: v for k, v in campos.items()
                  if k in self.CAMPOS_EDITAVEIS_PRODUTO and v is not None}
        if not campos:
            return 0

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            # Campos rastreados no histórico e o rótulo salvo no log (coluna -> nome)
            RASTREAR = {'preco_kg': 'preco', 'validade': 'validade',
                        'lote': 'lote', 'fabricacao': 'fabricacao'}
            rastreados = [c for c in RASTREAR if c in campos]

            # Pega os valores antigos desses campos ANTES do UPDATE, para comparar
            antigos = {}
            if rastreados:
                cols = ', '.join(rastreados)   # nomes da whitelist -> seguro
                cursor.execute(f'SELECT {cols} FROM produtos WHERE id = ?', (produto_id,))
                r = cursor.fetchone()
                if r:
                    antigos = dict(zip(rastreados, r))

            # Monta o SET dinamicamente. Os NOMES das colunas vêm da whitelist (seguro);
            # os VALORES vão parametrizados (?), protegendo contra SQL injection.
            set_clause = ', '.join(f'{k} = ?' for k in campos) + ', updated_at = CURRENT_TIMESTAMP'
            valores = list(campos.values()) + [produto_id]
            cursor.execute(f'UPDATE produtos SET {set_clause} WHERE id = ?', valores)

            # Registra no histórico unificado cada campo rastreado que realmente mudou
            for coluna in rastreados:
                antigo = antigos.get(coluna)
                novo = campos[coluna]
                if coluna == 'preco_kg':
                    mudou = antigo is not None and float(novo) != float(antigo)
                else:
                    mudou = (novo or '') != (antigo or '')
                if mudou and novo not in (None, ''):
                    cursor.execute('''
                        INSERT INTO historico_produto (produto_id, campo, valor_anterior, valor_novo)
                        VALUES (?, ?, ?, ?)
                    ''', (produto_id, RASTREAR[coluna],
                          None if antigo is None else str(antigo), str(novo)))

            conn.commit()
            return cursor.rowcount
        except sqlite3.IntegrityError:
            raise ValueError("Já existe um produto com esse nome")
        finally:
            conn.close()

    def remover_produto(self, produto_id):
        """Remove um produto e o seu histórico de preços."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        try:
            cursor.execute('DELETE FROM historico_precos WHERE produto_id = ?', (produto_id,))
            cursor.execute('DELETE FROM historico_validades WHERE produto_id = ?', (produto_id,))
            cursor.execute('DELETE FROM historico_produto WHERE produto_id = ?', (produto_id,))
            cursor.execute('DELETE FROM produtos WHERE id = ?', (produto_id,))
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

    def listar_historico_produto(self, produto_id):
        """Retorna o histórico unificado de alterações de um produto
        (campo, valor_anterior, valor_novo, created_at), do mais recente ao mais antigo."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute('''
                SELECT campo, valor_anterior, valor_novo, created_at
                FROM historico_produto WHERE produto_id = ?
                ORDER BY created_at DESC, id DESC
            ''', (produto_id,))
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()
    
    def criar_usuario(self, nome: str, email: str = None, empresa: str = None, telefone: str = None) -> int:
        """
        Cria um novo usuário
        
        Args:
            nome: Nome do usuário
            email: Email do usuário (opcional)
            empresa: Empresa do usuário (opcional)
            telefone: Telefone do usuário (opcional)
            
        Returns:
            ID do usuário criado
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO usuarios (nome, email, empresa, telefone)
                VALUES (?, ?, ?, ?)
            ''', (nome, email, empresa, telefone))
            
            usuario_id = cursor.lastrowid
            conn.commit()
            
            # Log da atividade
            self._log_atividade(cursor, usuario_id, 'usuario_criado', 
                              f'Usuário {nome} criado com sucesso')
            
            return usuario_id
            
        except sqlite3.IntegrityError as e:
            if "UNIQUE constraint failed" in str(e):
                raise ValueError("Email já está em uso")
            raise
        except Exception as e:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def salvar_calculo(self, usuario_id: int, dados_calculo: Dict, resultados: Dict, observacoes: str = None) -> int:
        """
        Salva um cálculo no banco de dados
        
        Args:
            usuario_id: ID do usuário
            dados_calculo: Dados inseridos pelo usuário
            resultados: Resultados calculados
            observacoes: Observações adicionais (opcional)
            
        Returns:
            ID do cálculo salvo
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO calculos (
                    usuario_id, produto, categoria, preco_kg, peso_inicial, peso_final,
                    sacos_gelo, caixas_papelao,
                    custo_sacos_gelo, custo_papelao, custo_fita_papelao,
                    diferenca_pesos, custo_producao, custo_pos_beneficiamento,
                    porcentagem_beneficiamento, diferenca_valor, custos_totais,
                    custo_final, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                usuario_id,
                dados_calculo['produto'],
                dados_calculo['categoria'],
                dados_calculo['preco'],
                dados_calculo['peso_inicial'],
                dados_calculo['peso_final'],
                dados_calculo['sacos_de_gelo'],
                dados_calculo['caixa_papelao'],
                resultados['custo_sacos_gelo'],
                resultados['custo_papelao'],
                resultados['custo_fita_papelao'],
                resultados['diferenca_pesos'],
                resultados['custo_producao'],
                resultados['custo_pos_beneficiamento'],
                resultados['porcentagem'],
                resultados['diferenca_valor'],
                resultados['custos_totais'],
                resultados['custo_final'],
                observacoes
            ))
            
            calculo_id = cursor.lastrowid
            conn.commit()
            
            # Log da atividade
            self._log_atividade(cursor, usuario_id, 'calculo_salvo', 
                              f'Cálculo {calculo_id} salvo para produto {dados_calculo["produto"]}')
            
            return calculo_id
            
        except Exception as e:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def obter_calculos_usuario(self, usuario_id: int, limite: int = 50, offset: int = 0) -> List[Dict]:
        """
        Obtém os cálculos de um usuário
        
        Args:
            usuario_id: ID do usuário
            limite: Número máximo de registros
            offset: Número de registros a pular
            
        Returns:
            Lista de cálculos
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT * FROM calculos 
                WHERE usuario_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            ''', (usuario_id, limite, offset))
            
            calculos = []
            for row in cursor.fetchall():
                calculo = dict(row)
                calculos.append(calculo)
            
            return calculos
            
        finally:
            conn.close()
    
    def obter_todos_calculos(self, limite: int = 100, offset: int = 0) -> List[Dict]:
        """
        Obtém todos os cálculos do sistema
        
        Args:
            limite: Número máximo de registros
            offset: Número de registros a pular
            
        Returns:
            Lista de todos os cálculos
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT c.*, u.nome as usuario_nome, u.empresa as usuario_empresa
                FROM calculos c
                LEFT JOIN usuarios u ON c.usuario_id = u.id
                ORDER BY c.created_at DESC 
                LIMIT ? OFFSET ?
            ''', (limite, offset))
            
            calculos = []
            for row in cursor.fetchall():
                calculo = dict(row)
                calculos.append(calculo)
            
            return calculos
            
        finally:
            conn.close()
    
    def obter_estatisticas(self) -> Dict:
        """
        Obtém estatísticas gerais do sistema
        
        Returns:
            Dicionário com estatísticas
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # Total de usuários
            cursor.execute('SELECT COUNT(*) FROM usuarios')
            total_usuarios = cursor.fetchone()[0]
            
            # Total de cálculos
            cursor.execute('SELECT COUNT(*) FROM calculos')
            total_calculos = cursor.fetchone()[0]
            
            # Cálculos por produto
            cursor.execute('''
                SELECT produto, COUNT(*) as quantidade 
                FROM calculos 
                GROUP BY produto 
                ORDER BY quantidade DESC
            ''')
            produtos_populares = cursor.fetchall()
            
            # Cálculos por categoria
            cursor.execute('''
                SELECT categoria, COUNT(*) as quantidade 
                FROM calculos 
                GROUP BY categoria 
                ORDER BY quantidade DESC
            ''')
            categorias_populares = cursor.fetchall()
            
            # Médias gerais
            cursor.execute('''
                SELECT 
                    AVG(porcentagem_beneficiamento) as media_beneficiamento,
                    AVG(custo_final) as media_custo_final,
                    AVG(diferenca_pesos) as media_ganho_peso
                FROM calculos
            ''')
            medias = cursor.fetchone()
            
            return {
                'total_usuarios': total_usuarios,
                'total_calculos': total_calculos,
                'produtos_populares': produtos_populares,
                'categorias_populares': categorias_populares,
                'media_beneficiamento': round(medias[0], 2) if medias[0] else 0,
                'media_custo_final': round(medias[1], 2) if medias[1] else 0,
                'media_ganho_peso': round(medias[2], 2) if medias[2] else 0
            }
            
        finally:
            conn.close()
    
    def obter_configuracao(self, chave: str) -> str:
        """
        Obtém uma configuração do sistema
        
        Args:
            chave: Chave da configuração
            
        Returns:
            Valor da configuração
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('SELECT valor FROM configuracoes WHERE chave = ?', (chave,))
            result = cursor.fetchone()
            return result[0] if result else None
            
        finally:
            conn.close()
    
    def atualizar_configuracao(self, chave: str, valor: str, descricao: str = None):
        """
        Atualiza uma configuração do sistema
        
        Args:
            chave: Chave da configuração
            valor: Novo valor
            descricao: Descrição da configuração (opcional)
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT OR REPLACE INTO configuracoes (chave, valor, descricao, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ''', (chave, valor, descricao))
            
            conn.commit()
            
        finally:
            conn.close()
    
    def _log_atividade(self, cursor, usuario_id: int, acao: str, detalhes: str = None):
        """
        Registra uma atividade no log
        
        Args:
            cursor: Cursor do banco de dados
            usuario_id: ID do usuário
            acao: Ação realizada
            detalhes: Detalhes da ação (opcional)
        """
        try:
            cursor.execute('''
                INSERT INTO logs_atividade (usuario_id, acao, detalhes)
                VALUES (?, ?, ?)
            ''', (usuario_id, acao, detalhes))
        except Exception as e:
            print(f"Erro ao registrar log: {e}")
    
    def exportar_dados(self, formato: str = 'json') -> str:
        """
        Exporta todos os dados do sistema
        
        Args:
            formato: Formato de exportação ('json' ou 'csv')
            
        Returns:
            Caminho do arquivo exportado
        """
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if formato == 'json':
            return self._exportar_json(timestamp)
        elif formato == 'csv':
            return self._exportar_csv(timestamp)
        else:
            raise ValueError("Formato não suportado. Use 'json' ou 'csv'")
    
    def _exportar_json(self, timestamp: str) -> str:
        """Exporta dados em formato JSON"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            # Obter todos os dados
            cursor.execute('SELECT * FROM usuarios')
            usuarios = [dict(row) for row in cursor.fetchall()]
            
            cursor.execute('SELECT * FROM calculos')
            calculos = [dict(row) for row in cursor.fetchall()]
            
            cursor.execute('SELECT * FROM configuracoes')
            configuracoes = [dict(row) for row in cursor.fetchall()]
            
            dados_exportacao = {
                'metadata': {
                    'exportado_em': datetime.now().isoformat(),
                    'versao_sistema': self.obter_configuracao('versao_sistema'),
                    'total_usuarios': len(usuarios),
                    'total_calculos': len(calculos)
                },
                'usuarios': usuarios,
                'calculos': calculos,
                'configuracoes': configuracoes
            }
            
            filename = f"backup_beneficiamento_{timestamp}.json"
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(dados_exportacao, f, ensure_ascii=False, indent=2, default=str)
            
            return filename
            
        finally:
            conn.close()
    
    def _exportar_csv(self, timestamp: str) -> str:
        """Exporta dados em formato CSV"""
        import csv
        
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            # Exportar cálculos
            cursor.execute('''
                SELECT c.*, u.nome as usuario_nome, u.empresa as usuario_empresa
                FROM calculos c
                LEFT JOIN usuarios u ON c.usuario_id = u.id
                ORDER BY c.created_at DESC
            ''')
            
            filename = f"calculos_beneficiamento_{timestamp}.csv"
            with open(filename, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=[description[0] for description in cursor.description])
                writer.writeheader()
                writer.writerows(dict(row) for row in cursor.fetchall())
            
            return filename
            
        finally:
            conn.close()

def main():
    """Função principal para testar o banco de dados"""
    print("Inicializando Sistema de Banco de Dados")
    print("=" * 50)
    
    # Inicializar banco
    db = DatabaseManager()
    
    # Criar usuário de teste
    try:
        usuario_id = db.criar_usuario(
            nome="Usuário Teste",
            email="teste@exemplo.com",
            empresa="Empresa Teste",
            telefone="(11) 99999-9999"
        )
        print(f"Usuario criado com ID: {usuario_id}")
    except ValueError as e:
        print(f"Usuario ja existe: {e}")
        usuario_id = 1
    
    # Dados de teste
    dados_teste = {
        'produto': 'Filé de merluza',
        'categoria': 'Mercado',
        'preco': 25.50,
        'peso_inicial': 100,
        'peso_final': 120,
        'sacos_de_gelo': 5,
        'caixa_papelao': 3
    }
    
    # Calcular resultados
    preco_gelo = float(db.obter_configuracao('preco_gelo'))
    preco_papelao = float(db.obter_configuracao('preco_papelao'))
    preco_fita = float(db.obter_configuracao('preco_fita'))
    
    resultados_teste = {
        'custo_sacos_gelo': dados_teste['sacos_de_gelo'] * preco_gelo,
        'custo_papelao': dados_teste['caixa_papelao'] * preco_papelao,
        'custo_fita_papelao': dados_teste['caixa_papelao'] * preco_fita,
        'diferenca_pesos': dados_teste['peso_final'] - dados_teste['peso_inicial'],
        'custo_producao': dados_teste['peso_inicial'] * dados_teste['preco'],
        'custo_pos_beneficiamento': (dados_teste['peso_inicial'] * dados_teste['preco']) / dados_teste['peso_final'],
        'porcentagem': ((dados_teste['peso_final'] / dados_teste['peso_inicial']) * 100) - 100,
        'diferenca_valor': dados_teste['preco'] - ((dados_teste['peso_inicial'] * dados_teste['preco']) / dados_teste['peso_final']),
        'custos_totais': (dados_teste['sacos_de_gelo'] * preco_gelo) + (dados_teste['caixa_papelao'] * preco_papelao) + (dados_teste['caixa_papelao'] * preco_fita),
        'custo_final': 0
    }
    
    resultados_teste['custo_final'] = resultados_teste['custos_totais'] + (resultados_teste['custo_pos_beneficiamento'] * dados_teste['peso_final'])
    
    # Salvar cálculo
    calculo_id = db.salvar_calculo(usuario_id, dados_teste, resultados_teste, "Cálculo de teste")
    print(f"Calculo salvo com ID: {calculo_id}")
    
    # Obter estatísticas
    stats = db.obter_estatisticas()
    print(f"\nEstatisticas do Sistema:")
    print(f"   - Total de usuarios: {stats['total_usuarios']}")
    print(f"   - Total de calculos: {stats['total_calculos']}")
    print(f"   - Beneficiamento medio: {stats['media_beneficiamento']}%")
    print(f"   - Custo medio final: R$ {stats['media_custo_final']}")
    
    # Exportar dados
    backup_file = db.exportar_dados('json')
    print(f"Backup criado: {backup_file}")
    
    print("\nSistema de banco de dados funcionando perfeitamente!")

if __name__ == "__main__":
    main()
