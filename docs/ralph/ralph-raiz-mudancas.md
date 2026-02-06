# Ralph “Raiz” (Loop Externo) — Mudanças necessárias no Claude Terminal

Objetivo: alinhar o `ralph mode` do Claude Terminal com a filosofia “Ralph raiz / bash loop externo” descrita em [docs/ralph/ralph.md](docs/ralph/ralph.md):

- **Sessões curtas** (evitar *context rot*): cada iteração roda “como se fosse do zero”.
- **Estado persiste nos arquivos** (código, PRD, FEATURES, logs), não na memória da conversa.
- **Mesmo prompt base a cada iteração** (o loop reexecuta o mesmo *loop prompt*).
- **Critérios verificáveis** + **escape hatch** (quando travar, documenta bloqueios e para).

Este documento lista mudanças recomendadas no código e no comportamento.

---

## 1) Problema atual (onde diverge do “Ralph raiz”)

### 1.1 Sessão é reutilizada entre iterações
Hoje `ClaudeTerminal.send()` usa `resume` quando existe sessionId persistida por `userId_agentId` em [src/terminal.ts](src/terminal.ts). Isso faz o loop herdar contexto conversacional crescente.

Impacto:
- A cada iteração o contexto tende a crescer e “apodrecer” (drift).
- A IA pode se apoiar na conversa ao invés de materializar estado em arquivos.

### 1.2 O prompt não é o mesmo a cada iteração
`buildIterationPrompt()` em [src/ralph-loop-manager.ts](src/ralph-loop-manager.ts) só inclui `loop.task` na iteração 1; depois vira “Continue working…”.

Impacto:
- A iteração N não tem a mesma definição explícita do “contrato de sucesso”.
- Aumenta chance de desvio, esquecimentos e conclusões prematuras.

### 1.3 Não existe escape hatch “BLOCKED” padronizado
O loop marca `blocked` quando atinge `maxIterations`, mas não há padrão explícito de “quando travar, gere `BLOCKERS.md` e emita `<promise>BLOCKED</promise>`”.

---

## 2) Mudanças para virar “Ralph raiz”

### 2.1 Sessão curta por iteração (matar e recriar sessão)

**Meta:** cada iteração deve rodar como uma sessão nova (sem `resume`).

Opções (escolher uma):

**Opção A — Limpar sessão do loop antes de cada iteração (recomendado)**
- Usar `topicKey` como chave de sessão específica do loop (ex.: `topicKey = loop.id`).
- Antes de chamar `terminal.send(...)` em cada iteração, chamar `terminal.clearTopicSession(loop.id)`.

Notas:
- Isso mantém o “Ralph” fiel ao externo: cada rodada começa limpa.
- O estado que persiste deve ser materializado em arquivos (código, docs, etc.).

**Opção B — Não usar `resume` quando estiver em Ralph**
- Introduzir um parâmetro no `send()` para desativar `resume` (ex.: `disableResume: boolean`).

Notas:
- É uma alteração mais invasiva na API do terminal.

### 2.2 Reenviar o mesmo prompt base em toda iteração

**Meta:** “Ralph é um `while true`” → a cada rodada, reenviar o mesmo prompt (ou o mesmo *loop prompt*), com metadados mínimos.

Recomendação:
- Refatorar `buildIterationPrompt()` para sempre incluir:
  - `loop.task` completo
  - regras fixas de sucesso (promise)
  - checklist de execução (ex.: rodar testes)
  - metadados de iteração (X/Y) e, opcionalmente, um resumo de falhas da iteração anterior

Exemplo de esqueleto:

```md
You are operating in autonomous Ralph mode.

TASK:
{loop.task}

RULES:
- Work autonomously.
- Persist all important state in files.
- Prefer running tests/lint/build each iteration when applicable.

STOPPING CRITERIA:
- If fully complete, output exactly: <promise>COMPLETE</promise>
- If blocked, follow the BLOCKED protocol and output: <promise>BLOCKED</promise>

ITERATION:
{iterationNumber}/{maxIterations}

LAST ITERATION SUMMARY (optional):
- action: ...
- key errors: ...
```

### 2.3 Adicionar protocolo de “BLOCKED” (escape hatch)

**Meta:** quando travar, não ficar rodando vazio; materializar diagnóstico em arquivo e encerrar explicitamente.

Mudanças:
- Expandir a regex de promise para suportar múltiplos finais (no mínimo `COMPLETE` e `BLOCKED`).
- Atualizar o prompt para instruir:
  - após X iterações sem progresso (ou ao detectar impeditivo), criar `BLOCKERS.md` com:
    - o que bloqueia
    - tentativas já feitas
    - logs/erros relevantes
    - sugestões de próximo passo humano
  - emitir `<promise>BLOCKED</promise>`

Comportamento sugerido:
- Se detectar `BLOCKED`, marcar loop como `blocked` e finalizar (igual ao maxIterations).

### 2.4 “Estado nos arquivos” como padrão (PRD/FEATURES/LOG)

**Meta:** orientar o loop a operar com arquivos que funcionem como memória externa.

Recomendação de convenção (não precisa ser obrigatório, mas ajuda):
- `PRD.md` (requisitos e objetivos)
- `FEATURES.json` (lista de tarefas + status)
- `LOOP_PROMPT.md` (prompt base do loop)
- `LOG.md` (progresso e decisões por iteração)

O `loop.task` pode apontar explicitamente para esses arquivos.

---

## 3) Mudanças pontuais sugeridas (no código)

### 3.1 `RalphLoopManager.executeIteration()`
Arquivo: [src/ralph-loop-manager.ts](src/ralph-loop-manager.ts)

- Antes de `terminal.send(...)`:
  - **limpar sessão do loop** (ex.: `terminal.clearTopicSession(loop.id)`)
  - passar `topicKey = loop.id` no `send()` (para isolar a sessão do loop)

### 3.2 `RalphLoopManager.buildIterationPrompt()`
Arquivo: [src/ralph-loop-manager.ts](src/ralph-loop-manager.ts)

- Fazer todas as iterações incluírem `loop.task` completo e o contrato de promises.
- Opcional: anexar resumo de `lastIteration.action` + últimos erros (se disponíveis) sem depender do chat.

### 3.3 Detecção de promises
Arquivo: [src/ralph-loop-manager.ts](src/ralph-loop-manager.ts)

- Trocar `COMPLETION_REGEX` por algo como:

```ts
const PROMISE_REGEX = /<promise>\s*(COMPLETE|BLOCKED)\s*<\/promise>/i;
```

- Ajustar o retorno de `executeIteration()` para indicar qual promise foi encontrada.

---

## 4) Resultado esperado (definição de pronto)

Após as mudanças:
- Cada iteração roda sem reaproveitar contexto de conversa (sessão curta).
- O prompt base é o mesmo em todas as iterações (com metadados mínimos).
- O loop conclui com `<promise>COMPLETE</promise>` ou para com `<promise>BLOCKED</promise>` e um `BLOCKERS.md`.
- A evolução do trabalho fica rastreável e reproduzível nos arquivos do workspace.

---

## 5) Observações práticas

- Isso tende a aumentar chamadas “do zero”, mas melhora robustez e reduz drift.
- Para tarefas longas, a qualidade do `loop.task` (ou `LOOP_PROMPT.md`) vira o fator dominante.
- Idealmente, o prompt manda rodar `bun test`/`npm test`/etc a cada iteração; quando existir um verificador automático, Ralph fica muito mais eficaz.
