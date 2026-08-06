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

    def _conectar(self):
        """Abre uma conexão JÁ configurada do jeito certo.
        Todos os métodos usam esta função em vez de chamar sqlite3.connect direto,
        para garantir num LUGAR SÓ (princípio DRY) quatro coisas importantes:

          - timeout=30: se o banco estiver ocupado por outra escrita, espera até 30s
            em vez de estourar na hora com "database is locked" (importante quando há
            mais de um processo do servidor acessando o mesmo banco).
          - PRAGMA foreign_keys = ON: o SQLite IGNORA as FOREIGN KEY por padrão. Este
            PRAGMA é POR CONEXÃO, então precisa ser ligado toda vez. Sem ele, dá pra
            inserir um cálculo com usuario_id inexistente. Com ele, o banco garante a
            integridade que o esquema promete.
          - PRAGMA journal_mode = WAL: deixa leituras e escritas acontecerem ao mesmo
            tempo (no modo padrão, uma escrita trava o banco inteiro). É persistente
            no arquivo, mas rodar de novo é inofensivo.
          - row_factory = Row: faz cada linha se comportar como um dicionário
            (acesso por nome de coluna: row['nome']).
        """
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        return conn

    def init_database(self):
        """Inicializa o banco de dados criando as tabelas necessárias"""
        conn = self._conectar()
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

            # (As tabelas historico_precos e historico_validades foram descontinuadas:
            #  o histórico agora é unificado em historico_produto. Elas são migradas e
            #  removidas mais abaixo, no init.)

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

            # Tabela de tipos de embalagem (nome + valor). Um produto pode apontar
            # para uma embalagem pela coluna produtos.embalagem_id.
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS embalagens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome TEXT UNIQUE NOT NULL,
                    valor REAL NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Tabela UNIFICADA de insumos (catálogo). Substitui os preços fixos únicos
            # (gelo/papelão/fita, que viviam em 'configuracoes') e as 'embalagens' por
            # um único cadastro: cada linha é um TIPO de insumo, com nome, valor e a
            # CATEGORIA que diz onde ele entra no cálculo ('gelo', 'papelao', 'fita',
            # 'embalagem', ...). Assim dá pra ter vários tipos de caixa, de gelo, etc.
            # A calculadora, em cada espaço fixo, mostra só os insumos daquela categoria.
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS insumos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nome TEXT NOT NULL,
                    valor REAL NOT NULL DEFAULT 0,
                    categoria TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (nome, categoria)
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_insumos_categoria ON insumos(categoria)')

            # Tabela de LOTES: cada produto pode ter vários lotes (partidas), e cada
            # lote tem o seu próprio código, fabricação, validade e quantidade. É isto
            # que dá o controle de perecível (dois lotes com validades diferentes).
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS lotes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    produto_id INTEGER NOT NULL,
                    codigo TEXT,
                    fabricacao TEXT,
                    validade TEXT,
                    quantidade REAL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (produto_id) REFERENCES produtos (id)
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_lotes_produto ON lotes(produto_id)')

            # Migração: adiciona as colunas de perfil na tabela produtos, se faltarem
            self._migrar_colunas_produtos(cursor)
            # Migração: adiciona a coluna de senha na tabela usuarios (para login)
            self._migrar_usuarios_senha(cursor)
            # Migração: adiciona a coluna de papel (admin/leitura) para controle de acesso
            self._migrar_usuarios_papel(cursor)
            # Migração: adiciona a coluna de permissoes (abas liberadas por usuário)
            self._migrar_usuarios_permissoes(cursor)
            # Migração: colunas de 2FA (segredo TOTP + se já foi confirmado)
            self._migrar_usuarios_2fa(cursor)

            # Tabela para o controle de tentativas de login (rate limiting).
            # Fica no banco (e não na memória do processo) para ser COMPARTILHADA
            # entre os vários processos do servidor. Se ficasse na memória, cada
            # processo teria a sua própria contagem e o limite não valeria de verdade.
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS login_tentativas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ip TEXT NOT NULL,
                    criado_em REAL NOT NULL   -- horário da falha (time.time(), em segundos)
                )
            ''')
            cursor.execute(
                'CREATE INDEX IF NOT EXISTS idx_login_tentativas_ip ON login_tentativas(ip)')

            # Códigos de backup do 2FA: entradas de uso único caso o usuário perca o
            # app autenticador. Guardamos só o HASH de cada código (nunca o texto),
            # igual às senhas. A coluna 'usado' marca quando um código foi consumido.
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS backup_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    usuario_id INTEGER NOT NULL,
                    code_hash TEXT NOT NULL,
                    usado INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
                )
            ''')
            cursor.execute(
                'CREATE INDEX IF NOT EXISTS idx_backup_codes_usuario ON backup_codes(usuario_id)')

            # Inserir configurações padrão
            self._insert_default_configurations(cursor)
            # Migração única: monta o catálogo de insumos a partir do que já existe
            # (preços fixos de gelo/papelão/fita + embalagens já cadastradas).
            self._migrar_insumos(cursor)
            # Migração: colunas no 'calculos' para guardar QUAL tipo de insumo foi
            # usado e o custo da embalagem (rastreabilidade + histórico fiel).
            self._migrar_calculos_insumos(cursor)
            # Inserir produtos padrão (só entram na primeira vez)
            self._insert_default_produtos(cursor)
            # Migração única: unifica os históricos antigos (preços/validades) no novo formato
            self._migrar_historico_unificado(cursor)
            # Migração única: transforma o lote/validade/fabricação atual de cada produto
            # em um "lote inicial" na nova tabela de lotes.
            self._migrar_lotes_iniciais(cursor)
            # Limpeza: as tabelas de histórico antigas (precos/validades) já foram
            # migradas para historico_produto e não são mais usadas. Podem sair.
            cursor.execute('DROP TABLE IF EXISTS historico_precos')
            cursor.execute('DROP TABLE IF EXISTS historico_validades')

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
            ('preco_fita', '0.34', 'Preço unitário da fita adesiva'),
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
        # Embalagem: quantidade + unidade + peso de cada unidade (em Kg).
        # Ex.: quantidade=10, unidade='Pacote', peso_unitario=1  -> 10 Kg no total.
        'quantidade': 'REAL',
        'unidade': 'TEXT',
        'peso_unitario': 'REAL',
        # Tipo de embalagem escolhido (referência leve para a tabela 'embalagens').
        'embalagem_id': 'INTEGER',
    }
    # Whitelist dos campos que o usuário pode editar (usada para montar o UPDATE com segurança).
    CAMPOS_EDITAVEIS_PRODUTO = ['nome', 'preco_kg', 'validade', 'fornecedor',
                                'categoria', 'lote', 'fabricacao', 'observacoes',
                                'quantidade', 'unidade', 'peso_unitario', 'embalagem_id']

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

        def tabela_existe(nome):
            cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (nome,))
            return cursor.fetchone() is not None

        # Copia o histórico de preços antigo (se a tabela ainda existir)
        if tabela_existe('historico_precos'):
            cursor.execute('SELECT produto_id, preco_anterior, preco_novo, created_at FROM historico_precos')
            for pid, ant, nov, dt in cursor.fetchall():
                cursor.execute(
                    'INSERT INTO historico_produto (produto_id, campo, valor_anterior, valor_novo, created_at) VALUES (?, ?, ?, ?, ?)',
                    (pid, 'preco', None if ant is None else str(ant), str(nov), dt))

        # Copia o histórico de validades antigo (se a tabela ainda existir)
        if tabela_existe('historico_validades'):
            cursor.execute('SELECT produto_id, validade_anterior, validade_nova, created_at FROM historico_validades')
            for pid, ant, nov, dt in cursor.fetchall():
                cursor.execute(
                    'INSERT INTO historico_produto (produto_id, campo, valor_anterior, valor_novo, created_at) VALUES (?, ?, ?, ?, ?)',
                    (pid, 'validade', ant, nov, dt))

        # Marca como migrado para não repetir
        cursor.execute(
            "INSERT OR REPLACE INTO configuracoes (chave, valor, descricao) "
            "VALUES ('migrou_historico_unificado', 'true', 'Historico unificado ja migrado')")

    def _migrar_lotes_iniciais(self, cursor):
        """Migração ÚNICA: transforma o lote/validade/fabricação que hoje vive em cada
        produto num 'lote inicial' na tabela lotes, para não perder o que já existe.
        Guardada por flag."""
        cursor.execute("SELECT valor FROM configuracoes WHERE chave = 'migrou_lotes_iniciais'")
        if cursor.fetchone():
            return
        cursor.execute('''
            SELECT id, lote, fabricacao, validade, quantidade FROM produtos
            WHERE (lote IS NOT NULL AND lote != '')
               OR (validade IS NOT NULL AND validade != '')
               OR (fabricacao IS NOT NULL AND fabricacao != '')
        ''')
        for pid, lote, fab, val, qtd in cursor.fetchall():
            cursor.execute(
                'INSERT INTO lotes (produto_id, codigo, fabricacao, validade, quantidade) '
                'VALUES (?, ?, ?, ?, ?)', (pid, lote, fab, val, qtd))
        cursor.execute(
            "INSERT OR REPLACE INTO configuracoes (chave, valor, descricao) "
            "VALUES ('migrou_lotes_iniciais', 'true', 'Lotes iniciais ja migrados')")

    def _migrar_insumos(self, cursor):
        """Migração ÚNICA: monta o catálogo de insumos a partir do que já existe,
        para não perder nada e manter o comportamento atual.

        Faz, em ordem:
          1) Copia as embalagens já cadastradas para 'insumos' com categoria
             'embalagem', PRESERVANDO O ID de cada uma. Isso é de propósito: os
             produtos apontam para a embalagem por produtos.embalagem_id, então
             manter o mesmo id deixa esse vínculo válido no novo modelo.
          2) Cria o primeiro tipo de cada insumo fixo (gelo/papelão/fita) usando o
             preço que hoje vive em 'configuracoes'. Assim os três preços fixos de
             antes viram o item padrão de cada categoria, e os cálculos antigos
             continuam batendo.
        Guardada por flag para nunca rodar duas vezes.
        """
        cursor.execute("SELECT valor FROM configuracoes WHERE chave = 'migrou_insumos'")
        if cursor.fetchone():
            return

        # 1) Embalagens existentes -> insumos (mesmo id, categoria 'embalagem')
        cursor.execute('SELECT id, nome, valor FROM embalagens ORDER BY id')
        for eid, nome, valor in cursor.fetchall():
            cursor.execute(
                'INSERT OR IGNORE INTO insumos (id, nome, valor, categoria) '
                "VALUES (?, ?, ?, 'embalagem')", (eid, nome, valor))

        # 2) Preços fixos de hoje -> item padrão de cada categoria
        padroes = [
            ('preco_gelo', 'Gelo padrão', 'gelo'),
            ('preco_papelao', 'Caixa de papelão padrão', 'papelao'),
            ('preco_fita', 'Fita padrão', 'fita'),
        ]
        for chave, nome, categoria in padroes:
            cursor.execute('SELECT valor FROM configuracoes WHERE chave = ?', (chave,))
            row = cursor.fetchone()
            valor = float(row[0]) if row and row[0] not in (None, '') else 0.0
            cursor.execute(
                'INSERT OR IGNORE INTO insumos (nome, valor, categoria) VALUES (?, ?, ?)',
                (nome, valor, categoria))

        cursor.execute(
            "INSERT OR REPLACE INTO configuracoes (chave, valor, descricao) "
            "VALUES ('migrou_insumos', 'true', 'Catalogo de insumos ja migrado')")

    def _migrar_usuarios_senha(self, cursor):
        """Adiciona a coluna senha_hash na tabela usuarios, se ainda não existir."""
        cursor.execute('PRAGMA table_info(usuarios)')
        existentes = {linha[1] for linha in cursor.fetchall()}
        if 'senha_hash' not in existentes:
            cursor.execute('ALTER TABLE usuarios ADD COLUMN senha_hash TEXT')

    def _migrar_calculos_insumos(self, cursor):
        """Adiciona ao 'calculos' as colunas que registram QUAL insumo foi usado em
        cada cálculo (gelo/papelão/fita/embalagem) e o custo da embalagem. Antes, só
        o custo total ficava salvo — perdia-se o tipo e a embalagem não reabria fiel.
        Colunas nulas: cálculos antigos continuam válidos (só sem esses detalhes)."""
        cursor.execute('PRAGMA table_info(calculos)')
        existentes = {linha[1] for linha in cursor.fetchall()}
        novas = {
            'custo_embalagem': 'REAL',
            'gelo_insumo_id': 'INTEGER',
            'papelao_insumo_id': 'INTEGER',
            'fita_insumo_id': 'INTEGER',
            'embalagem_id': 'INTEGER',
            'embalagem_qtd': 'INTEGER',
        }
        for nome, tipo in novas.items():
            if nome not in existentes:
                cursor.execute(f'ALTER TABLE calculos ADD COLUMN {nome} {tipo}')

    def _migrar_usuarios_2fa(self, cursor):
        """Adiciona as colunas de 2FA na tabela usuarios, se ainda não existirem:
          - totp_secret: o segredo base32 do autenticador (por usuário);
          - totp_confirmado: 0/1, se o usuário já concluiu o enrolamento do 2FA.
        Usuários antigos nascem com secret nulo e confirmado=0 -> no próximo login
        são levados a configurar o 2FA (que é obrigatório para todos)."""
        cursor.execute('PRAGMA table_info(usuarios)')
        existentes = {linha[1] for linha in cursor.fetchall()}
        if 'totp_secret' not in existentes:
            cursor.execute('ALTER TABLE usuarios ADD COLUMN totp_secret TEXT')
        if 'totp_confirmado' not in existentes:
            cursor.execute(
                'ALTER TABLE usuarios ADD COLUMN totp_confirmado INTEGER NOT NULL DEFAULT 0')

    def _migrar_usuarios_papel(self, cursor):
        """Adiciona a coluna 'papel' na tabela usuarios (controle de acesso / RBAC).
        Valor padrão 'leitura' = pode ver, mas não pode alterar/apagar dados.
        O papel 'admin' é dado explicitamente ao administrador em api.py."""
        cursor.execute('PRAGMA table_info(usuarios)')
        existentes = {linha[1] for linha in cursor.fetchall()}
        if 'papel' not in existentes:
            # DEFAULT garante que qualquer usuário antigo já nasça como 'leitura'
            cursor.execute(
                "ALTER TABLE usuarios ADD COLUMN papel TEXT NOT NULL DEFAULT 'leitura'")

    def _migrar_usuarios_permissoes(self, cursor):
        """Adiciona a coluna 'permissoes' (abas liberadas para usuários comuns).
        É uma lista separada por vírgula, ex.: 'history,produtos'. A Calculadora é
        sempre liberada (base). O admin ignora isto (tem acesso a tudo).
        Default 'history' mantém o comportamento antigo (usuário comum via o histórico)."""
        cursor.execute('PRAGMA table_info(usuarios)')
        existentes = {linha[1] for linha in cursor.fetchall()}
        if 'permissoes' not in existentes:
            cursor.execute(
                "ALTER TABLE usuarios ADD COLUMN permissoes TEXT NOT NULL DEFAULT 'history'")

    # ----------------------------------------------------------------------
    # Autenticação e backup
    # ----------------------------------------------------------------------
    def obter_usuario_por_email(self, email: str):
        """Retorna o usuário (id, nome, email, senha_hash, papel, 2FA) pelo e-mail, ou None."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                'SELECT id, nome, email, senha_hash, papel, permissoes, '
                'totp_secret, totp_confirmado FROM usuarios WHERE email = ?',
                (email,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    # ----------------------------------------------------------------------
    # 2FA (TOTP) — segredo por usuário + códigos de backup de uso único
    # ----------------------------------------------------------------------
    def obter_totp(self, usuario_id: int):
        """Retorna (totp_secret, totp_confirmado) do usuário, ou None se não existir."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                'SELECT totp_secret, totp_confirmado FROM usuarios WHERE id = ?', (usuario_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def definir_totp_secret(self, usuario_id: int, secret: str):
        """Guarda o segredo TOTP e marca como NÃO confirmado (só confirma quando o
        usuário digita um código válido pela primeira vez)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'UPDATE usuarios SET totp_secret = ?, totp_confirmado = 0 WHERE id = ?',
                (secret, usuario_id))
            conn.commit()
        finally:
            conn.close()

    def confirmar_totp(self, usuario_id: int):
        """Marca o 2FA do usuário como confirmado (enrolamento concluído)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('UPDATE usuarios SET totp_confirmado = 1 WHERE id = ?', (usuario_id,))
            conn.commit()
        finally:
            conn.close()

    def salvar_backup_codes(self, usuario_id: int, hashes):
        """Substitui os códigos de backup do usuário pelos novos (guardando só o HASH).
        Chamado no enrolamento; apaga os antigos para não acumular."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('DELETE FROM backup_codes WHERE usuario_id = ?', (usuario_id,))
            cursor.executemany(
                'INSERT INTO backup_codes (usuario_id, code_hash) VALUES (?, ?)',
                [(usuario_id, h) for h in hashes])
            conn.commit()
        finally:
            conn.close()

    def listar_hashes_backup_nao_usados(self, usuario_id: int):
        """Retorna [(id, code_hash)] dos códigos de backup ainda não usados do usuário."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'SELECT id, code_hash FROM backup_codes WHERE usuario_id = ? AND usado = 0',
                (usuario_id,))
            return cursor.fetchall()
        finally:
            conn.close()

    def marcar_backup_code_usado(self, code_id: int):
        """Marca um código de backup como usado (uso único)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('UPDATE backup_codes SET usado = 1 WHERE id = ?', (code_id,))
            conn.commit()
        finally:
            conn.close()

    def resetar_2fa(self, usuario_id: int):
        """Zera o 2FA de um usuário: apaga o segredo, marca como não confirmado e
        remove os códigos de backup. No próximo login, ele é levado a configurar de
        novo. Usado pelo admin quando alguém perde o app autenticador."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'UPDATE usuarios SET totp_secret = NULL, totp_confirmado = 0 WHERE id = ?',
                (usuario_id,))
            cursor.execute('DELETE FROM backup_codes WHERE usuario_id = ?', (usuario_id,))
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

    def definir_permissoes_usuario(self, usuario_id: int, permissoes: str):
        """Grava as abas liberadas do usuário (string separada por vírgula)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'UPDATE usuarios SET permissoes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (permissoes, usuario_id))
            conn.commit()
        finally:
            conn.close()

    def definir_papel_usuario(self, usuario_id: int, papel: str):
        """Define o papel do usuário ('admin' ou 'leitura')."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'UPDATE usuarios SET papel = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (papel, usuario_id))
            conn.commit()
        finally:
            conn.close()

    def listar_usuarios(self):
        """Lista os usuários (sem expor o hash da senha). Mostra se o usuário TEM
        senha (tem_senha) para o admin saber quem consegue logar."""
        conn = self._conectar()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, nome, email, papel, permissoes,
                       (senha_hash IS NOT NULL AND senha_hash != '') AS tem_senha,
                       totp_confirmado, created_at
                FROM usuarios ORDER BY nome
            ''')
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    # ----------------------------------------------------------------------
    # Rate limiting de login (compartilhado entre workers via banco)
    # ----------------------------------------------------------------------
    def contar_tentativas_login(self, ip: str, janela_seg: int) -> int:
        """Conta quantas falhas de login esse IP teve dentro da janela de tempo.
        Também aproveita para apagar registros velhos (fora da janela) — assim a
        tabela não cresce para sempre."""
        agora = datetime.now().timestamp()
        limite = agora - janela_seg
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            # Limpeza: remove tentativas antigas de qualquer IP
            cursor.execute('DELETE FROM login_tentativas WHERE criado_em < ?', (limite,))
            cursor.execute(
                'SELECT COUNT(*) FROM login_tentativas WHERE ip = ? AND criado_em >= ?',
                (ip, limite))
            total = cursor.fetchone()[0]
            conn.commit()
            return total
        finally:
            conn.close()

    def registrar_tentativa_login(self, ip: str):
        """Registra uma falha de login para o IP (com o horário atual)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'INSERT INTO login_tentativas (ip, criado_em) VALUES (?, ?)',
                (ip, datetime.now().timestamp()))
            conn.commit()
        finally:
            conn.close()

    def limpar_tentativas_login(self, ip: str):
        """Zera as tentativas de um IP (chamado quando o login dá certo)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('DELETE FROM login_tentativas WHERE ip = ?', (ip,))
            conn.commit()
        finally:
            conn.close()

    def definir_senha_usuario(self, usuario_id: int, senha_hash: str):
        """Grava o hash da senha de um usuário (nunca a senha em texto puro)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'UPDATE usuarios SET senha_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (senha_hash, usuario_id))
            conn.commit()
        finally:
            conn.close()

    def forcar_checkpoint(self):
        """Descarrega o arquivo -wal para dentro do .db principal.
        Com o modo WAL ligado, as escritas recentes ficam num arquivo separado
        (banco.db-wal) até um 'checkpoint'. Antes de copiar/baixar o banco, é preciso
        rodar isto, senão a cópia pode não conter as últimas transações."""
        conn = self._conectar()
        try:
            conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            conn.commit()
        finally:
            conn.close()

    def criar_backup(self, pasta: str = 'backups') -> str:
        """Copia o arquivo do banco para a pasta de backups, com data/hora no nome.
        Retorna o caminho do arquivo criado."""
        self.forcar_checkpoint()   # garante que o backup tenha TODOS os dados
        os.makedirs(pasta, exist_ok=True)
        nome = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        destino = os.path.join(pasta, nome)
        # copy2 preserva metadados (data de modificacao etc.)
        shutil.copy2(self.db_path, destino)
        return destino

    # SELECT reaproveitado: traz o produto + nome/valor da embalagem (LEFT JOIN,
    # pois embalagem_id pode ser NULL). A embalagem agora vive no catálogo de
    # 'insumos' (categoria 'embalagem'); por isso o JOIN é com insumos, não com a
    # tabela antiga 'embalagens'. 'p' = produtos, 'e' = insumo de embalagem.
    _SELECT_PRODUTO = '''
        SELECT p.id, p.nome, p.preco_kg, p.validade, p.fornecedor, p.categoria,
               p.lote, p.fabricacao, p.observacoes, p.quantidade, p.unidade,
               p.peso_unitario, p.embalagem_id,
               e.nome AS embalagem_nome, e.valor AS embalagem_valor,
               (SELECT MIN(l.validade) FROM lotes l
                  WHERE l.produto_id = p.id AND l.validade IS NOT NULL AND l.validade != '')
                  AS proxima_validade,
               (SELECT COUNT(*) FROM lotes l WHERE l.produto_id = p.id) AS num_lotes
        FROM produtos p
        LEFT JOIN insumos e ON e.id = p.embalagem_id AND e.categoria = 'embalagem'
    '''

    def listar_produtos(self):
        """Retorna todos os produtos (perfil completo + embalagem), em ordem alfabética."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(self._SELECT_PRODUTO + ' ORDER BY p.nome')
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def obter_produto(self, produto_id):
        """Retorna um único produto (perfil completo + embalagem) ou None."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(self._SELECT_PRODUTO + ' WHERE p.id = ?', (produto_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    # (Os antigos métodos de 'embalagens' foram removidos: embalagem agora é uma
    #  categoria de insumo, gerenciada pelos métodos de insumo abaixo. A tabela
    #  'embalagens' segue existindo só como origem da migração _migrar_insumos.)

    # ----------------------------------------------------------------------
    # Insumos (catálogo unificado: gelo, papelão, fita, embalagem, ...)
    # ----------------------------------------------------------------------
    def listar_insumos(self, categoria: str = None):
        """Lista os insumos do catálogo, opcionalmente filtrando por categoria.
        Ordena por categoria e nome (bom para agrupar na tela e nos selects)."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            if categoria:
                cursor.execute(
                    'SELECT id, nome, valor, categoria FROM insumos '
                    'WHERE categoria = ? ORDER BY nome', (categoria,))
            else:
                cursor.execute(
                    'SELECT id, nome, valor, categoria FROM insumos '
                    'ORDER BY categoria, nome')
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def obter_insumo(self, insumo_id: int):
        """Retorna um insumo (id, nome, valor, categoria) pelo id, ou None.
        Usado no cálculo para pegar o VALOR no servidor (fonte confiável), em vez
        de confiar no valor enviado pelo cliente."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                'SELECT id, nome, valor, categoria FROM insumos WHERE id = ?', (insumo_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def criar_insumo(self, nome: str, valor: float, categoria: str) -> int:
        """Cria um tipo de insumo numa categoria. Levanta ValueError se já existir
        um insumo com o mesmo nome NAQUELA categoria (a unicidade é por par
        nome+categoria, então dá para ter 'Padrão' em gelo e em papelão)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'INSERT INTO insumos (nome, valor, categoria) VALUES (?, ?, ?)',
                (nome, valor, categoria))
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            raise ValueError('Já existe um insumo com esse nome nessa categoria')
        finally:
            conn.close()

    def atualizar_insumo(self, insumo_id: int, nome: str, valor: float):
        """Atualiza nome e valor de um insumo (a categoria não muda)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('UPDATE insumos SET nome = ?, valor = ? WHERE id = ?',
                           (nome, valor, insumo_id))
            conn.commit()
            return cursor.rowcount
        except sqlite3.IntegrityError:
            raise ValueError('Já existe um insumo com esse nome nessa categoria')
        finally:
            conn.close()

    def remover_insumo(self, insumo_id: int):
        """Remove um insumo do catálogo. Se ele for uma embalagem em uso por algum
        produto, desvincula antes (produtos.embalagem_id vira NULL), igual à regra
        antiga de embalagens."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('UPDATE produtos SET embalagem_id = NULL WHERE embalagem_id = ?',
                           (insumo_id,))
            cursor.execute('DELETE FROM insumos WHERE id = ?', (insumo_id,))
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

    def criar_produto(self, nome, preco_kg=0, validade=None, fornecedor=None,
                      categoria=None, lote=None, fabricacao=None, observacoes=None,
                      quantidade=None, unidade=None, peso_unitario=None):
        """Cria um novo produto. Levanta ValueError se o nome já existir."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO produtos (nome, preco_kg, validade, fornecedor, categoria, lote, fabricacao, observacoes,
                                      quantidade, unidade, peso_unitario)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (nome, preco_kg, validade, fornecedor, categoria, lote, fabricacao, observacoes,
                  quantidade, unidade, peso_unitario))
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
        # Mantém só os campos permitidos. Normalmente descarta None (não mexe no campo),
        # MAS embalagem_id=None é intencional: significa "remover a embalagem".
        campos = {k: v for k, v in campos.items()
                  if k in self.CAMPOS_EDITAVEIS_PRODUTO and (v is not None or k == 'embalagem_id')}
        if not campos:
            return 0

        conn = self._conectar()
        cursor = conn.cursor()
        try:
            # Campos rastreados no histórico e o rótulo salvo no log (coluna -> nome).
            # lote/validade/fabricação saíram daqui: agora são gerenciados por LOTES.
            RASTREAR = {'preco_kg': 'preco', 'fornecedor': 'fornecedor',
                        'categoria': 'categoria', 'observacoes': 'observacoes'}
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
        """Remove um produto e tudo ligado a ele (histórico e lotes)."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('DELETE FROM historico_produto WHERE produto_id = ?', (produto_id,))
            cursor.execute('DELETE FROM lotes WHERE produto_id = ?', (produto_id,))
            cursor.execute('DELETE FROM produtos WHERE id = ?', (produto_id,))
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

    # ----------------------------------------------------------------------
    # Lotes (partidas) de um produto: cada um com validade/fabricação/quantidade
    # ----------------------------------------------------------------------
    def listar_lotes(self, produto_id):
        """Lista os lotes de um produto, ordenados pela validade mais próxima primeiro
        (lotes sem validade vão para o fim)."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute('''
                SELECT id, produto_id, codigo, fabricacao, validade, quantidade, created_at
                FROM lotes WHERE produto_id = ?
                ORDER BY (validade IS NULL OR validade = ''), validade ASC, id DESC
            ''', (produto_id,))
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def obter_lote(self, lote_id):
        """Retorna um lote (ou None). Útil para saber a que produto ele pertence."""
        conn = self._conectar()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute('SELECT * FROM lotes WHERE id = ?', (lote_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def criar_lote(self, produto_id, codigo=None, fabricacao=None, validade=None, quantidade=None):
        """Cria um novo lote para um produto."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'INSERT INTO lotes (produto_id, codigo, fabricacao, validade, quantidade) '
                'VALUES (?, ?, ?, ?, ?)', (produto_id, codigo, fabricacao, validade, quantidade))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def atualizar_lote(self, lote_id, codigo=None, fabricacao=None, validade=None, quantidade=None):
        """Atualiza os campos de um lote."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute(
                'UPDATE lotes SET codigo = ?, fabricacao = ?, validade = ?, quantidade = ? WHERE id = ?',
                (codigo, fabricacao, validade, quantidade, lote_id))
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

    def remover_lote(self, lote_id):
        """Remove um lote."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('DELETE FROM lotes WHERE id = ?', (lote_id,))
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

    def adicionar_historico_produto(self, produto_id, campo, valor_anterior, valor_novo):
        """Acrescenta uma linha no histórico unificado do produto. Usado para registrar
        eventos que não passam pelo UPDATE de produtos — como adicionar/remover lote."""
        conn = self._conectar()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO historico_produto (produto_id, campo, valor_anterior, valor_novo)
                VALUES (?, ?, ?, ?)
            ''', (produto_id, campo,
                  None if valor_anterior is None else str(valor_anterior),
                  None if valor_novo is None else str(valor_novo)))
            conn.commit()
        finally:
            conn.close()

    def listar_historico_produto(self, produto_id):
        """Retorna o histórico unificado de alterações de um produto
        (campo, valor_anterior, valor_novo, created_at), do mais recente ao mais antigo."""
        conn = self._conectar()
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
        conn = self._conectar()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO usuarios (nome, email, empresa, telefone)
                VALUES (?, ?, ?, ?)
            ''', (nome, email, empresa, telefone))
            
            usuario_id = cursor.lastrowid

            # Log da atividade ANTES do commit: assim o usuário e o log são gravados
            # juntos, na mesma transação. (Antes o commit vinha primeiro e o log era
            # descartado no close() — por isso a tabela de logs ficava vazia.)
            self._log_atividade(cursor, usuario_id, 'usuario_criado',
                              f'Usuário {nome} criado com sucesso')
            conn.commit()

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
        conn = self._conectar()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO calculos (
                    usuario_id, produto, categoria, preco_kg, peso_inicial, peso_final,
                    sacos_gelo, caixas_papelao,
                    custo_sacos_gelo, custo_papelao, custo_fita_papelao, custo_embalagem,
                    diferenca_pesos, custo_producao, custo_pos_beneficiamento,
                    porcentagem_beneficiamento, diferenca_valor, custos_totais,
                    custo_final, observacoes,
                    gelo_insumo_id, papelao_insumo_id, fita_insumo_id, embalagem_id, embalagem_qtd
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                resultados.get('custo_embalagem', 0),
                resultados['diferenca_pesos'],
                resultados['custo_producao'],
                resultados['custo_pos_beneficiamento'],
                resultados['porcentagem'],
                resultados['diferenca_valor'],
                resultados['custos_totais'],
                resultados['custo_final'],
                observacoes,
                dados_calculo.get('gelo_insumo_id'),
                dados_calculo.get('papelao_insumo_id'),
                dados_calculo.get('fita_insumo_id'),
                dados_calculo.get('embalagem_id'),
                dados_calculo.get('embalagem_qtd'),
            ))
            
            calculo_id = cursor.lastrowid

            # Log da atividade ANTES do commit, para salvar cálculo e log juntos
            # na mesma transação (ver explicação em criar_usuario).
            self._log_atividade(cursor, usuario_id, 'calculo_salvo',
                              f'Cálculo {calculo_id} salvo para produto {dados_calculo["produto"]}')
            conn.commit()

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
        conn = self._conectar()
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

    def remover_calculos_usuario(self, usuario_id: int) -> int:
        """Apaga TODOS os cálculos de um usuário. Retorna quantos foram apagados.
        Usado pelo 'Limpar histórico' — que antes só limpava a tela, sem apagar
        de verdade no banco."""
        conn = self._conectar()
        try:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM calculos WHERE usuario_id = ?', (usuario_id,))
            conn.commit()
            return cursor.rowcount
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
        conn = self._conectar()
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
        conn = self._conectar()
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
        conn = self._conectar()
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
        conn = self._conectar()
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

    def registrar_log(self, usuario_id=None, acao: str = '', detalhes: str = None,
                      ip: str = None, user_agent: str = None):
        """Registra uma OCORRÊNCIA (login, acesso negado, erro, etc.) na tabela de logs.
        Diferente de _log_atividade, este abre a PRÓPRIA conexão — use quando você
        NÃO está dentro de outra transação (ex.: chamando da API, em api.py).
        Envolve tudo em try/except: uma falha ao gravar o log JAMAIS pode derrubar
        a operação principal do usuário."""
        def _inserir(uid):
            conn = self._conectar()
            try:
                conn.execute('''
                    INSERT INTO logs_atividade (usuario_id, acao, detalhes, ip_address, user_agent)
                    VALUES (?, ?, ?, ?, ?)
                ''', (uid, acao, detalhes, ip, user_agent))
                conn.commit()
            finally:
                conn.close()
        try:
            _inserir(usuario_id)
        except Exception:
            # Pode falhar se o usuario_id não existir mais (a FK bloqueia). Um log de
            # segurança não pode ser PERDIDO por isso -> regrava sem vincular ao usuário.
            try:
                _inserir(None)
            except Exception as e:
                print(f"Erro ao registrar log: {e}")

    def listar_logs(self, limite: int = 100, offset: int = 0, acao: str = None,
                    de: str = None, ate: str = None):
        """Retorna as ocorrências mais recentes, já com o nome do usuário.
        Usa LEFT JOIN porque usuario_id pode ser NULL (ex.: falha de login de um
        e-mail que nem existe) — com INNER JOIN essas linhas sumiriam do relatório.
        Filtros opcionais: acao (tipo) e intervalo de datas de/ate (YYYY-MM-DD)."""
        conn = self._conectar()
        try:
            cursor = conn.cursor()
            sql = '''
                SELECT l.id, l.acao, l.detalhes, l.ip_address, l.created_at,
                       l.usuario_id, u.nome AS usuario_nome
                FROM logs_atividade l
                LEFT JOIN usuarios u ON u.id = l.usuario_id
            '''
            # Monta os filtros dinamicamente; valores sempre parametrizados (?)
            condicoes = []
            params = []
            if acao:
                condicoes.append('l.acao = ?')
                params.append(acao)
            if de:
                condicoes.append('date(l.created_at) >= date(?)')
                params.append(de)
            if ate:
                condicoes.append('date(l.created_at) <= date(?)')
                params.append(ate)
            if condicoes:
                sql += ' WHERE ' + ' AND '.join(condicoes)
            sql += ' ORDER BY l.id DESC LIMIT ? OFFSET ?'
            params.extend([limite, offset])
            cursor.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def limpar_logs_antigos(self, dias: int = 90) -> int:
        """Apaga logs com mais de N dias (retenção). Retorna quantos foram apagados.
        Evita que a tabela de logs cresça para sempre."""
        conn = self._conectar()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM logs_atividade WHERE created_at < datetime('now', ?)",
                (f'-{int(dias)} days',))
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

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
        conn = self._conectar()
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
        
        conn = self._conectar()
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
