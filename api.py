#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🐟 API REST - Calculadora de Custos
Beneficiamento de Pescados

API Flask para gerenciar dados do banco SQLite
"""

from functools import wraps
from flask import Flask, request, jsonify, send_file, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
import json
import os
import re
import time
import secrets
import pyotp
from datetime import datetime
from database import DatabaseManager
from calculos import calcular_resultados

app = Flask(__name__)

# Estamos em produção? (definido na configuração do PythonAnywhere com FLASK_ENV=production)
EM_PRODUCAO = os.environ.get('FLASK_ENV') == 'production'

# ---------------------------------------------------------------------------
# Monitoramento de erros (Sentry) — OPCIONAL e desligado por padrão.
# Só liga se a variável de ambiente SENTRY_DSN estiver definida (o DSN é o
# endereço do seu projeto no Sentry). Sem ela, ou sem o pacote instalado, o app
# roda normalmente — nada é enviado para fora. Assim o segredo (DSN) fica no
# ambiente, nunca no código. (Não há "source map" a configurar: o JS do site é
# servido como está, sem minificação/build, então já é legível no navegador.)
# ---------------------------------------------------------------------------
SENTRY_DSN = os.environ.get('SENTRY_DSN')
if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[FlaskIntegration()],
            environment='producao' if EM_PRODUCAO else 'dev',
            traces_sample_rate=0.0,     # sem tracing de performance por padrão
            send_default_pii=False,     # não envia dados pessoais (e-mail, IP) ao Sentry
        )
        print('✅ Sentry ativado (monitoramento de erros).')
    except Exception as e:
        # Falhar aqui não pode derrubar o app — monitoramento é acessório.
        print(f'⚠️  SENTRY_DSN definido, mas o Sentry não iniciou: {e}')

# CORS: em produção, defina FRONTEND_URL com o endereço do seu site (ex.: https://SEU_USUARIO.github.io)
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
# A SECRET_KEY assina os tokens. Quem tiver essa chave consegue FORJAR tokens
# válidos. Como o código é público no GitHub, uma chave "padrão" no código não
# seria segredo nenhum. Por isso:
#   - Em produção: a variável de ambiente SECRET_KEY é OBRIGATÓRIA. Se faltar, o
#     app se recusa a subir (fail fast) em vez de rodar com uma chave conhecida.
#   - Em desenvolvimento: usa uma chave fixa só para facilitar os testes locais.
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    if EM_PRODUCAO:
        raise RuntimeError(
            'SECRET_KEY não definida em produção. Defina a variável de ambiente '
            'SECRET_KEY com um valor secreto e aleatório antes de subir o app.')
    SECRET_KEY = 'dev-inseguro-troque-em-producao'
    print('⚠️  SECRET_KEY não definida — usando chave de desenvolvimento (só em dev).')
serializer = URLSafeTimedSerializer(SECRET_KEY)
TOKEN_VALIDADE = 7 * 24 * 3600   # token de sessão vale 7 dias
PRE_AUTH_VALIDADE = 600          # token entre senha e 2FA vale 10 minutos
TOTP_ISSUER = 'Calculadora de Custos'   # nome que aparece no app autenticador

# Rotas que NÃO exigem login
CAMINHOS_ABERTOS = {'/api/health', '/api/login', '/api/login/2fa'}

# ---------------------------------------------------------------------------
# Proteção contra força bruta no login: limita tentativas por IP.
# A contagem fica no BANCO (database.py), não na memória, para ser compartilhada
# entre os vários processos do servidor (no PythonAnywhere).
# ---------------------------------------------------------------------------
LOGIN_MAX = 5                          # máximo de falhas...
LOGIN_JANELA = 300                     # ...dentro de 5 minutos (300s)


def _ip_cliente():
    """Descobre o IP do cliente, respeitando o proxy do PythonAnywhere (X-Forwarded-For)."""
    xff = request.headers.get('X-Forwarded-For', '')
    return xff.split(',')[0].strip() if xff else (request.remote_addr or 'desconhecido')


def garantir_admin():
    """Garante que existe um usuário administrador (papel 'admin') com senha.
    A senha vem de ADMIN_SENHA (variável de ambiente).
    Em produção, NUNCA cria uma senha padrão: se ADMIN_SENHA faltar, só avisa."""
    email = os.environ.get('ADMIN_EMAIL', 'admin@calculadora.local')
    senha = os.environ.get('ADMIN_SENHA')
    usuario = db.obter_usuario_por_email(email)
    if senha:
        # A variável de ambiente é a fonte da verdade da senha
        uid = usuario['id'] if usuario else db.criar_usuario(nome='Administrador', email=email)
        db.definir_senha_usuario(uid, generate_password_hash(senha))
        db.definir_papel_usuario(uid, 'admin')   # garante o papel de administrador
    elif EM_PRODUCAO:
        # Em produção, criar senha padrão seria um buraco de segurança (senha
        # conhecida). Melhor não criar nada e avisar para definir ADMIN_SENHA.
        print('⚠️  ADMIN_SENHA não definida em produção. Defina-a para habilitar o login do admin.')
    elif not (usuario and usuario.get('senha_hash')):
        # Só em DESENVOLVIMENTO: cria com senha padrão para facilitar os testes locais
        uid = usuario['id'] if usuario else db.criar_usuario(nome='Administrador', email=email)
        db.definir_senha_usuario(uid, generate_password_hash('admin123'))
        db.definir_papel_usuario(uid, 'admin')
        print(f'⚠️  (dev) Admin criado: e-mail "{email}", senha padrão "admin123".')


garantir_admin()


@app.before_request
def proteger_api():
    """AUTENTICAÇÃO: exige token válido em todas as rotas /api/, exceto as abertas.
    Além de validar, guarda quem é o usuário (uid e papel) em `g`, para as rotas
    poderem checar as permissões depois (AUTORIZAÇÃO)."""
    if request.method == 'OPTIONS':
        return  # deixa o preflight do CORS passar
    caminho = request.path
    if caminho.startswith('/api/') and caminho not in CAMINHOS_ABERTOS:
        auth = request.headers.get('Authorization', '')
        token = auth[7:] if auth.startswith('Bearer ') else None
        if not token:
            return jsonify({'error': 'Não autorizado'}), 401
        try:
            # O token guarda {'uid': ..., 'papel': ...}. Recuperamos e validamos a assinatura.
            dados = serializer.loads(token, max_age=TOKEN_VALIDADE)
        except (BadSignature, SignatureExpired):
            return jsonify({'error': 'Sessão expirada. Faça login novamente.'}), 401
        # Um token de PRÉ-autenticação (etapa entre a senha e o 2FA) NÃO vale como
        # sessão: ele só serve para o endpoint /api/login/2fa. Se aparecer aqui,
        # recusa — senão alguém pularia o segundo fator usando o token do 1º passo.
        if dados.get('stage'):
            return jsonify({'error': 'Autenticação incompleta (2FA pendente).'}), 401
        # Deixa o usuário disponível para o resto da requisição (via flask.g)
        g.usuario_id = dados.get('uid')
        g.papel = dados.get('papel', 'leitura')
        g.permissoes = dados.get('permissoes') or []


def exige_admin(f):
    """AUTORIZAÇÃO: decorator que só deixa passar quem tem papel 'admin'.
    Autenticado (before_request) != autorizado. Um usuário 'leitura' pode ver,
    mas não pode alterar/apagar dados nem baixar o banco inteiro."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if getattr(g, 'papel', 'leitura') != 'admin':
            # Registra a tentativa de acesso indevido (evento de segurança)
            ip, ua = _req_ip_ua()
            db.registrar_log(getattr(g, 'usuario_id', None), 'acesso_negado',
                             f'{request.method} {request.path}', ip, ua)
            return jsonify({'error': 'Acesso negado: requer permissão de administrador'}), 403
        return f(*args, **kwargs)
    return wrapper


def _req_ip_ua():
    """Retorna (ip, user_agent) da requisição atual, para enriquecer os logs."""
    return _ip_cliente(), request.headers.get('User-Agent', '')[:300]


def log_erro(contexto, exc):
    """Registra um erro nos DOIS lugares:
      - log do servidor (app.logger): detalhe técnico, fica no PythonAnywhere;
      - tabela de logs (registrar_log): resumido, aparece no painel do admin."""
    app.logger.error(f'{contexto}: {exc}')
    ip, ua = _req_ip_ua()
    db.registrar_log(getattr(g, 'usuario_id', None), 'erro', f'{contexto}: {exc}', ip, ua)


def _paginacao(limite_padrao=100, limite_max=500):
    """Lê limite/offset da query string e aplica um TETO. Sem esse teto, um cliente
    poderia pedir ?limite=99999999 e forçar o servidor a carregar tudo na memória
    (uma pequena porta para negação de serviço)."""
    limite = request.args.get('limite', limite_padrao, type=int) or limite_padrao
    offset = request.args.get('offset', 0, type=int) or 0
    limite = max(1, min(limite, limite_max))   # entre 1 e o teto
    offset = max(0, offset)                     # nunca negativo
    return limite, offset


# Abas que podem ser liberadas a um usuário comum. A Calculadora é sempre liberada
# (base); Configurações, Logs e Usuários são exclusivas do admin (não entram aqui).
PERMISSOES_VALIDAS = {'history', 'produtos'}

# Categorias válidas de insumo (whitelist). Cada espaço fixo da calculadora puxa
# os tipos da sua categoria. 'embalagem' entra aqui porque agora é só mais um insumo.
CATEGORIAS_INSUMO = {'gelo', 'papelao', 'fita', 'embalagem'}

# ---------------------------------------------------------------------------
# Política de senha. Mínimo de caracteres + bloqueio das senhas mais óbvias.
# A senha em si é guardada só como HASH (scrypt, via werkzeug), nunca em texto.
# ---------------------------------------------------------------------------
SENHA_MIN = 8
SENHAS_FRACAS = {
    '12345678', '123456789', '1234567890', 'password', 'senha123',
    'admin123', 'qwertyui', '00000000', '11111111', 'abcdefgh',
}


def _validar_senha(senha):
    """Valida a força mínima de uma senha. Devolve uma MENSAGEM de erro (string)
    se for fraca, ou None se estiver ok. Centraliza a regra num lugar só, para
    criar e atualizar usuário aplicarem exatamente o mesmo critério."""
    if len(senha) < SENHA_MIN:
        return f'A senha deve ter pelo menos {SENHA_MIN} caracteres'
    if senha.isdigit():
        return 'A senha não pode ser só números'
    if senha.lower() in SENHAS_FRACAS:
        return 'Essa senha é muito comum. Escolha uma mais difícil de adivinhar'
    return None


def _sanitizar_permissoes(valor):
    """Recebe uma lista OU string 'a,b' e devolve só as permissões VÁLIDAS (whitelist).
    Nunca confia no que o cliente manda — ignora qualquer chave desconhecida."""
    if isinstance(valor, str):
        itens = [v.strip() for v in valor.split(',')]
    elif isinstance(valor, (list, tuple)):
        itens = [str(v).strip() for v in valor]
    else:
        itens = []
    return sorted({v for v in itens if v in PERMISSOES_VALIDAS})


def exige_permissao(permissao):
    """AUTORIZAÇÃO granular: deixa passar quem é admin OU tem a permissão pedida.
    Diferente de exige_admin, isto libera abas específicas (ex.: 'produtos') a
    usuários comuns, conforme o que o admin configurou."""
    def decorador(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if getattr(g, 'papel', 'leitura') == 'admin' or permissao in getattr(g, 'permissoes', []):
                return f(*args, **kwargs)
            ip, ua = _req_ip_ua()
            db.registrar_log(getattr(g, 'usuario_id', None), 'acesso_negado',
                             f'{request.method} {request.path} (falta permissão: {permissao})', ip, ua)
            return jsonify({'error': 'Acesso negado'}), 403
        return wrapper
    return decorador


@app.after_request
def cabecalhos_seguranca(resposta):
    """Adiciona cabeçalhos de segurança em TODA resposta da API (defesa em camadas).
    Estes protegem o lado do cliente (item 8 da checklist da Cloudflare)."""
    # Impede o navegador de "adivinhar" o tipo do conteúdo (evita truques com MIME)
    resposta.headers['X-Content-Type-Options'] = 'nosniff'
    # Impede que a API seja embutida em <iframe> de outro site (anti clickjacking)
    resposta.headers['X-Frame-Options'] = 'DENY'
    # Não vaza a URL da API no cabeçalho Referer ao navegar para fora
    resposta.headers['Referrer-Policy'] = 'no-referrer'
    # A API só devolve JSON, então proíbe qualquer recurso ativo por padrão
    resposta.headers['Content-Security-Policy'] = "default-src 'none'"
    # Permissions-Policy: desliga recursos do navegador que a API nunca usa
    # (câmera, microfone, geolocalização, pagamento, USB...). Defesa em profundidade.
    resposta.headers['Permissions-Policy'] = (
        'geolocation=(), camera=(), microphone=(), payment=(), usb=(), '
        'accelerometer=(), gyroscope=(), magnetometer=()')
    return resposta


def _pre_token(usuario):
    """Token curto de PRÉ-autenticação: prova que a senha passou e carrega quem é o
    usuário para o 2º passo emitir a sessão. Marcado com stage='2fa' para NÃO servir
    como token de sessão (o proteger_api recusa qualquer token com 'stage')."""
    return serializer.dumps({
        'stage': '2fa', 'uid': usuario['id'], 'nome': usuario['nome'],
        'papel': usuario.get('papel', 'leitura'),
        'permissoes': _sanitizar_permissoes(usuario.get('permissoes') or ''),
    })


def _token_sessao(dados):
    """Emite o token de sessão final a partir dos dados guardados no pré-token."""
    return serializer.dumps({'uid': dados['uid'], 'papel': dados.get('papel', 'leitura'),
                             'permissoes': dados.get('permissoes') or []})


def _gerar_backup_codes(qtd=10):
    """Gera códigos de backup legíveis (ex.: 'a3f9-2k7m'). Sem 0/1/o/l/i para não
    confundir na hora de digitar. São mostrados UMA vez; guardamos só o hash."""
    alfabeto = '23456789abcdefghjkmnpqrstuvwxyz'
    codigos = []
    for _ in range(qtd):
        bloco = ''.join(secrets.choice(alfabeto) for _ in range(8))
        codigos.append(f'{bloco[:4]}-{bloco[4:]}')
    return codigos


def _normalizar_codigo(c):
    """Tira espaços/hífens e baixa a caixa, para comparar código de backup sem
    depender de o usuário digitar o hífen ou maiúsculas."""
    return re.sub(r'[\s-]', '', str(c or '')).lower()


@app.route('/api/login', methods=['POST'])
def login():
    """1º passo do login: valida e-mail + senha. Se a senha estiver certa, NÃO entrega
    a sessão ainda — devolve um token de pré-autenticação e exige o 2FA (obrigatório
    para todos). O token de sessão só sai depois, no /api/login/2fa."""
    try:
        ip, ua = _req_ip_ua()
        # Checa o limite consultando o banco (compartilhado entre os processos)
        if db.contar_tentativas_login(ip, LOGIN_JANELA) >= LOGIN_MAX:
            db.registrar_log(None, 'login_bloqueado', 'Limite de tentativas atingido', ip, ua)
            return jsonify({'error': 'Muitas tentativas. Tente novamente em alguns minutos.'}), 429

        data = request.get_json() or {}
        email = (data.get('email') or '').strip()
        senha = data.get('senha') or ''
        usuario = db.obter_usuario_por_email(email)
        if not usuario or not usuario.get('senha_hash') \
                or not check_password_hash(usuario['senha_hash'], senha):
            db.registrar_tentativa_login(ip)     # registra a falha no banco (rate limit)
            db.registrar_log(None, 'login_falha', f'Tentativa com e-mail: {email}', ip, ua)
            return jsonify({'error': 'E-mail ou senha inválidos'}), 401

        db.limpar_tentativas_login(ip)           # senha correta: zera o contador do IP
        uid = usuario['id']
        confirmado = bool(usuario.get('totp_confirmado'))
        secret = usuario.get('totp_secret')

        if not confirmado:
            # Ainda não configurou o 2FA: gera/guarda o segredo e manda os dados
            # para o app autenticador montar o QR (setup no primeiro login).
            if not secret:
                secret = pyotp.random_base32()
                db.definir_totp_secret(uid, secret)
            otpauth = pyotp.TOTP(secret).provisioning_uri(
                name=usuario.get('email') or f'user{uid}', issuer_name=TOTP_ISSUER)
            return jsonify({'success': True, 'needs_2fa_setup': True,
                            'pre_token': _pre_token(usuario), 'secret': secret,
                            'otpauth_uri': otpauth})
        # Já tem 2FA: pede só o código do app.
        return jsonify({'success': True, 'needs_2fa': True, 'pre_token': _pre_token(usuario)})
    except Exception as e:
        log_erro('Erro no login', e)
        return jsonify({'error': 'Erro no login'}), 500


@app.route('/api/login/2fa', methods=['POST'])
def login_2fa():
    """2º passo do login: valida o código do app (TOTP) OU um código de backup e, se
    ok, entrega o token de sessão. No 1º uso (setup), confirma o 2FA e devolve os
    códigos de backup (mostrados UMA vez só)."""
    try:
        ip, ua = _req_ip_ua()
        # O código TOTP tem 6 dígitos: também limitamos a força bruta aqui.
        if db.contar_tentativas_login(ip, LOGIN_JANELA) >= LOGIN_MAX:
            db.registrar_log(None, 'login_bloqueado', '2FA: limite de tentativas', ip, ua)
            return jsonify({'error': 'Muitas tentativas. Tente novamente em alguns minutos.'}), 429

        data = request.get_json() or {}
        try:
            dados = serializer.loads(data.get('pre_token') or '', max_age=PRE_AUTH_VALIDADE)
        except (BadSignature, SignatureExpired):
            return jsonify({'error': 'Sessão de login expirada. Faça login de novo.'}), 401
        if dados.get('stage') != '2fa':
            return jsonify({'error': 'Token inválido'}), 401

        uid = dados['uid']
        info = db.obter_totp(uid)
        if not info or not info.get('totp_secret'):
            return jsonify({'error': '2FA não configurado. Faça login de novo.'}), 400
        secret = info['totp_secret']
        confirmado = bool(info['totp_confirmado'])

        codigo = re.sub(r'\s', '', str(data.get('codigo') or ''))
        # valid_window=1 tolera 1 passo de 30s para frente/trás (relógio dessincronizado)
        ok = pyotp.TOTP(secret).verify(codigo, valid_window=1)
        usou_backup = False
        if not ok and confirmado:
            # Códigos de backup só valem depois do 2FA já confirmado.
            alvo = _normalizar_codigo(codigo)
            for code_id, code_hash in db.listar_hashes_backup_nao_usados(uid):
                if check_password_hash(code_hash, alvo):
                    db.marcar_backup_code_usado(code_id)
                    ok = True
                    usou_backup = True
                    break
        if not ok:
            db.registrar_tentativa_login(ip)
            db.registrar_log(uid, 'login_2fa_falha', 'Código 2FA inválido', ip, ua)
            return jsonify({'error': 'Código inválido'}), 401

        db.limpar_tentativas_login(ip)
        resposta = {'success': True, 'token': _token_sessao(dados), 'nome': dados.get('nome'),
                    'papel': dados.get('papel', 'leitura'), 'permissoes': dados.get('permissoes') or []}
        if not confirmado:
            # Primeiro login: confirma o 2FA e gera os códigos de backup (uso único).
            db.confirmar_totp(uid)
            codigos = _gerar_backup_codes()
            db.salvar_backup_codes(uid, [generate_password_hash(_normalizar_codigo(c)) for c in codigos])
            resposta['backup_codes'] = codigos
        db.registrar_log(uid, 'login', 'Login com 2FA' + (' (código de backup)' if usou_backup else ''), ip, ua)
        return jsonify(resposta)
    except Exception as e:
        log_erro('Erro no 2FA', e)
        return jsonify({'error': 'Erro ao validar 2FA'}), 500


@app.route('/api/logs', methods=['GET'])
@exige_admin
def listar_logs():
    """Lista as ocorrências (só admin). Aceita ?limite, ?offset, ?acao, ?de, ?ate."""
    try:
        limite, offset = _paginacao(200)
        acao = request.args.get('acao') or None
        de = request.args.get('de') or None
        ate = request.args.get('ate') or None
        return jsonify({'success': True,
                        'logs': db.listar_logs(limite, offset, acao, de, ate)})
    except Exception as e:
        log_erro('Erro ao listar logs', e)
        return jsonify({'error': 'Erro ao listar logs'}), 500

@app.route('/api/logs/antigos', methods=['DELETE'])
@exige_admin
def limpar_logs_antigos():
    """Apaga logs com mais de ?dias dias (retenção). Padrão 90. Só admin."""
    try:
        dias = request.args.get('dias', 90, type=int)
        dias = max(1, dias)   # nunca apagar "tudo" por engano com dias<=0
        apagados = db.limpar_logs_antigos(dias)
        ip, ua = _req_ip_ua()
        db.registrar_log(g.usuario_id, 'logs_limpos',
                         f'{apagados} log(s) com mais de {dias} dias apagados', ip, ua)
        return jsonify({'success': True, 'apagados': apagados})
    except Exception as e:
        log_erro('Erro ao limpar logs antigos', e)
        return jsonify({'error': 'Erro ao limpar logs antigos'}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Verificar status da API"""
    return jsonify({
        'status': 'ok',
        'message': 'API funcionando',
        'timestamp': datetime.now().isoformat(),
        'version': db.obter_configuracao('versao_sistema')
    })

@app.route('/api/usuarios', methods=['GET'])
@exige_admin
def listar_usuarios():
    """Lista os usuários (só admin). Não devolve a senha, só se o usuário TEM uma."""
    try:
        return jsonify({'success': True, 'usuarios': db.listar_usuarios()})
    except Exception as e:
        log_erro('Erro ao listar usuários', e)
        return jsonify({'error': 'Erro ao listar usuários'}), 500

@app.route('/api/usuarios', methods=['POST'])
@exige_admin
def criar_usuario():
    """Criar novo usuário. Aceita senha (opcional) e papel ('admin'/'leitura').
    Sem senha, o usuário existe mas NÃO consegue logar — por isso, para dar acesso
    a alguém, informe a senha aqui."""
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Corpo da requisição deve ser um JSON válido'}), 400

        # Validações básicas
        if not data.get('nome'):
            return jsonify({'error': 'Nome é obrigatório'}), 400

        # Papel: só aceita valores conhecidos (nunca confia em texto livre do cliente)
        papel = data.get('papel', 'leitura')
        if papel not in ('admin', 'leitura'):
            return jsonify({'error': "Papel deve ser 'admin' ou 'leitura'"}), 400

        senha = data.get('senha') or ''
        if senha:
            erro_senha = _validar_senha(senha)
            if erro_senha:
                return jsonify({'error': erro_senha}), 400

        # Permissões (abas) só valem para usuário comum; admin já tem tudo
        permissoes = _sanitizar_permissoes(data.get('permissoes'))

        usuario_id = db.criar_usuario(
            nome=data['nome'],
            email=data.get('email'),
            empresa=data.get('empresa'),
            telefone=data.get('telefone')
        )
        db.definir_papel_usuario(usuario_id, papel)
        db.definir_permissoes_usuario(usuario_id, ','.join(permissoes))
        if senha:
            # Guarda só o HASH da senha, nunca o texto puro
            db.definir_senha_usuario(usuario_id, generate_password_hash(senha))

        ip, ua = _req_ip_ua()
        db.registrar_log(g.usuario_id, 'usuario_criado',
                         f"{data['nome']} (papel: {papel}, abas: {','.join(permissoes) or '-'})", ip, ua)
        return jsonify({
            'success': True,
            'message': 'Usuário criado com sucesso',
            'usuario_id': usuario_id
        }), 201

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log_erro('Erro ao criar usuário', e)
        return jsonify({'error': 'Erro interno'}), 500

@app.route('/api/usuarios/<int:usuario_id>', methods=['PUT'])
@exige_admin
def atualizar_usuario(usuario_id):
    """Edita papel, permissões (abas) e, opcionalmente, a senha de um usuário."""
    try:
        data = request.get_json(silent=True) or {}
        papel = data.get('papel')
        if papel is not None and papel not in ('admin', 'leitura'):
            return jsonify({'error': "Papel deve ser 'admin' ou 'leitura'"}), 400

        # Trava anti-lockout: o admin não pode remover o próprio acesso de admin
        # (senão ficaria trancado para fora da administração).
        if usuario_id == g.usuario_id and papel == 'leitura':
            return jsonify({'error': 'Você não pode remover o seu próprio acesso de administrador'}), 400

        if papel is not None:
            db.definir_papel_usuario(usuario_id, papel)
        if 'permissoes' in data:
            db.definir_permissoes_usuario(usuario_id, ','.join(_sanitizar_permissoes(data['permissoes'])))
        if data.get('senha'):
            erro_senha = _validar_senha(data['senha'])
            if erro_senha:
                return jsonify({'error': erro_senha}), 400
            db.definir_senha_usuario(usuario_id, generate_password_hash(data['senha']))

        ip, ua = _req_ip_ua()
        db.registrar_log(g.usuario_id, 'usuario_editado', f'usuário {usuario_id} atualizado', ip, ua)
        return jsonify({'success': True})
    except Exception as e:
        log_erro('Erro ao atualizar usuário', e)
        return jsonify({'error': 'Erro ao atualizar usuário'}), 500

@app.route('/api/calculos', methods=['POST'])
def salvar_calculo():
    """Salvar novo cálculo"""
    try:
        # silent=True: se o corpo não for JSON válido, retorna None em vez de estourar
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Corpo da requisição deve ser um JSON válido'}), 400

        # Validações (usuario_id NÃO entra aqui: o dono vem do token, não do cliente)
        campos_obrigatorios = ['produto', 'categoria', 'preco',
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
        
        # Embalagem opcional: valor vem do banco (confiavel), quantidade do cliente.
        preco_embalagem, qtd_embalagem = _dados_embalagem(data)

        # Calcular resultados (usando a fonte unica: calculos.py)
        resultados = calcular_resultados(
            preco=dados_calculo['preco'],
            peso_inicial=dados_calculo['peso_inicial'],
            peso_final=dados_calculo['peso_final'],
            sacos_de_gelo=dados_calculo['sacos_de_gelo'],
            caixa_papelao=dados_calculo['caixa_papelao'],
            preco_gelo=_preco_insumo(data.get('gelo_insumo_id'), 'gelo', 'preco_gelo'),
            preco_papelao=_preco_insumo(data.get('papelao_insumo_id'), 'papelao', 'preco_papelao'),
            preco_fita=_preco_insumo(data.get('fita_insumo_id'), 'fita', 'preco_fita'),
            preco_venda=float(data['preco_venda']) if data.get('preco_venda') else None,
            preco_embalagem=preco_embalagem, qtd_embalagem=qtd_embalagem,
        )

        # Salvar no banco — o DONO do cálculo vem do TOKEN (g.usuario_id), nunca do
        # corpo enviado pelo cliente. Assim ninguém salva cálculo no nome de outro.
        calculo_id = db.salvar_calculo(
            usuario_id=g.usuario_id,
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
        log_erro('Erro ao salvar cálculo', e)
        return jsonify({'error': 'Erro ao salvar cálculo'}), 500

@app.route('/api/calculos/meus', methods=['GET'])
def obter_meus_calculos():
    """Cálculos do usuário LOGADO. A identidade vem do token (g.usuario_id), não da
    URL — por isso não dá para ver o histórico de outra pessoa por aqui."""
    try:
        limite, offset = _paginacao(100)
        calculos = db.obter_calculos_usuario(g.usuario_id, limite, offset)
        return jsonify({'success': True, 'calculos': calculos, 'total': len(calculos)})
    except Exception as e:
        log_erro('Erro ao obter meus cálculos', e)
        return jsonify({'error': 'Erro ao obter cálculos'}), 500

@app.route('/api/calculos/meus', methods=['DELETE'])
def limpar_meus_calculos():
    """Apaga TODOS os cálculos do usuário logado (usado pelo 'Limpar histórico').
    Só apaga os DELE — a identidade vem do token, não do cliente."""
    try:
        apagados = db.remover_calculos_usuario(g.usuario_id)
        ip, ua = _req_ip_ua()
        db.registrar_log(g.usuario_id, 'historico_limpo', f'{apagados} cálculo(s) apagado(s)', ip, ua)
        return jsonify({'success': True, 'apagados': apagados})
    except Exception as e:
        log_erro('Erro ao limpar histórico', e)
        return jsonify({'error': 'Erro ao limpar histórico'}), 500

@app.route('/api/calculos/usuario/<int:usuario_id>', methods=['GET'])
def obter_calculos_usuario(usuario_id):
    """Obter cálculos de um usuário específico (por id).
    AUTORIZAÇÃO: só o próprio dono ou um admin. Sem isso, qualquer um trocaria o
    número na URL e leria o histórico dos outros (falha conhecida como IDOR)."""
    try:
        if usuario_id != g.usuario_id and getattr(g, 'papel', 'leitura') != 'admin':
            ip, ua = _req_ip_ua()
            db.registrar_log(g.usuario_id, 'acesso_negado',
                             f'GET /api/calculos/usuario/{usuario_id}', ip, ua)
            return jsonify({'error': 'Acesso negado'}), 403
        limite, offset = _paginacao(50)
        
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
@exige_admin
def obter_todos_calculos():
    """Obter todos os cálculos do sistema (de todos os usuários -> só admin)."""
    try:
        limite, offset = _paginacao(100)
        
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
@exige_admin
def obter_estatisticas():
    """Obter estatísticas gerais do sistema (agrega dados de todos -> só admin)."""
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
@exige_permissao('produtos')
def atualizar_configuracoes():
    """Atualizar os preços dos insumos (só as chaves conhecidas, validadas).
    Liberado a admin OU a quem tem a permissão 'produtos' (a mesma que gerencia
    produtos/embalagens). Continua sendo uma mudança GLOBAL e AUDITADA (log
    'config_alterada'): afeta o custo de todos os cálculos futuros."""
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
            # Guarda o valor ANTIGO antes de sobrescrever, para registrar a mudança
            antigo = db.obter_configuracao(chave)
            db.atualizar_configuracao(chave, str(v))
            atualizadas += 1
            # Auditoria: mudar preço de insumo afeta TODOS os cálculos futuros,
            # então registramos quem mudou e de/para (aparece no painel de Logs).
            if str(antigo) != str(v):
                ip, ua = _req_ip_ua()
                db.registrar_log(getattr(g, 'usuario_id', None), 'config_alterada',
                                 f'{chave}: {antigo} -> {v}', ip, ua)

        return jsonify({
            'success': True,
            'message': f'{atualizadas} configuração(ões) atualizada(s)'
        })

    except Exception as e:
        log_erro('Erro ao atualizar configurações', e)
        return jsonify({'error': 'Erro ao atualizar configurações'}), 500

@app.route('/api/produtos', methods=['GET'])
def listar_produtos():
    """Lista todos os produtos (perfil completo)."""
    try:
        return jsonify({'success': True, 'produtos': db.listar_produtos()})
    except Exception as e:
        app.logger.error(f'Erro ao listar produtos: {e}')
        return jsonify({'error': 'Erro ao listar produtos'}), 500

# ---------------------------------------------------------------------------
# Insumos (catálogo unificado: gelo, papelão, fita, embalagem, ...).
# Ler: qualquer usuário logado (a calculadora precisa dos tipos para os selects).
# Criar/editar/apagar: quem tem a permissão 'produtos'.
# ---------------------------------------------------------------------------
@app.route('/api/insumos', methods=['GET'])
def listar_insumos():
    """Lista os insumos. Aceita ?categoria=gelo|papelao|fita|embalagem para filtrar."""
    try:
        categoria = request.args.get('categoria') or None
        if categoria and categoria not in CATEGORIAS_INSUMO:
            return jsonify({'error': 'Categoria inválida'}), 400
        return jsonify({'success': True, 'insumos': db.listar_insumos(categoria)})
    except Exception as e:
        log_erro('Erro ao listar insumos', e)
        return jsonify({'error': 'Erro ao listar insumos'}), 500

@app.route('/api/insumos', methods=['POST'])
@exige_permissao('produtos')
def criar_insumo():
    try:
        data = request.get_json(silent=True) or {}
        nome = (data.get('nome') or '').strip()
        if not nome:
            return jsonify({'error': 'Nome do insumo é obrigatório'}), 400
        categoria = data.get('categoria')
        if categoria not in CATEGORIAS_INSUMO:
            return jsonify({'error': 'Categoria inválida'}), 400
        valor = float(data.get('valor') or 0)
        if valor < 0:
            return jsonify({'error': 'O valor não pode ser negativo'}), 400
        insumo_id = db.criar_insumo(nome, valor, categoria)
        return jsonify({'success': True, 'insumo_id': insumo_id}), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log_erro('Erro ao criar insumo', e)
        return jsonify({'error': 'Erro ao criar insumo'}), 500

@app.route('/api/insumos/<int:insumo_id>', methods=['PUT'])
@exige_permissao('produtos')
def atualizar_insumo(insumo_id):
    try:
        data = request.get_json(silent=True) or {}
        nome = (data.get('nome') or '').strip()
        if not nome:
            return jsonify({'error': 'Nome do insumo é obrigatório'}), 400
        valor = float(data.get('valor') or 0)
        if valor < 0:
            return jsonify({'error': 'O valor não pode ser negativo'}), 400
        db.atualizar_insumo(insumo_id, nome, valor)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log_erro('Erro ao atualizar insumo', e)
        return jsonify({'error': 'Erro ao atualizar insumo'}), 500

@app.route('/api/insumos/<int:insumo_id>', methods=['DELETE'])
@exige_permissao('produtos')
def remover_insumo(insumo_id):
    try:
        db.remover_insumo(insumo_id)
        return jsonify({'success': True})
    except Exception as e:
        log_erro('Erro ao remover insumo', e)
        return jsonify({'error': 'Erro ao remover insumo'}), 500

# ---------------------------------------------------------------------------
# Tipos de embalagem (nome + valor). Ler: qualquer usuário logado (para o select
# do perfil). Criar/editar/apagar: quem tem a permissão 'produtos'.
# ---------------------------------------------------------------------------
@app.route('/api/embalagens', methods=['GET'])
def listar_embalagens():
    try:
        return jsonify({'success': True, 'embalagens': db.listar_embalagens()})
    except Exception as e:
        log_erro('Erro ao listar embalagens', e)
        return jsonify({'error': 'Erro ao listar embalagens'}), 500

@app.route('/api/embalagens', methods=['POST'])
@exige_permissao('produtos')
def criar_embalagem():
    try:
        data = request.get_json(silent=True) or {}
        nome = (data.get('nome') or '').strip()
        if not nome:
            return jsonify({'error': 'Nome da embalagem é obrigatório'}), 400
        valor = float(data.get('valor') or 0)
        if valor < 0:
            return jsonify({'error': 'O valor não pode ser negativo'}), 400
        eid = db.criar_embalagem(nome, valor)
        return jsonify({'success': True, 'embalagem_id': eid}), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log_erro('Erro ao criar embalagem', e)
        return jsonify({'error': 'Erro ao criar embalagem'}), 500

@app.route('/api/embalagens/<int:embalagem_id>', methods=['PUT'])
@exige_permissao('produtos')
def atualizar_embalagem(embalagem_id):
    try:
        data = request.get_json(silent=True) or {}
        nome = (data.get('nome') or '').strip()
        if not nome:
            return jsonify({'error': 'Nome da embalagem é obrigatório'}), 400
        valor = float(data.get('valor') or 0)
        if valor < 0:
            return jsonify({'error': 'O valor não pode ser negativo'}), 400
        db.atualizar_embalagem(embalagem_id, nome, valor)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log_erro('Erro ao atualizar embalagem', e)
        return jsonify({'error': 'Erro ao atualizar embalagem'}), 500

@app.route('/api/embalagens/<int:embalagem_id>', methods=['DELETE'])
@exige_permissao('produtos')
def remover_embalagem(embalagem_id):
    try:
        db.remover_embalagem(embalagem_id)
        return jsonify({'success': True})
    except Exception as e:
        log_erro('Erro ao remover embalagem', e)
        return jsonify({'error': 'Erro ao remover embalagem'}), 500

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

# ---------------------------------------------------------------------------
# Lotes (partidas) de um produto. Ler: qualquer logado. Criar/editar/apagar:
# quem tem a permissão 'produtos'. Cada evento de lote entra no histórico do produto.
# ---------------------------------------------------------------------------
@app.route('/api/produtos/<int:produto_id>/lotes', methods=['GET'])
def listar_lotes(produto_id):
    try:
        return jsonify({'success': True, 'lotes': db.listar_lotes(produto_id)})
    except Exception as e:
        log_erro('Erro ao listar lotes', e)
        return jsonify({'error': 'Erro ao listar lotes'}), 500

@app.route('/api/produtos/<int:produto_id>/lotes', methods=['POST'])
@exige_permissao('produtos')
def criar_lote(produto_id):
    try:
        data = request.get_json(silent=True) or {}
        codigo = (data.get('codigo') or '').strip() or None
        fabricacao = data.get('fabricacao') or None
        validade = data.get('validade') or None
        quantidade = float(data['quantidade']) if data.get('quantidade') not in (None, '') else None
        if not (codigo or validade or fabricacao):
            return jsonify({'error': 'Informe ao menos código, validade ou fabricação'}), 400
        lote_id = db.criar_lote(produto_id, codigo, fabricacao, validade, quantidade)
        db.adicionar_historico_produto(produto_id, 'lote', None,
                                       f'{codigo or "lote"} (val: {validade or "—"})')
        return jsonify({'success': True, 'lote_id': lote_id}), 201
    except (TypeError, ValueError):
        return jsonify({'error': 'Quantidade deve ser um número'}), 400
    except Exception as e:
        log_erro('Erro ao criar lote', e)
        return jsonify({'error': 'Erro ao criar lote'}), 500

@app.route('/api/lotes/<int:lote_id>', methods=['PUT'])
@exige_permissao('produtos')
def atualizar_lote(lote_id):
    try:
        data = request.get_json(silent=True) or {}
        codigo = (data.get('codigo') or '').strip() or None
        fabricacao = data.get('fabricacao') or None
        validade = data.get('validade') or None
        quantidade = float(data['quantidade']) if data.get('quantidade') not in (None, '') else None
        db.atualizar_lote(lote_id, codigo, fabricacao, validade, quantidade)
        return jsonify({'success': True})
    except (TypeError, ValueError):
        return jsonify({'error': 'Quantidade deve ser um número'}), 400
    except Exception as e:
        log_erro('Erro ao atualizar lote', e)
        return jsonify({'error': 'Erro ao atualizar lote'}), 500

@app.route('/api/lotes/<int:lote_id>', methods=['DELETE'])
@exige_permissao('produtos')
def remover_lote(lote_id):
    try:
        lote = db.obter_lote(lote_id)
        db.remover_lote(lote_id)
        if lote:
            db.adicionar_historico_produto(lote['produto_id'], 'lote',
                                           f'{lote.get("codigo") or "lote"} (val: {lote.get("validade") or "—"})', 'removido')
        return jsonify({'success': True})
    except Exception as e:
        log_erro('Erro ao remover lote', e)
        return jsonify({'error': 'Erro ao remover lote'}), 500

@app.route('/api/produtos', methods=['POST'])
@exige_permissao('produtos')
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
            quantidade=data.get('quantidade'),
            unidade=data.get('unidade') or None,
            peso_unitario=data.get('peso_unitario'),
        )
        return jsonify({'success': True, 'produto_id': produto_id}), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log_erro('Erro ao criar produto', e)
        return jsonify({'error': 'Erro ao criar produto'}), 500

@app.route('/api/produtos/<int:produto_id>', methods=['PUT'])
@exige_permissao('produtos')
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
        for chave in ('validade', 'fornecedor', 'categoria', 'lote', 'fabricacao', 'observacoes',
                      'quantidade', 'unidade', 'peso_unitario'):
            if chave in data:
                campos[chave] = data.get(chave)
        if 'embalagem_id' in data:
            eid = data.get('embalagem_id')
            # vazio/0 => None (nenhuma embalagem); senão, o id como inteiro
            campos['embalagem_id'] = int(eid) if eid not in (None, '', 0, '0') else None
        db.atualizar_produto(produto_id, **campos)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log_erro('Erro ao atualizar produto', e)
        return jsonify({'error': 'Erro ao atualizar produto'}), 500

@app.route('/api/produtos/<int:produto_id>', methods=['DELETE'])
@exige_permissao('produtos')
def remover_produto(produto_id):
    """Remove um produto e seu histórico."""
    try:
        db.remover_produto(produto_id)
        return jsonify({'success': True})
    except Exception as e:
        log_erro('Erro ao remover produto', e)
        return jsonify({'error': 'Erro ao remover produto'}), 500

@app.route('/api/backup', methods=['POST'])
@exige_admin
def fazer_backup():
    """Cria uma cópia do banco no servidor (pasta backups/)."""
    try:
        destino = db.criar_backup()
        return jsonify({'success': True, 'arquivo': os.path.basename(destino)}), 201
    except Exception as e:
        app.logger.error(f'Erro ao criar backup: {e}')
        return jsonify({'error': 'Erro ao criar backup'}), 500

@app.route('/api/backup/download', methods=['GET'])
@exige_admin
def baixar_backup():
    """Envia o arquivo do banco para download (o backup que você guarda no seu PC)."""
    try:
        db.forcar_checkpoint()   # garante que o .db baixado tenha as ultimas transacoes (modo WAL)
        nome = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        return send_file(db.db_path, as_attachment=True, download_name=nome)
    except Exception as e:
        app.logger.error(f'Erro ao baixar backup: {e}')
        return jsonify({'error': 'Erro ao baixar backup'}), 500

@app.route('/api/exportar', methods=['GET'])
@exige_admin
def exportar_dados():
    """Exportar dados do sistema (inclui a tabela de usuários com e-mail/telefone:
    dado pessoal, por isso restrito a admin)."""
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

def _preco_insumo(insumo_id, categoria, chave_padrao):
    """Resolve o PREÇO de um espaço fixo da calculadora (gelo/papelão/fita).
    Se o cliente enviou um insumo_id válido DAQUELA categoria, usa o valor do
    catálogo (fonte confiável, no banco — o cliente nunca manda o preço). Se não
    enviou (ex.: cliente antigo, antes desta mudança), cai no preço padrão que
    ainda vive em 'configuracoes'. Assim a transição não quebra nada."""
    if insumo_id:
        ins = db.obter_insumo(int(insumo_id))
        if ins and ins.get('categoria') == categoria:
            return float(ins['valor'])
    return float(db.obter_configuracao(chave_padrao))


def _dados_embalagem(data):
    """Le embalagem_id e embalagem_qtd do corpo (ambos opcionais) e devolve
    (preco_embalagem, qtd_embalagem) para o calculo. O VALOR vem do BANCO
    (nao do cliente), igual aos outros insumos, para o usuario nao poder forjar
    o preco. Se nao houver embalagem valida ou a quantidade for <= 0, devolve (0, 0)."""
    embalagem_id = data.get('embalagem_id')
    try:
        qtd = int(data.get('embalagem_qtd') or 0)
    except (TypeError, ValueError):
        qtd = 0
    if not embalagem_id or qtd <= 0:
        return 0.0, 0
    # Embalagem agora é um insumo da categoria 'embalagem' (catálogo unificado).
    emb = db.obter_insumo(int(embalagem_id))
    if emb and emb.get('categoria') != 'embalagem':
        emb = None
    if not emb:
        return 0.0, 0
    return float(emb['valor']), qtd


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
        
        # Embalagem opcional: valor vem do banco (confiavel), quantidade do cliente.
        preco_embalagem, qtd_embalagem = _dados_embalagem(data)

        # Calcular resultados (fonte unica: calculos.py).
        # Validacoes de peso/preco vivem dentro de calcular_resultados (levanta ValueError).
        resultados = calcular_resultados(
            preco=dados['preco'],
            peso_inicial=dados['peso_inicial'],
            peso_final=dados['peso_final'],
            sacos_de_gelo=dados['sacos_de_gelo'],
            caixa_papelao=dados['caixa_papelao'],
            preco_gelo=_preco_insumo(data.get('gelo_insumo_id'), 'gelo', 'preco_gelo'),
            preco_papelao=_preco_insumo(data.get('papelao_insumo_id'), 'papelao', 'preco_papelao'),
            preco_fita=_preco_insumo(data.get('fita_insumo_id'), 'fita', 'preco_fita'),
            preco_venda=float(data['preco_venda']) if data.get('preco_venda') else None,
            preco_embalagem=preco_embalagem, qtd_embalagem=qtd_embalagem,
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
    # Em produção o app roda pelo servidor WSGI do PythonAnywhere, então este bloco nem executa.
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
