#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🐟 API REST - Calculadora de Custos
Beneficiamento de Pescados

API Flask para gerenciar dados do banco SQLite
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from collections import defaultdict
import json
import os
import time
from datetime import datetime
from database import DatabaseManager
from calculos import calcular_resultados

app = Flask(__name__)

# CORS: em produção, defina FRONTEND_URL com o endereço do seu site (ex.: https://seuapp.vercel.app)
# para aceitar chamadas só de lá. Sem essa variável (dev), libera qualquer origem.
FRONTEND_URL = os.environ.get('FRONTEND_URL')
if FRONTEND_URL:
    CORS(app, origins=[FRONTEND_URL])
else:
    CORS(app)

# Inicializar banco de dados
db = DatabaseManager()

# ---------------------------------------------------------------------------
# Autenticação: login com senha em HASH + token assinado (sem sessão no servidor)
# ---------------------------------------------------------------------------
# A SECRET_KEY assina os tokens. EM PRODUÇÃO, defina a variável de ambiente SECRET_KEY.
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    SECRET_KEY = 'dev-inseguro-troque-em-producao'
    print('⚠️  SECRET_KEY não definido — usando chave de desenvolvimento. Defina em produção!')
serializer = URLSafeTimedSerializer(SECRET_KEY)
TOKEN_VALIDADE = 7 * 24 * 3600   # token vale 7 dias

# Rotas que NÃO exigem login
CAMINHOS_ABERTOS = {'/api/health', '/api/login'}

# ---------------------------------------------------------------------------
# Proteção contra força bruta no login: limita tentativas por IP
# ---------------------------------------------------------------------------
LOGIN_TENTATIVAS = defaultdict(list)   # ip -> lista de horários de falhas
LOGIN_MAX = 5                          # máximo de falhas...
LOGIN_JANELA = 300                     # ...dentro de 5 minutos (300s)


def _ip_cliente():
    """Descobre o IP do cliente, respeitando o proxy do Railway (X-Forwarded-For)."""
    xff = request.headers.get('X-Forwarded-For', '')
    return xff.split(',')[0].strip() if xff else (request.remote_addr or 'desconhecido')


def garantir_admin():
    """Garante que existe um usuário administrador com senha.
    A senha vem de ADMIN_SENHA (variável de ambiente). Sem ela, cria um padrão e avisa."""
    email = os.environ.get('ADMIN_EMAIL', 'admin@calculadora.local')
    senha = os.environ.get('ADMIN_SENHA')
    usuario = db.obter_usuario_por_email(email)
    if senha:
        # A variável de ambiente é a fonte da verdade da senha
        uid = usuario['id'] if usuario else db.criar_usuario(nome='Administrador', email=email)
        db.definir_senha_usuario(uid, generate_password_hash(senha))
    elif not (usuario and usuario.get('senha_hash')):
        # Primeira vez, sem ADMIN_SENHA: cria com senha padrão e avisa
        uid = usuario['id'] if usuario else db.criar_usuario(nome='Administrador', email=email)
        db.definir_senha_usuario(uid, generate_password_hash('admin123'))
        print(f'⚠️  Admin criado: e-mail "{email}", senha padrão "admin123". '
              'Defina ADMIN_SENHA e troque assim que possível!')


garantir_admin()


@app.before_request
def proteger_api():
    """Exige token válido em todas as rotas /api/, exceto as abertas (health e login)."""
    if request.method == 'OPTIONS':
        return  # deixa o preflight do CORS passar
    caminho = request.path
    if caminho.startswith('/api/') and caminho not in CAMINHOS_ABERTOS:
        auth = request.headers.get('Authorization', '')
        token = auth[7:] if auth.startswith('Bearer ') else None
        if not token:
            return jsonify({'error': 'Não autorizado'}), 401
        try:
            serializer.loads(token, max_age=TOKEN_VALIDADE)
        except (BadSignature, SignatureExpired):
            return jsonify({'error': 'Sessão expirada. Faça login novamente.'}), 401


@app.route('/api/login', methods=['POST'])
def login():
    """Autentica por e-mail + senha e devolve um token assinado."""
    try:
        ip = _ip_cliente()
        agora = time.time()
        # Descarta tentativas antigas (fora da janela) e checa o limite
        LOGIN_TENTATIVAS[ip] = [t for t in LOGIN_TENTATIVAS[ip] if agora - t < LOGIN_JANELA]
        if len(LOGIN_TENTATIVAS[ip]) >= LOGIN_MAX:
            return jsonify({'error': 'Muitas tentativas. Tente novamente em alguns minutos.'}), 429

        data = request.get_json() or {}
        email = (data.get('email') or '').strip()
        senha = data.get('senha') or ''
        usuario = db.obter_usuario_por_email(email)
        if not usuario or not usuario.get('senha_hash') \
                or not check_password_hash(usuario['senha_hash'], senha):
            LOGIN_TENTATIVAS[ip].append(agora)   # registra a falha
            return jsonify({'error': 'E-mail ou senha inválidos'}), 401

        LOGIN_TENTATIVAS.pop(ip, None)           # login ok: zera o contador do IP
        token = serializer.dumps({'uid': usuario['id']})
        return jsonify({'success': True, 'token': token, 'nome': usuario['nome']})
    except Exception as e:
        app.logger.error(f'Erro no login: {e}')
        return jsonify({'error': 'Erro no login'}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Verificar status da API"""
    return jsonify({
        'status': 'ok',
        'message': 'API funcionando',
        'timestamp': datetime.now().isoformat(),
        'version': db.obter_configuracao('versao_sistema')
    })

@app.route('/api/usuarios', methods=['POST'])
def criar_usuario():
    """Criar novo usuário"""
    try:
        data = request.get_json()
        
        # Validações básicas
        if not data.get('nome'):
            return jsonify({'error': 'Nome é obrigatório'}), 400
        
        usuario_id = db.criar_usuario(
            nome=data['nome'],
            email=data.get('email'),
            empresa=data.get('empresa'),
            telefone=data.get('telefone')
        )
        
        return jsonify({
            'success': True,
            'message': 'Usuário criado com sucesso',
            'usuario_id': usuario_id
        }), 201
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f'Erro interno: {e}')
        return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/calculos', methods=['POST'])
def salvar_calculo():
    """Salvar novo cálculo"""
    try:
        data = request.get_json()
        
        # Validações
        campos_obrigatorios = ['usuario_id', 'produto', 'categoria', 'preco', 
                              'peso_inicial', 'peso_final', 'sacos_de_gelo', 'caixa_papelao']
        
        for campo in campos_obrigatorios:
            if campo not in data:
                return jsonify({'error': f'Campo {campo} é obrigatório'}), 400
        
        # Preparar dados
        dados_calculo = {
            'produto': data['produto'],
            'categoria': data['categoria'],
            'preco': float(data['preco']),
            'peso_inicial': float(data['peso_inicial']),
            'peso_final': float(data['peso_final']),
            'sacos_de_gelo': int(data['sacos_de_gelo']),
            'caixa_papelao': int(data['caixa_papelao'])
        }
        
        # Calcular resultados (usando a fonte unica: calculos.py)
        resultados = calcular_resultados(
            preco=dados_calculo['preco'],
            peso_inicial=dados_calculo['peso_inicial'],
            peso_final=dados_calculo['peso_final'],
            sacos_de_gelo=dados_calculo['sacos_de_gelo'],
            caixa_papelao=dados_calculo['caixa_papelao'],
            preco_gelo=float(db.obter_configuracao('preco_gelo')),
            preco_papelao=float(db.obter_configuracao('preco_papelao')),
            preco_fita=float(db.obter_configuracao('preco_fita')),
            preco_venda=float(data['preco_venda']) if data.get('preco_venda') else None,
        )

        # Salvar no banco
        calculo_id = db.salvar_calculo(
            usuario_id=int(data['usuario_id']),
            dados_calculo=dados_calculo,
            resultados=resultados,
            observacoes=data.get('observacoes')
        )
        
        return jsonify({
            'success': True,
            'message': 'Cálculo salvo com sucesso',
            'calculo_id': calculo_id,
            'resultados': resultados
        }), 201
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f'Erro ao salvar cálculo: {e}')
        return jsonify({'error': 'Erro ao salvar cálculo'}), 500

@app.route('/api/calculos/usuario/<int:usuario_id>', methods=['GET'])
def obter_calculos_usuario(usuario_id):
    """Obter cálculos de um usuário específico"""
    try:
        limite = request.args.get('limite', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        calculos = db.obter_calculos_usuario(usuario_id, limite, offset)
        
        return jsonify({
            'success': True,
            'calculos': calculos,
            'total': len(calculos)
        })
        
    except Exception as e:
        app.logger.error(f'Erro ao obter cálculos: {e}')
        return jsonify({'error': 'Erro ao obter cálculos'}), 500

@app.route('/api/calculos', methods=['GET'])
def obter_todos_calculos():
    """Obter todos os cálculos do sistema"""
    try:
        limite = request.args.get('limite', 100, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        calculos = db.obter_todos_calculos(limite, offset)
        
        return jsonify({
            'success': True,
            'calculos': calculos,
            'total': len(calculos)
        })
        
    except Exception as e:
        app.logger.error(f'Erro ao obter cálculos: {e}')
        return jsonify({'error': 'Erro ao obter cálculos'}), 500

@app.route('/api/estatisticas', methods=['GET'])
def obter_estatisticas():
    """Obter estatísticas gerais do sistema"""
    try:
        stats = db.obter_estatisticas()
        
        return jsonify({
            'success': True,
            'estatisticas': stats
        })
        
    except Exception as e:
        app.logger.error(f'Erro ao obter estatísticas: {e}')
        return jsonify({'error': 'Erro ao obter estatísticas'}), 500

@app.route('/api/configuracoes', methods=['GET'])
def obter_configuracoes():
    """Obter configurações do sistema"""
    try:
        configuracoes = {}
        chaves = ['preco_gelo', 'preco_papelao', 'preco_fita', 'versao_sistema']
        
        for chave in chaves:
            configuracoes[chave] = db.obter_configuracao(chave)
        
        return jsonify({
            'success': True,
            'configuracoes': configuracoes
        })
        
    except Exception as e:
        app.logger.error(f'Erro ao obter configurações: {e}')
        return jsonify({'error': 'Erro ao obter configurações'}), 500

@app.route('/api/configuracoes', methods=['PUT'])
def atualizar_configuracoes():
    """Atualizar os preços dos insumos (só as chaves conhecidas, validadas)."""
    CHAVES_PRECO = {'preco_gelo', 'preco_papelao', 'preco_fita'}
    try:
        data = request.get_json() or {}
        atualizadas = 0
        for chave, valor in data.items():
            if chave not in CHAVES_PRECO:
                continue  # ignora chaves desconhecidas: não deixa gravar qualquer coisa
            try:
                v = float(valor)
            except (TypeError, ValueError):
                return jsonify({'error': f'{chave} deve ser um número'}), 400
            if v < 0:
                return jsonify({'error': f'{chave} não pode ser negativo'}), 400
            db.atualizar_configuracao(chave, str(v))
            atualizadas += 1

        return jsonify({
            'success': True,
            'message': f'{atualizadas} configuração(ões) atualizada(s)'
        })

    except Exception as e:
        app.logger.error(f'Erro ao atualizar configurações: {e}')
        return jsonify({'error': 'Erro ao atualizar configurações'}), 500

@app.route('/api/produtos', methods=['GET'])
def listar_produtos():
    """Lista todos os produtos (perfil completo)."""
    try:
        return jsonify({'success': True, 'produtos': db.listar_produtos()})
    except Exception as e:
        app.logger.error(f'Erro ao listar produtos: {e}')
        return jsonify({'error': 'Erro ao listar produtos'}), 500

@app.route('/api/produtos/<int:produto_id>', methods=['GET'])
def obter_produto(produto_id):
    """Retorna um único produto (perfil completo)."""
    try:
        produto = db.obter_produto(produto_id)
        if produto is None:
            return jsonify({'error': 'Produto não encontrado'}), 404
        return jsonify({'success': True, 'produto': produto})
    except Exception as e:
        app.logger.error(f'Erro ao obter produto: {e}')
        return jsonify({'error': 'Erro ao obter produto'}), 500

@app.route('/api/produtos/<int:produto_id>/historico', methods=['GET'])
def historico_produto(produto_id):
    """Retorna o histórico unificado de alterações de um produto."""
    try:
        return jsonify({'success': True, 'historico': db.listar_historico_produto(produto_id)})
    except Exception as e:
        app.logger.error(f'Erro ao obter histórico do produto: {e}')
        return jsonify({'error': 'Erro ao obter histórico do produto'}), 500

@app.route('/api/produtos', methods=['POST'])
def criar_produto():
    """Cria um novo produto com o perfil completo."""
    try:
        data = request.get_json()
        nome = (data.get('nome') or '').strip()
        if not nome:
            return jsonify({'error': 'Nome do produto é obrigatório'}), 400
        preco_kg = float(data.get('preco_kg') or 0)
        if preco_kg < 0:
            return jsonify({'error': 'O preço não pode ser negativo'}), 400
        produto_id = db.criar_produto(
            nome=nome,
            preco_kg=preco_kg,
            validade=data.get('validade') or None,
            fornecedor=data.get('fornecedor') or None,
            categoria=data.get('categoria') or None,
            lote=data.get('lote') or None,
            fabricacao=data.get('fabricacao') or None,
            observacoes=data.get('observacoes') or None,
        )
        return jsonify({'success': True, 'produto_id': produto_id}), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f'Erro ao criar produto: {e}')
        return jsonify({'error': 'Erro ao criar produto'}), 500

@app.route('/api/produtos/<int:produto_id>', methods=['PUT'])
def atualizar_produto(produto_id):
    """Atualiza os campos informados de um produto (perfil e/ou preço)."""
    try:
        data = request.get_json() or {}
        campos = {}
        if 'nome' in data:
            campos['nome'] = (data.get('nome') or '').strip() or None
        if data.get('preco_kg') is not None:
            campos['preco_kg'] = float(data['preco_kg'])
            if campos['preco_kg'] < 0:
                return jsonify({'error': 'O preço não pode ser negativo'}), 400
        for chave in ('validade', 'fornecedor', 'categoria', 'lote', 'fabricacao', 'observacoes'):
            if chave in data:
                campos[chave] = data.get(chave)
        db.atualizar_produto(produto_id, **campos)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f'Erro ao atualizar produto: {e}')
        return jsonify({'error': 'Erro ao atualizar produto'}), 500

@app.route('/api/produtos/<int:produto_id>', methods=['DELETE'])
def remover_produto(produto_id):
    """Remove um produto e seu histórico."""
    try:
        db.remover_produto(produto_id)
        return jsonify({'success': True})
    except Exception as e:
        app.logger.error(f'Erro ao remover produto: {e}')
        return jsonify({'error': 'Erro ao remover produto'}), 500

@app.route('/api/backup', methods=['POST'])
def fazer_backup():
    """Cria uma cópia do banco no servidor (pasta backups/)."""
    try:
        destino = db.criar_backup()
        return jsonify({'success': True, 'arquivo': os.path.basename(destino)}), 201
    except Exception as e:
        app.logger.error(f'Erro ao criar backup: {e}')
        return jsonify({'error': 'Erro ao criar backup'}), 500

@app.route('/api/backup/download', methods=['GET'])
def baixar_backup():
    """Envia o arquivo do banco para download (o backup que você guarda no seu PC)."""
    try:
        nome = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        return send_file(db.db_path, as_attachment=True, download_name=nome)
    except Exception as e:
        app.logger.error(f'Erro ao baixar backup: {e}')
        return jsonify({'error': 'Erro ao baixar backup'}), 500

@app.route('/api/exportar', methods=['GET'])
def exportar_dados():
    """Exportar dados do sistema"""
    try:
        formato = request.args.get('formato', 'json')
        
        if formato not in ['json', 'csv']:
            return jsonify({'error': 'Formato não suportado. Use "json" ou "csv"'}), 400
        
        arquivo = db.exportar_dados(formato)
        
        return send_file(
            arquivo,
            as_attachment=True,
            download_name=arquivo,
            mimetype='application/octet-stream'
        )
        
    except Exception as e:
        app.logger.error(f'Erro ao exportar dados: {e}')
        return jsonify({'error': 'Erro ao exportar dados'}), 500

@app.route('/api/calcular', methods=['POST'])
def calcular_beneficiamento():
    """Calcular beneficiamento sem salvar no banco"""
    try:
        data = request.get_json()
        
        # Validações
        campos_obrigatorios = ['produto', 'categoria', 'preco', 
                              'peso_inicial', 'peso_final', 'sacos_de_gelo', 'caixa_papelao']
        
        for campo in campos_obrigatorios:
            if campo not in data:
                return jsonify({'error': f'Campo {campo} é obrigatório'}), 400
        
        # Preparar dados
        dados = {
            'produto': data['produto'],
            'categoria': data['categoria'],
            'preco': float(data['preco']),
            'peso_inicial': float(data['peso_inicial']),
            'peso_final': float(data['peso_final']),
            'sacos_de_gelo': int(data['sacos_de_gelo']),
            'caixa_papelao': int(data['caixa_papelao'])
        }
        
        # Calcular resultados (fonte unica: calculos.py).
        # Validacoes de peso/preco vivem dentro de calcular_resultados (levanta ValueError).
        resultados = calcular_resultados(
            preco=dados['preco'],
            peso_inicial=dados['peso_inicial'],
            peso_final=dados['peso_final'],
            sacos_de_gelo=dados['sacos_de_gelo'],
            caixa_papelao=dados['caixa_papelao'],
            preco_gelo=float(db.obter_configuracao('preco_gelo')),
            preco_papelao=float(db.obter_configuracao('preco_papelao')),
            preco_fita=float(db.obter_configuracao('preco_fita')),
            preco_venda=float(data['preco_venda']) if data.get('preco_venda') else None,
        )

        return jsonify({
            'success': True,
            'dados': dados,
            'resultados': resultados,
            'timestamp': datetime.now().isoformat()
        })
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        app.logger.error(f'Erro ao calcular: {e}')
        return jsonify({'error': 'Erro ao calcular'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint não encontrado'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Erro interno do servidor'}), 500

def criar_usuario_padrao():
    """Criar usuário padrão para testes"""
    try:
        usuario_id = db.criar_usuario(
            nome="Usuário Padrão",
            email="padrao@beneficiamento.com",
            empresa="Sistema de Beneficiamento",
            telefone="(11) 0000-0000"
        )
        print(f"✅ Usuário padrão criado com ID: {usuario_id}")
        return usuario_id
    except ValueError:
        # Usuário já existe
        return 1

if __name__ == '__main__':
    print("🐟 Iniciando API REST - Calculadora de Custos")
    print("=" * 50)
    
    # Criar usuário padrão
    usuario_padrao_id = criar_usuario_padrao()
    
    # Configurar porta para produção
    port = int(os.environ.get('PORT', 5000))
    # Debug LIGA só se FLASK_ENV=development (fail-safe: desligado por padrão).
    # Em produção o app roda pelo gunicorn (Procfile), então este bloco nem executa.
    debug = os.environ.get('FLASK_ENV') == 'development'
    
    if debug:
        print(f"🌐 API rodando em: http://localhost:{port}")
    else:
        print(f"🌐 API rodando em modo produção na porta: {port}")
    
    print(f"📊 Endpoints disponíveis:")
    print(f"   • GET  /api/health - Status da API")
    print(f"   • POST /api/usuarios - Criar usuário")
    print(f"   • POST /api/calculos - Salvar cálculo")
    print(f"   • GET  /api/calculos - Listar todos os cálculos")
    print(f"   • POST /api/calcular - Calcular sem salvar")
    print(f"   • GET  /api/estatisticas - Estatísticas do sistema")
    print(f"   • GET  /api/configuracoes - Configurações")
    print(f"   • GET  /api/exportar - Exportar dados")
    print("=" * 50)
    
    # Executar API
    app.run(host='0.0.0.0', port=port, debug=debug)
