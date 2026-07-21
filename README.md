# 🐟 Calculadora de Custos - Beneficiamento de Pescados

Uma aplicação web moderna e intuitiva para calcular custos de beneficiamento de produtos pesqueiros, com interface responsiva e funcionalidades avançadas.

## ✨ Características

### 🎨 Interface Moderna
- **Design responsivo** que funciona perfeitamente em desktop, tablet e mobile
- **Gradientes e animações** suaves para uma experiência visual agradável
- **Tipografia moderna** com fonte Inter para melhor legibilidade
- **Ícones FontAwesome** para melhor identificação visual dos elementos
- **Tema azul profissional** com cores harmoniosas

### 🚀 Funcionalidades Principais
- **Cálculo automático** de custos de beneficiamento
- **Validação em tempo real** dos campos do formulário
- **Feedback visual** com notificações toast
- **Animações suaves** durante interações
- **Sistema de abas** para organizar funcionalidades

### 📊 Sistema de Histórico
- **Armazenamento local** de cálculos realizados
- **Visualização de histórico** com resumos dos cálculos
- **Duplicação de cálculos** para facilitar novos cálculos similares
- **Exportação de dados** em formato JSON
- **Limpeza seletiva** do histórico

### 📱 Experiência do Usuário
- **Navegação por teclado** (Tab, Enter, Escape)
- **Validação inteligente** com mensagens de erro claras
- **Loading states** durante processamento
- **Responsividade completa** para todos os dispositivos
- **Acessibilidade** com foco visível e navegação por teclado

## 🛠️ Tecnologias Utilizadas

- **HTML5** - Estrutura semântica moderna
- **CSS3** - Estilos avançados com variáveis CSS, gradientes e animações
- **JavaScript ES6+** - Lógica interativa e funcionalidades avançadas
- **FontAwesome** - Ícones profissionais
- **Google Fonts** - Tipografia moderna (Inter)
- **LocalStorage** - Armazenamento de dados no navegador

## 📋 Produtos Suportados

A calculadora suporta os seguintes produtos pesqueiros:

- Filé de merluza
- Filé de Panga Com
- Filé de Panga Premium
- Filé de Saithe
- Filé de Polaca
- Posta de Cação
- Posta de Salmão
- Filé de Tilápia
- Tentáculos de Lula
- Anéis de Lula
- Camarão sete barbas

## 🏷️ Categorias

- **Mercado** - Produtos para venda no mercado
- **Restaurante** - Produtos para uso em restaurantes

## 💰 Cálculos Realizados

A aplicação calcula automaticamente:

- **Custo dos sacos de gelo** (R$ 8,50 por saco)
- **Custo das caixas de papelão** (R$ 7,30 por caixa)
- **Custo das fitas durex** (R$ 0,34 por caixa)
- **Percentual de beneficiamento** (% de ganho de peso)
- **Custo por Kg pós-beneficiamento**
- **Custo total final** incluindo todos os insumos

## 🚀 Como Usar

1. **Acesse a aplicação** no navegador
2. **Selecione o produto** desejado
3. **Escolha a categoria** (Mercado ou Restaurante)
4. **Preencha os dados**:
   - Preço por Kg
   - Peso inicial
   - Peso final
   - Quantidade de sacos de gelo
   - Quantidade de caixas de papelão
5. **Clique em "Calcular Custos"**
6. **Visualize os resultados** detalhados
7. **Acesse o histórico** para ver cálculos anteriores

## 📁 Estrutura do Projeto

```
Calculo_de_custos-main/
├── web/
│   ├── index.html          # Página principal
│   ├── style.css           # Estilos CSS
│   ├── script.js           # Lógica JavaScript
│   └── vercel.json         # Configuração de deploy
├── beneficiamento.py       # Versão Python (legado)
└── README.md               # Documentação
```

## 🎯 Funcionalidades Avançadas

### Sistema de Abas
- **Calculadora** - Interface principal para cálculos
- **Histórico** - Visualização e gerenciamento de cálculos anteriores

### Validações Inteligentes
- **Campos obrigatórios** são validados em tempo real
- **Números positivos** são verificados automaticamente
- **Peso final** deve ser maior que o peso inicial
- **Preço** deve ser maior que zero

### Notificações Toast
- **Sucesso** - Cálculo realizado com sucesso
- **Erro** - Problemas na validação ou cálculo
- **Aviso** - Informações importantes

### Exportação de Dados
- **Resultado individual** - Exporta dados do cálculo atual
- **Histórico completo** - Exporta todos os cálculos salvos
- **Formato JSON** - Dados estruturados para análise

## 🔧 Personalização

### Cores e Tema
As cores podem ser facilmente personalizadas através das variáveis CSS no arquivo `style.css`:

```css
:root {
    --primary-color: #2563eb;    /* Cor principal */
    --secondary-color: #0ea5e9;  /* Cor secundária */
    --success-color: #10b981;    /* Cor de sucesso */
    --warning-color: #f59e0b;    /* Cor de aviso */
    --error-color: #ef4444;      /* Cor de erro */
}
```

### Preços dos Insumos
Os preços podem ser alterados no arquivo `script.js`:

```javascript
const PRECOS = {
    GELO: 8.5,      // Preço por saco de gelo
    PAPELAO: 7.3,   // Preço por caixa de papelão
    FITA: 0.34      // Preço por fita durex
};
```

## 📱 Compatibilidade

- **Desktop** - Chrome, Firefox, Safari, Edge
- **Mobile** - iOS Safari, Chrome Mobile, Samsung Internet
- **Tablet** - iPad, Android tablets
- **Responsivo** - Adapta-se a qualquer tamanho de tela

## 🚀 Deploy

A aplicação está configurada para deploy na Vercel através do arquivo `vercel.json`. Para fazer deploy:

1. Faça push do código para um repositório Git
2. Conecte o repositório à Vercel
3. A aplicação será automaticamente deployada

## 📄 Licença

Este projeto é de uso livre para fins educacionais e comerciais.

## 🤝 Contribuições

Contribuições são bem-vindas! Sinta-se à vontade para:

- Reportar bugs
- Sugerir melhorias
- Adicionar novos recursos
- Melhorar a documentação

## 📞 Suporte

Para dúvidas ou suporte, entre em contato através dos canais disponíveis.

---

**Versão:** 2.0.0  
**Última atualização:** 2024  
**Desenvolvido com ❤️ para a indústria pesqueira**