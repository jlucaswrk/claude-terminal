# Onboarding de Agentes via Grupo

## Resumo

Simplificar a criação e vinculação de agentes diretamente no grupo do Telegram, eliminando a necessidade de ir ao chat privado primeiro.

## Princípios

- linguagem informal e afetuosa, sempre minúscula
- sem bordões genéricos ("opa", "bora", coisas "ia-like")
- mostrar só opções que fazem sentido
- reconexão automática quando possível

## Fluxo Principal

```
bot adicionado ao grupo
        ↓
verifica se grupo já teve agente
        ↓
    ┌───┴───┐
    ↓       ↓
[existe]  [não existe]
    ↓       ↓
reconecta  verifica se user tem agentes
automático      ↓
    ↓      ┌───┴───┐
    ↓      ↓       ↓
    ↓   [tem]    [não tem]
    ↓      ↓       ↓
    ↓   botões:  botões:
    ↓   criar/   criar/
    ↓   vincular depois
    ↓      ↓       ↓
    ↓   fixa mensagem no grupo
    ↓      ↓
    └──────┴───→ agente vinculado
                    ↓
              desfixa mensagem
              confirma + dicas
              "qual a primeira tarefa?"
```

## Mensagens

### Reconexão Automática
```
reconectei ao ⚡ API Backend

!haiku, !sonnet ou !opus antes do prompt
qual a primeira tarefa?
```

### Grupo Novo (com agentes existentes)
```
esse grupo não tem agente ainda

[criar um]  [vincular existente]       ← reply keyboard
```

### Grupo Novo (sem agentes)
```
seu primeiro agente 🎉

[criar agora]  [depois]                ← reply keyboard
```

### Se Escolher "depois"
```
beleza, /criar quando quiser
```
Bot fica quieto no grupo até user mandar /criar.

## Fluxo de Criação no Grupo

### 1. Nome
```
qual o nome do agente?
ex: backend api, data analysis
```

### 2. Emoji
```
emoji pro agente?

[🤖]  [⚡]  [🔧]  [🎯]  [🧠]  [✨]     ← inline buttons
[escolher outro]
```

### 3. Workspace
```
workspace?

[sandbox]  [home]  [desktop]           ← reply keyboard
[caminho personalizado]
```

### 4. Modelo
```
modelo fixo ou escolher por prompt?

[sempre haiku]  [sempre sonnet]  [sempre opus]
[escolher a cada prompt]
```

### 5. Confirmação
```
✅ ⚡ backend api criado e vinculado

!haiku, !sonnet ou !opus antes do prompt
qual a primeira tarefa?
```

## Fluxo de Vincular Existente

### 1-3 Agentes (inline)
```
qual agente?

[⚡ backend api]  [🔧 frontend]        ← inline buttons
```

### 4+ Agentes (lista numerada)
```
qual agente?

⚡ backend api
🔧 frontend
🎯 data pipeline
🧠 ml trainer

[1]  [2]  [3]  [4]                     ← inline buttons
```

### Confirmação
```
✅ ⚡ backend api vinculado

!haiku, !sonnet ou !opus antes do prompt
qual a primeira tarefa?
```

## Casos Especiais

### Mensagem em Grupo Sem Agente
Mostra a mensagem de onboarding uma vez e fixa. Ignora mensagens subsequentes até vincular.

### /link Sem Agentes Disponíveis
```
não tem agente pra vincular, quer criar um?

[criar agora]  [depois]
```

### Cancelar Criação (/cancelar)
```
cancelado

[criar um]  [vincular existente]       ← volta pro início
```

### Bot Removido do Grupo
- desvincula o agente automaticamente
- agente fica disponível pra vincular em outro grupo

## Componentes Técnicos

### Reply Keyboard
Usado para ações principais:
- criar/vincular
- workspace selection
- model selection

### Inline Buttons
Usado para seleções específicas:
- emojis
- lista de agentes

### Pin Message
- fixa mensagem de onboarding até vincular
- requer bot como admin com permissão de fixar
- se não tiver permissão, só manda sem fixar

### Auto-Reconnect
- armazena mapeamento grupo → agente
- quando bot re-entra, verifica se agente ainda existe
- se existe, reconecta automaticamente

## Mudanças Necessárias

1. **handleTelegramMyChatMember**: refatorar para novo fluxo
2. **telegram.ts**: adicionar funções para reply keyboard e pin message
3. **agent-manager.ts**: adicionar método para buscar agente por grupo anterior
4. **Remover**: lógica de orphaned groups (substituída por auto-reconnect)
5. **Remover**: criação de agente no chat privado com instruções de /link
