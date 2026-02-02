# Modo Bash - Design

## Visão Geral

O sistema terá 3 formas de executar comandos bash diretamente:

### 1. Toggle Global (`/bash` / `/claude`)
- `/bash` ativa o modo bash para o usuário
- Todas as mensagens subsequentes são executadas como comandos
- `/claude` volta pro modo normal (seleção de agentes)
- Estado persiste entre sessões

### 2. Agente Tipo Bash
- Novo tipo de agente: `type: 'bash'` (vs `type: 'claude'` padrão)
- Criado pelo menu "Criar agente" com opção "Agente Bash"
- Funciona como qualquer agente (selecionável, tem histórico, workspace)
- Mas executa comandos direto no shell ao invés de usar o SDK

### 3. Prefixo por Mensagem
- Mensagem começando com `$` ou `>` executa como bash imediatamente
- Não precisa selecionar agente nem modelo
- Ex: `$ ls -la` ou `> git status`
- Usa o workspace do último agente usado, ou home se nenhum

### Output
- Saída até 3500 chars: exibe direto no chat
- Saída maior: trunca + envia arquivo `.txt` com saída completa
- Formato: código monospace com indicador de sucesso/erro

---

## Modelo de Dados

### Mudanças em `types.ts`

```typescript
// Agent ganha campo type
interface Agent {
  // ... campos existentes ...
  type: 'claude' | 'bash';  // default: 'claude'
}

// UserContext ganha modo global
interface UserContext {
  // ... campos existentes ...
  bashMode?: boolean;  // toggle global ativo
}
```

### Mudanças em `AgentsState`

```typescript
interface SystemConfig {
  maxConcurrent: number;
  version: string;
  defaultBashWorkspace?: string;  // workspace padrão para prefixo $
}
```

### Nova interface para resultado bash

```typescript
interface BashResult {
  command: string;
  output: string;
  exitCode: number;
  duration: number;  // ms
  truncated: boolean;
}
```

---

## Execução de Comandos

### Novo arquivo `src/bash-executor.ts`

- Usa `Bun.spawn()` para executar comandos
- Timeout configurável (default: 60s)
- Captura stdout + stderr combinados
- Retorna exit code para indicar sucesso/erro
- Suporta workspace (cwd) opcional

### Segurança

Comandos perigosos bloqueados com mensagem:
```
🚫 Comando bloqueado: sudo rm -rf /

Esse tipo de comando é arriscado demais pra executar pelo celular.
Vá até a máquina e execute diretamente no terminal.
```

Lista de padrões bloqueados:
- `rm -rf /`
- `sudo` (qualquer comando)
- `shutdown`, `reboot`, `halt`
- `mkfs`, `dd if=`
- `:(){ :|:& };:` (fork bomb)
- `> /dev/sda`

Limites:
- Timeout: 60s (configurável)
- Output máximo: 1MB

---

## Mensagens de Resposta

### Comando executado com sucesso
```
✅ $ git status
─────────────
On branch main
nothing to commit, working tree clean
─────────────
⏱ 45ms
```

### Comando com erro (exit code != 0)
```
❌ $ cat arquivo_inexistente
─────────────
cat: arquivo_inexistente: No such file or directory
─────────────
⏱ 12ms | exit 1
```

### Output truncado
```
✅ $ npm install
─────────────
added 234 packages in 12s
... [+2847 linhas]
─────────────
⏱ 12.4s
```
+ Envia arquivo `npm-install-output.txt` com saída completa

---

## Fluxo no Menu

### Menu principal (/) ganha toggle

```
⚙️ Gerenciar
├─ ➕ Criar agente
├─ 🗑️ Remover agentes
└─ 🖥️ Modo Bash: OFF
```

### Criar agente ganha opção de tipo

```
Tipo de agente:
├─ 🤖 Claude Code (IA + ferramentas)
└─ 🖥️ Bash (terminal direto)
```

---

## Fluxo de Mensagens

Ordem de checagem no webhook:

```
1. É comando? (/bash, /claude, /reset, etc.)
   → Executa comando

2. Modo bash global ativo?
   → Executa no shell direto

3. Começa com $ ou >?
   → Remove prefixo, executa no shell

4. Fluxo normal
   → Seleção de agente Claude
```

Quando seleciona agente tipo bash:
- Pula seleção de modelo (não usa Claude)
- Executa comando direto
- Salva no histórico do agente (outputs)

---

## Arquivos a Modificar/Criar

| Arquivo | Mudança |
|---------|---------|
| `src/bash-executor.ts` | **Novo** - execução de comandos |
| `src/types.ts` | Adicionar `type` em Agent, `bashMode` em UserContext |
| `src/index.ts` | Lógica de roteamento (prefixo, modo global) |
| `src/whatsapp.ts` | Novo menu de tipo de agente, toggle bash |
| `src/agent-manager.ts` | Suportar criação de agente bash |
| `src/user-context-manager.ts` | Gerenciar `bashMode` |
| `src/queue-manager.ts` | Desviar agentes bash pro executor |

### Testes
- `bash-executor.test.ts` - execução, timeout, bloqueio
- Atualizar testes existentes para novo campo `type`

---

## Implementação

### Fase 1: Core
1. Criar `bash-executor.ts` com execução básica
2. Adicionar tipos em `types.ts`
3. Testes do executor

### Fase 2: Prefixo
4. Detectar `$` / `>` em `index.ts`
5. Executar e responder

### Fase 3: Toggle Global
6. Adicionar `/bash` e `/claude` como comandos
7. Persistir `bashMode` no UserContext
8. Atualizar menu com toggle

### Fase 4: Agente Bash
9. Opção de tipo na criação de agente
10. Roteamento no queue-manager
11. Atualizar menus e fluxos
