@echo off
chcp 65001 >nul
title Calculadora de Custos - Beneficiamento de Pescados

echo.
echo ================================================================================
echo 🐟 CALCULADORA DE CUSTOS - BENEFICIAMENTO DE PESCADOS 🐟
echo ================================================================================
echo.

REM Verificar se Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python não encontrado! Instale Python para continuar.
    echo 💡 Download: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

REM Verificar se estamos no diretório correto
if not exist "web\index.html" (
    echo ❌ Arquivo index.html não encontrado!
    echo 💡 Certifique-se de executar este arquivo na pasta raiz do projeto.
    echo.
    pause
    exit /b 1
)

echo ✅ Arquivos encontrados!
echo 🚀 Iniciando servidor...
echo.

REM Executar o script Python
python iniciar_servidor.py

echo.
echo 👋 Obrigado por usar a Calculadora de Custos!
pause
