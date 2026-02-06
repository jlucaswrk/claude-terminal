# Design: Modo Ronin / Modo Dojo

**Data:** 2026-02-03
**Status:** Proposto

## Problema

A WhatsApp Groups API não está disponível no Kapso, impossibilitando a criação automática de grupos. Alternativas como múltiplos números Twilio têm custo elevado (~$1-2/mês por número).

## Solução

Dois modos de operação com custo zero adicional:

- **Modo Ronin**: Tudo no WhatsApp (comportamento atual)
- **Modo Dojo**: Agentes organizados no Telegram (grupos gratuitos via Bot API)

### Custos

| Abordagem | Custo |
|-----------|-------|
| WhatsApp Groups API | Indisponível no Kapso |
| Múltiplos números Twilio | ~$1-2/mês por número |
| **Telegram Bot API** | **Gratuito** |

O Telegram permite criar grupos ilimitados via Bot API sem custo adicional.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLAUDE TERMINAL                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐         ┌─────────────────────┐            │
│  │   MODO RONIN 🥷     │         │   MODO DOJO 🏯      │            │
│  ├─────────────────────┤         ├─────────────────────┤            │
│  │                     │         │                     │            │
│  │  WhatsApp           │         │  WhatsApp           │            │
│  │  ├── Comandos       │         │  └── Ronin (fixo)   │            │
│  │  └── N agentes      │         │      • Haiku        │            │
│  │      (menu)         │         │      • Read-only    │            │
│  │                     │         │      • Curto        │            │
│  │                     │         │                     │            │
│  │                     │         │  Telegram           │            │
│  │                     │         │  ├── Bot (comandos) │            │
│  │                     │         │  └── Grupos         │            │
│  │                     │         │      (1 por agente) │            │
│  │                     │         │                     │            │
│  └─────────────────────┘         └─────────────────────┘            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Modo Ronin 🥷

Comportamento atual. Tudo acontece no WhatsApp:

- Central de comandos (/, /status, $ bash)
- Múltiplos agentes acessados via menu
- Sem custo extra
- Ideal para poucos agentes

## Modo Dojo 🏯

Separação entre plataformas:

### WhatsApp (Agente Ronin)

Um único agente fixo para consultas rápidas:

| Atributo | Valor |
|----------|-------|
| Nome | Ronin 🥷 |
| Modelo | Haiku (fixo) |
| Modo | Read-only |

**Pode:**
- Ler arquivos
- Explicar código
- Responder dúvidas
- Buscar (Glob/Grep)

**Não pode:**
- Escrever/editar arquivos
- Executar comandos bash
- Criar agentes

**Comportamento:**
- Respostas curtas (max 3 linhas)
- Uma mensagem só
- Direto ao ponto

**System prompt:**
```
Você é um assistente read-only. Responda de forma
extremamente concisa (max 3 linhas). Sem explicações
longas. Direto ao ponto. Você só pode ler, não pode
modificar nada.
```

### Telegram (Dojo)

Estrutura organizada com grupos:

```
Bot: @ClaudeTerminalBot

├── Chat privado = Central de comandos
│   • /criar - novo agente
│   • /status - status de todos
│   • /config - configurações
│
└── Grupos = Agentes
    ├── 🚀 Backend API
    │   └── Workspace: ~/projects/api
    ├── 📊 Data Analysis
    │   └── Workspace: ~/projects/data
    └── 🔧 DevOps
        └── Workspace: ~/infra
```

Cada grupo Telegram = 1 agente com:
- Chat dedicado
- Histórico separado
- Poder total (write, bash, etc.)

## Onboarding

Na primeira criação de agente:

```
┌─────────────────────────────────────────────────────────────┐
│  📋 Como você quer organizar seus agentes?                  │
│                                                             │
│  🏯 Modo Dojo (recomendado)                                 │
│  Agentes organizados no Telegram.                           │
│  Cada agente em seu próprio território.                     │
│  WhatsApp só para consultas rápidas.                        │
│                                                             │
│  🥷 Modo Ronin                                              │
│  Você e seus agentes, tudo no WhatsApp.                     │
│  Simples, direto, sem estrutura.                            │
│                                                             │
│  [🏯 Dojo]  [🥷 Ronin]                                      │
└─────────────────────────────────────────────────────────────┘
```

Se escolher Dojo:

```
│  Qual seu username do Telegram? (sem @)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  🏯 Dojo ativado!                                           │
│                                                             │
│  📱 WhatsApp: consultas rápidas (read-only)                 │
│  💬 Telegram: @ClaudeTerminalBot para seus agentes          │
└─────────────────────────────────────────────────────────────┘
```

## Fluxo de Criação (Dojo)

```
1. /criar no chat privado do bot
2. Bot pergunta: nome, emoji, tipo, workspace, modelo
3. Bot cria grupo Telegram
4. Bot adiciona usuário ao grupo
5. Agente pronto - só mandar mensagem no grupo
```

## Migração entre Modos

### Ronin → Dojo
- Agentes existentes NÃO migram
- Começam do zero no Telegram
- WhatsApp vira Ronin (read-only)

### Dojo → Ronin
- Grupos Telegram continuam existindo
- WhatsApp volta a aceitar agentes normais
- Usuário escolhe onde usar

### Comando

WhatsApp: `/modo`

```
┌───────────────────────────────────────────┐
│ Modo atual: Ronin 🥷                       │
│                                           │
│ [🏯 Mudar para Dojo]                      │
└───────────────────────────────────────────┘
```

## Requisitos Técnicos

### Telegram Bot API
- Criar bot via @BotFather
- Token no `.env`
- Biblioteca: `node-telegram-bot-api` ou `telegraf`

### Permissões do Bot
- Criar grupos
- Adicionar membros
- Enviar mensagens
- Receber mensagens

### Variáveis de Ambiente
```env
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_BOT_USERNAME=ClaudeTerminalBot
```

## Fora do MVP

- Migração automática de agentes Ronin → Dojo
- Múltiplos usuários no mesmo Dojo
- Sincronização de histórico entre plataformas
