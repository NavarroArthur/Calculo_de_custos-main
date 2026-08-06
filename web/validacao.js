// ===========================================================================
// VALIDACAO DO FORMULARIO (extraida do script.js)
// ---------------------------------------------------------------------------
// Script global classico: os nomes seguem globais como antes; mudou so a
// organizacao (validacao separada do calculo, da API e do resto).
// Depende de globais do script.js (campos), lidos no momento da chamada.
// Carregado ANTES do script.js no index.html.
// ===========================================================================

// Liga a validacao "ao vivo" (enquanto digita) nos campos numericos.
function aplicarValidacoes() {
    // Validação de peso final deve ser maior que inicial
    campos.peso_final.addEventListener('input', function() {
        const pesoInicial = parseFloat(campos.peso_inicial.value);
        const pesoFinal = parseFloat(this.value);

        if (pesoInicial && pesoFinal && pesoFinal <= pesoInicial) {
            mostrarErro(this, 'O peso final deve ser maior que o peso inicial');
        } else {
            limparErro(this);
        }
    });

    // Validação de preço positivo
    campos.preco.addEventListener('input', function() {
        const valor = parseFloat(this.value);
        if (valor && valor <= 0) {
            mostrarErro(this, 'O preço deve ser maior que zero');
        } else {
            limparErro(this);
        }
    });

    // Validação de números positivos
    ['peso_inicial', 'peso_final', 'sacos_de_gelo', 'caixa_papelao'].forEach(campoId => {
        campos[campoId].addEventListener('input', function() {
            const valor = parseFloat(this.value);
            if (valor && valor < 0) {
                mostrarErro(this, 'Este valor deve ser maior ou igual a zero');
            } else {
                limparErro(this);
            }
        });
    });
}

// Valida UM campo (obrigatorio + numero valido). Devolve true/false.
function validarCampo(event) {
    const campo = event.target;
    const valor = campo.value.trim();

    // Limpar erros anteriores
    limparErro(campo);

    // Validações básicas
    if (campo.hasAttribute('required') && !valor) {
        mostrarErro(campo, 'Este campo é obrigatório');
        return false;
    }

    if (campo.type === 'number' && valor && isNaN(valor)) {
        mostrarErro(campo, 'Digite um número válido');
        return false;
    }

    return true;
}

// Mostra a mensagem de erro embaixo do campo (e marca aria-invalid).
function mostrarErro(campo, mensagem) {
    limparErro(campo);

    const erroElement = document.createElement('div');
    erroElement.className = 'erro-validacao';
    erroElement.id = `${campo.id}-erro`;
    erroElement.setAttribute('role', 'alert');
    erroElement.textContent = mensagem;
    erroElement.style.cssText = `
        color: var(--error-color);
        font-size: 0.75rem;
        margin-top: 0.25rem;
        display: flex;
        align-items: center;
        gap: 0.25rem;
    `;

    campo.style.borderColor = 'var(--error-color)';
    campo.setAttribute('aria-invalid', 'true');
    campo.setAttribute('aria-describedby', erroElement.id);
    campo.parentNode.appendChild(erroElement);
}

// Remove a mensagem de erro de um campo.
function limparErro(campo) {
    campo.style.borderColor = '';
    campo.removeAttribute('aria-invalid');
    campo.removeAttribute('aria-describedby');
    const erroExistente = campo.parentNode.querySelector('.erro-validacao');
    if (erroExistente) {
        erroExistente.remove();
    }
}

// Valida o formulario inteiro antes do submit. Devolve true/false.
function validarFormulario() {
    let valido = true;

    // Verificar todos os campos obrigatórios
    Object.values(campos).forEach(campo => {
        if (!validarCampo({ target: campo })) {
            valido = false;
        }
    });

    // Validações específicas
    const pesoInicial = parseFloat(campos.peso_inicial.value);
    const pesoFinal = parseFloat(campos.peso_final.value);

    if (pesoInicial && pesoFinal && pesoFinal <= pesoInicial) {
        mostrarErro(campos.peso_final, 'O peso final deve ser maior que o peso inicial');
        valido = false;
    }

    const preco = parseFloat(campos.preco.value);
    if (preco && preco <= 0) {
        mostrarErro(campos.preco, 'O preço deve ser maior que zero');
        valido = false;
    }

    return valido;
}
