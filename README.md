# Amply

Sistema SaaS para concessionárias gerenciarem estoque de veículos, leads e agendamentos com integração futura com WhatsApp.

## 🚀 Status do Projeto
**MVP em desenvolvimento**

## 💻 Tecnologias
- [React](https://reactjs.org/) (v19)
- [Vite](https://vitejs.dev/)
- [React Router](https://reactrouter.com/) (v7)
- [Lucide React](https://lucide.dev/) (Ícones)
- CSS Puro (Design System Customizado)
- Context API & LocalStorage (Estado Global Temporário)

## 🛠️ Instruções para Rodar o Projeto

1. Certifique-se de ter o Node.js instalado na sua máquina.
2. Clone o repositório ou navegue até o diretório do projeto:
   ```bash
   cd amply
   ```
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Inicie o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```
5. Acesse no navegador o link que aparecerá no terminal (ex: `http://localhost:5173`).

## 📁 Estrutura do Projeto

O projeto adota uma arquitetura modular organizada por Views, Components e Context:

- `src/views/` - Páginas principais da aplicação (Estoque, Leads, Agenda, Configurações).
- `src/components/` - Componentes reutilizáveis (Modais, Drawers, Cards).
- `src/context/` - `AppContext` que abriga o gerenciamento global de estado.
- `src/App.css` - Estilos globais e tokens de design (System Variables).
