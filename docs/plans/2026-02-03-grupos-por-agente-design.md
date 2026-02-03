# Design: Grupos por Agente

**Data:** 2026-02-03
**Status:** Aprovado

## Resumo

Cada agente Claude vive em seu próprio grupo WhatsApp. O número principal vira central de comandos (gestão + bash), rejeitando prompts diretos.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                     NÚMERO PRINCIPAL                            │
│                   (Central de Comandos)                         │
├─────────────────────────────────────────────────────────────────┤
│  Aceita:                                                        │
│  • /           → Menu: criar agente, listar, configurações      │
│  • /status     → Status de todos os agentes                     │
│  • /reset all  → Resetar todos os agentes                       │
│  • $ comando   → Executa bash direto (sem agente)               │
│                                                                 │
│  Rejeita:                                                       │
│  • Prompts de texto → "Use o grupo do agente"                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  Criar Agente     │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 📊 Grupo:       │ │ 🚀 Grupo:       │ │ 🔧 Grupo:       │
│ "Data Analysis" │ │ "Backend API"   │ │ "DevOps"        │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Vínculo Imutável: Agente ↔ Grupo ↔ Workspace ↔ Tipo

Ao criar um agente, define-se:

| Atributo | Mutável? | Descrição |
|----------|----------|-----------|
| Nome | Sim | Pode alterar pela central |
| Emoji | Sim | Pode alterar pela central |
| **Tipo** | **Não** | Conversacional ou Ralph Loop |
| **Workspace** | **Não** | Diretório de trabalho fixo |
| Modo de modelo | Sim | Seleção ou modelo fixo |

O agente sempre inicia no workspace definido. Pode ler/editar outros locais (decisão do Claude), mas o contexto é daquele diretório.

## Tipos de Agente

### Conversacional
- Responde a cada mensagem individualmente
- Fluxo: prompt → resposta → aguarda próximo prompt
- Ideal para tarefas pontuais e interativas

### Ralph Loop
- Executa tarefas autonomamente em loop
- Fluxo: define tarefa → agente trabalha sozinho → completa ou atinge limite
- Ideal para tarefas complexas e autônomas

## Modos de Modelo

| Modo | Comportamento |
|------|---------------|
| **Seleção** (padrão) | Prompt → pergunta qual modelo → executa |
| **Modelo Fixo** | Prompt → executa direto com modelo configurado |

### Atalhos Globais (prefixos)

Funcionam em qualquer lugar, ignoram configuração:
- `!haiku texto` → usa Haiku
- `!sonnet texto` → usa Sonnet
- `!opus texto` → usa Opus

### Avisos ao Usuário

Ao ativar modo fixo:
```
✅ Modelo fixo ativado: Opus

A partir de agora, suas mensagens serão
executadas direto com Opus, sem perguntar.

Dica: Use !haiku ou !sonnet no início
da mensagem para usar outro modelo pontualmente.
```

No menu do agente (quando em modo fixo):
```
🚀 Backend API
📁 /Users/lucas/projects/api
⚙️ Modelo: Opus (fixo)
   └── Mensagens executam direto
```

## Descrição do Grupo WhatsApp

### Conversacional
```
📁 /Users/lucas/projects/api
📅 03/02/2026
💬 Conversacional: responde a cada prompt
```

### Ralph Loop
```
📁 /Users/lucas/projects/api
📅 03/02/2026
🔄 Ralph: trabalha sozinho até completar
```

## Fluxo de Criação do Agente

```
Número Principal → [ / ] Menu → "➕ Criar agente"
                                      │
      ┌───────────────────────────────┘
      ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Nome do agente                                       │
│    Texto livre: "Backend API"                           │
└─────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Emoji                                                │
│    Lista: 🤖 🔧 📊 💡 🎯 📝 🚀 ⚡ 🔍 💻                  │
└─────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Tipo de agente (IMUTÁVEL)                            │
│                                                         │
│ 💬 Conversacional                                       │
│    Responde a cada mensagem individualmente.            │
│    Você envia prompt → agente responde → aguarda.       │
│                                                         │
│ 🔄 Ralph Loop                                           │
│    Executa tarefas autonomamente em loop.               │
│    Você define a tarefa → agente trabalha sozinho       │
│    até completar ou atingir limite de iterações.        │
└─────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Workspace (IMUTÁVEL)                                 │
│    • 🏠 Home                                            │
│    • 🖥️ Desktop                                         │
│    • 📄 Documents                                       │
│    • ✏️ Caminho customizado                             │
└─────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Modo de modelo                                       │
│    • 🔄 Seleção (pergunta sempre)                       │
│    • ⚡ Haiku fixo                                      │
│    • 🎭 Sonnet fixo                                     │
│    • 🎼 Opus fixo                                       │
└─────────────────────────────────────────────────────────┘
      │
      ▼
   Sistema cria grupo WhatsApp automaticamente
   Adiciona usuário como participante
   Agente pronto para uso
```

## Fluxo de Deleção do Agente

```
Menu do agente → "🗑️ Deletar agente"
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ ⚠️ Deletar agente "Backend API"?                        │
│                                                         │
│ O que fazer com o grupo?                                │
│                                                         │
│ [🗑️ Deletar grupo] - Remove grupo e histórico          │
│ [📁 Manter grupo]  - Grupo fica, agente desativado     │
│ [❌ Cancelar]                                           │
└─────────────────────────────────────────────────────────┘
```

## Número Principal: Comandos Aceitos

| Comando | Ação |
|---------|------|
| `/` | Menu principal (criar, listar, configurar) |
| `/status` | Status de todos os agentes |
| `/reset all` | Resetar sessão de todos os agentes |
| `$ comando` | Executa bash direto no sistema |

Qualquer outro texto recebe:
```
⚠️ Prompts não são aceitos aqui.

Use o grupo do agente para conversar.
Digite / para ver seus agentes.
```

## Requisitos da API WhatsApp

- **Groups API** (disponível desde outubro 2025)
- Limite: 10.000 grupos por número
- Limite: 8 participantes por grupo
- Requisito: 100.000 conversas/24h para elegibilidade

## Fora do MVP (Futuro)

- Convidar agente para grupo existente
- Multi-agente colaborativo em grupo
- Migração de agentes antigos

## Referências

- [WhatsApp Groups API - Woztell](https://woztell.com/whatsapp-groups-api-en/)
- [WhatsApp Groups API - Sanuker](https://sanuker.com/whatsapp-groups-api-en/)
