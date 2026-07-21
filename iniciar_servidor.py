#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🐟 Calculadora de Custos - Beneficiamento de Pescados
Servidor de desenvolvimento local
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import time
import subprocess
import threading
from pathlib import Path

def print_banner():
    """Exibe o banner inicial do programa"""
    banner = """
===============================================================================
                    CALCULADORA DE CUSTOS - BENEFICIAMENTO DE PESCADOS
===============================================================================

  Uma aplicacao web moderna para calcular custos de beneficiamento
  de produtos pesqueiros com interface responsiva e funcionalidades
  avancadas como historico de calculos e exportacao de dados.

  Caracteristicas:
     • Interface moderna e responsiva
     • Calculo automatico de custos
     • Sistema de historico com armazenamento local
     • Exportacao de resultados em PDF
     • Validacoes inteligentes em tempo real
     • Suporte a 11 tipos de produtos pesqueiros

  Funcionalidades:
     • Calculadora principal com validacoes
     • Historico de calculos anteriores
     • Duplicacao de calculos
     • Exportacao de dados em PDF
     • Interface otimizada para mobile e desktop

===============================================================================
"""
    print(banner)

def check_files():
    """Verifica se os arquivos necessários existem"""
    web_dir = Path("web")
    required_files = ["index.html", "style.css", "script.js"]
    
    if not web_dir.exists():
        print("❌ Erro: Diretório 'web' não encontrado!")
        return False
    
    missing_files = []
    for file in required_files:
        if not (web_dir / file).exists():
            missing_files.append(file)
    
    if missing_files:
        print(f"❌ Erro: Arquivos não encontrados: {', '.join(missing_files)}")
        return False
    
    return True

def check_dependencies():
    """Verifica se as dependências Python estão instaladas"""
    try:
        import flask
        import flask_cors
        print("✅ Dependências Python encontradas")
        return True
    except ImportError as e:
        print(f"⚠️  Dependência não encontrada: {e}")
        print("💡 Instalando dependências automaticamente...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
            print("✅ Dependências instaladas com sucesso!")
            return True
        except subprocess.CalledProcessError:
            print("❌ Erro ao instalar dependências")
            print("💡 Execute manualmente: pip install -r requirements.txt")
            return False

def start_api_server():
    """Inicia o servidor da API Flask em uma thread separada"""
    try:
        print("🚀 Iniciando API REST...")
        subprocess.run([sys.executable, "api.py"], check=False)
    except Exception as e:
        print(f"❌ Erro ao iniciar API: {e}")

def init_database():
    """Inicializa o banco de dados"""
    try:
        print("🗄️  Inicializando banco de dados...")
        subprocess.check_call([sys.executable, "database.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("✅ Banco de dados inicializado")
        return True
    except subprocess.CalledProcessError:
        print("❌ Erro ao inicializar banco de dados")
        return False

def start_server(port=8000):
    """Inicia o servidor HTTP local com banco de dados"""
    web_dir = Path("web")
    
    # Verificar e inicializar banco de dados
    if not init_database():
        print("⚠️  Continuando sem banco de dados (modo offline)")
    
    # Iniciar API em thread separada
    api_thread = threading.Thread(target=start_api_server, daemon=True)
    api_thread.start()
    
    # Aguardar um pouco para a API inicializar
    time.sleep(2)
    
    # Mudar para o diretório web
    original_dir = os.getcwd()
    os.chdir(web_dir)
    
    try:
        # Configurar o servidor
        handler = http.server.SimpleHTTPRequestHandler
        
        # Tentar usar IPv4 e IPv6
        with socketserver.TCPServer(("", port), handler) as httpd:
            print(f"\n🚀 Servidor iniciado com sucesso!")
            print(f"📂 Servindo arquivos do diretório: {web_dir.absolute()}")
            print(f"🌐 Porta: {port}")
            print(f"🗄️  Banco de dados: SQLite (calculos_beneficiamento.db)")
            print(f"🔗 API REST: http://localhost:5000")
            
            # URLs para acessar
            print(f"\n📱 Acesse o site através de:")
            print(f"   🔗 http://localhost:{port}")
            print(f"   🔗 http://127.0.0.1:{port}")
            
            # Tentar abrir automaticamente no navegador
            print(f"\n🌐 Abrindo o site no navegador padrão...")
            try:
                webbrowser.open(f"http://localhost:{port}")
                print("✅ Site aberto no navegador!")
            except Exception as e:
                print(f"⚠️  Não foi possível abrir automaticamente: {e}")
                print("   Acesse manualmente o link acima.")
            
            print(f"\n📋 Instruções:")
            print(f"   • Preencha o formulário com os dados da produção")
            print(f"   • Clique em 'Calcular Custos' para ver os resultados")
            print(f"   • Acesse a aba 'Histórico' para ver cálculos anteriores")
            print(f"   • Dados são salvos automaticamente no banco SQLite")
            print(f"   • Use Ctrl+C para parar o servidor")
            
            print(f"\n{'='*80}")
            print(f"🔄 Servidor rodando... Pressione Ctrl+C para parar")
            print(f"{'='*80}\n")
            
            # Iniciar o servidor
            httpd.serve_forever()
            
    except OSError as e:
        if e.errno == 98:  # Address already in use
            print(f"❌ Erro: A porta {port} já está em uso!")
            print(f"💡 Soluções:")
            print(f"   • Feche outros servidores na porta {port}")
            print(f"   • Execute: python iniciar_servidor.py --port 8080")
            print(f"   • Aguarde alguns segundos e tente novamente")
        else:
            print(f"❌ Erro ao iniciar o servidor: {e}")
        return False
    
    except KeyboardInterrupt:
        print(f"\n\n🛑 Servidor interrompido pelo usuário.")
        print(f"👋 Obrigado por usar a Calculadora de Custos!")
        return True
    
    finally:
        # Voltar ao diretório original
        os.chdir(original_dir)

def main():
    """Função principal"""
    print_banner()
    
    # Verificar argumentos da linha de comando
    port = 8000
    if len(sys.argv) > 1:
        if "--port" in sys.argv:
            try:
                port_index = sys.argv.index("--port") + 1
                port = int(sys.argv[port_index])
            except (ValueError, IndexError):
                print("❌ Erro: Porta inválida. Use: python iniciar_servidor.py --port 8000")
                return
        elif "--help" in sys.argv or "-h" in sys.argv:
            print("\n📖 Uso:")
            print("   python iniciar_servidor.py [opções]")
            print("\n🔧 Opções:")
            print("   --port <número>    Define a porta (padrão: 8000)")
            print("   --help, -h         Mostra esta ajuda")
            print("\n📝 Exemplos:")
            print("   python iniciar_servidor.py")
            print("   python iniciar_servidor.py --port 8080")
            return
    
    # Verificar se os arquivos existem
    if not check_files():
        print("\n💡 Certifique-se de que está executando este script na pasta raiz do projeto.")
        return
    
    # Verificar dependências
    if not check_dependencies():
        print("\n💡 Instale as dependências manualmente: pip install -r requirements.txt")
        return
    
    # Iniciar o servidor
    start_server(port)

if __name__ == "__main__":
    main()
