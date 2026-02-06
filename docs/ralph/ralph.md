# Ralph Wiggum / Ralph Loops – Guia Prático

Este arquivo resume os principais conteúdos sobre Ralph Wiggum / Ralph Loops (artigos, README oficial do plugin, vídeos e posts) com foco em técnicas práticas para você usar no dia a dia.

---

## 1. Conceitos-Chave

### 1.1 O que é Ralph Wiggum?

- Uma **metodologia de desenvolvimento iterativa com IA** baseada em loops.
- A ideia central: **“Ralph é um `while true`”** – você roda o mesmo prompt várias vezes, e o modelo vai **melhorando o código a cada iteração**, usando os arquivos e o histórico de git como memória.
- Filosofia:
  - **Iteração > Perfeição**: não tentar acertar tudo de primeira, deixar o loop refinar.
  - **Falhas são dados**: erros previsíveis servem para ajustar prompt/estrutura.
  - **Habilidade do operador importa**: sucesso depende de bons prompts, não só do modelo.
  - **Persistência ganha**: o loop insiste até cumprir os critérios de sucesso.

### 1.2 Ralph Plugin vs Ralph “Raiz” (loop externo)

Existem duas abordagens:

1. **Plugin oficial do Claude Code (“Ralph Wiggum plugin”)**
   - Usa um **stop hook dentro da sessão** do Claude Code.
   - O comando `/ralph-loop`:
     - Claude tenta encerrar a sessão,
     - o stop hook intercepta,
     - o mesmo prompt é reenviado,
     - os arquivos atualizados são o “estado”.
   - Loop acontece **dentro do ambiente do Claude Code**.

2. **Ralph Loop “puro” (Bash loop externo)**
   - Defendido pelo Geoffrey Huntley e pela galera do Vibe Coding como o “Ralph correto”.
   - A IA é controlada por fora:
     - Um script bash roda algo como `while true; do ...; done`.
     - Ele **mata e recria sessões** (Claude Code, OpenCode, Cursor etc).
     - Evita “context rot” mantendo sessões curtas, mas o **estado persiste nos arquivos**.
   - Vantagem: o loop não depende da sessão interna do modelo; você tem **controle total do ciclo** (start/stop/restart).

---

## 2. Quando Usar Ralph (e quando NÃO usar)

### 2.1 Bom para

- Projetos **bem definidos** com critérios claros de sucesso.
- Tarefas que exigem **várias tentativas**:
  - Fazer todos os testes passarem.
  - Estabilizar uma API.
  - Implementar uma feature complexa incrementalmente.
- **Greenfield**: projetos novos em que você pode deixar rodando (noite/fim de semana).
- Tarefas com **verificação automática**:
  - Testes (`npm test`, `pytest` etc).
  - Linters / formatadores (ESLint, Prettier).
  - Build/scripts de CI.

### 2.2 Não é bom para

- Coisas que exigem **julgamento humano forte** (design, produto, UX sem critérios).
- Ações **one-shot** que você precisa na hora (tipo “gera esse script único pra agora”).
- Debug em produção, incidentes, hotfixes delicados.
- Tarefas com sucesso **ambíguo** (“deixe bonito”, “melhore o código”).

---

## 3. Estrutura Básica de um Ralph Loop

### 3.1 Loop externo simples (Bash)

Exemplo genérico (Claude via CLI):

```bash
while :; do
  claude -p "$(cat PROMPT.md)"
done
```

Pontos importantes:

- `PROMPT.md` contém:
  - Contexto do projeto.
  - Tarefa atual.
  - Critérios de sucesso.
  - Instruções de como reagir a erros (testes, build, lint, etc).
- O loop:
  - Executa a IA,
  - IA lê código + arquivos de configuração,
  - Faz alterações,
  - Sai,
  - Bash chama de novo com o mesmo prompt, mas o código já mudou.

### 3.2 Plugin Ralph Wiggum no Claude Code

Comando básico:

```bash
/ralph-loop "Build a REST API for todos. Requirements: CRUD operations, input validation, tests. Output <promise>COMPLETE</promise> when done." \
  --completion-promise "COMPLETE" \
  --max-iterations 50
```

O que acontece em cada iteração:

1. Claude lê o prompt.
2. Modifica arquivos, roda comandos (testes, lint etc).
3. Tenta encerrar a sessão.
4. Stop hook bloqueia.
5. O mesmo prompt é reenviado.
6. Ele “vê” os arquivos atualizados e continua.

> Observação prática: vários devs consideram o **loop externo em Bash mais fiel** ao Ralph original do que o plugin interno.

---

## 4. Técnicas de Prompt para Ralph

### 4.1 Definir critérios de conclusão de forma explícita

**Ruim:**

> “Crie uma API de todo e deixe boa.”

**Bom:**

```md
Build a REST API for todos.

When complete:
- All CRUD endpoints working
- Input validation in place
- Tests passing (coverage > 80%)
- No linter errors
- README with API docs

When everything above is done, output exactly:
<promise>COMPLETE</promise>
```

Técnicas:

- Liste **itens verificáveis**.
- Use uma string específica de finalização (`<promise>COMPLETE</promise>`).
- Combine com `--completion-promise "COMPLETE"` (no plugin) ou cheque a string no loop externo.

### 4.2 Quebrar em fases (incremental)

```md
Phase 1: User authentication (JWT, tests)
Phase 2: Product catalog (list/search, tests)
Phase 3: Shopping cart (add/remove, tests)

Rules:
- Complete each phase fully before starting the next.
- For each phase, ensure tests pass and lint/build are clean.

When all phases are done, output:
<promise>COMPLETE</promise>
```

Dicas:

- Tratar cada fase como um mini-projeto.
- Deixar claro que **não pode avançar** para a fase seguinte com “dívida”.

### 4.3 Padrão de autocorreção (TDD / feedback loop)

```md
Implement feature X using TDD:

1. Write failing tests for the next requirement
2. Implement minimal code to pass
3. Run tests
4. If any fail, debug and fix
5. Refactor if needed
6. Repeat until all tests are green

When all tests are green and code is refactored, output:
<promise>COMPLETE</promise>
```

- A IA aprende com o próprio erro de teste.
- Combine com scripts de teste repetíveis (`npm test`, `pnpm test`, `pytest`, etc).

### 4.4 Escape hatches (para não travar)

No prompt, defina o que fazer se não conseguir concluir:

```md
If after 15 iterations this task is still not complete:

- Stop trying to implement the feature.
- Create a file named BLOCKERS.md with:
  - What is blocking progress
  - What has been tried so far
  - Suggestions for alternative approaches
- Then output:
<promise>BLOCKED</promise>
```

E no comando:

```bash
/ralph-loop "Try to implement feature X (see PROMPT.md)." \
  --max-iterations 20
```

---

## 5. Padrões de Uso Frequentes (Templates)

### 5.1 Implementação de feature

```bash
/ralph-loop "Implement [FEATURE_NAME].

Requirements:
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

Success criteria:
- All requirements implemented
- Tests passing with >80% coverage
- No linter errors
- Documentation updated

If stuck after 15 iterations:
- Document blockers in BLOCKERS.md
- List attempted approaches
- Suggest alternative designs

Output <promise>COMPLETE</promise> when done." \
  --max-iterations 30 \
  --completion-promise "COMPLETE"
```

### 5.2 Loop TDD

```bash
/ralph-loop "Implement [FEATURE] using TDD.

Process:
1. For each requirement, first write failing tests.
2. Run tests and confirm they fail for the right reason.
3. Implement minimal code to make tests pass.
4. Run tests again.
5. If tests fail, debug and fix.
6. Refactor if needed.
7. Repeat until all requirements are implemented.

Requirements:
- [List of requirements here]

Output <promise>DONE</promise> when all tests are passing and code is refactored." \
  --max-iterations 50 \
  --completion-promise "DONE"
```

### 5.3 Loop de bugfix

```bash
/ralph-loop "Fix bug: [DESCRIPTION]

Steps per iteration:
1. Reproduce the bug.
2. Identify or refine the root cause hypothesis.
3. Implement a fix.
4. Add or update a regression test.
5. Run the full test suite.
6. If tests fail, debug and retry.
7. When tests pass, verify the original bug is gone.

After 15 iterations if not fixed:
- Create BUG-REPORT.md summarizing:
  - Root cause hypotheses
  - Steps tried
  - Logs and error messages
  - Suggestions for next human debugging steps

Output <promise>FIXED</promise> when the bug is resolved and regression test passes." \
  --max-iterations 20 \
  --completion-promise "FIXED"
```

### 5.4 Refatoração segura

```bash
/ralph-loop "Refactor [COMPONENT] for [GOAL] (e.g. readability, performance, separation of concerns).

Constraints:
- All existing tests must pass before and after each refactor step.
- No behavior changes allowed.

Per iteration checklist:
- [ ] Run tests before any change.
- [ ] Apply a small, reversible refactor step.
- [ ] Run tests again.
- [ ] If tests fail, revert or fix immediately.
- [ ] Commit or checkpoint logical units.

Output <promise>REFACTORED</promise> when all refactor goals are met and tests are passing." \
  --max-iterations 25 \
  --completion-promise "REFACTORED"
```

---

## 6. Organização de Arquivos para Loops Longos

Uma configuração prática inspirada no vídeo e nos artigos:

```text
project/
  PRD.md               # Documento de requisitos / visão do produto
  FEATURES.json        # Lista de features/tarefas + status
  LOOP_PROMPT.md       # Prompt principal usado pelo loop
  scripts/
    ralph.sh           # Script bash de loop externo
  src/                 # Código-fonte
  tests/               # Testes
  ...
```

### 6.1 PRD.md

- Explica “o que” e “por que”.
- Inclui:
  - Objetivos do produto.
  - Requisitos funcionais e não-funcionais.
  - Restrições técnicas.
  - Público-alvo, UX high level.

### 6.2 FEATURES.json (exemplo)

```json
[
  {
    "id": "auth-basic",
    "description": "Basic email/password authentication with JWT",
    "status": "pending"
  },
  {
    "id": "todos-crud",
    "description": "CRUD operations for todos with validation",
    "status": "in_progress"
  },
  {
    "id": "analytics-events",
    "description": "Track key events with analytics",
    "status": "done"
  }
]
```

Use o loop para:

- Ler `FEATURES.json`.
- Escolher a próxima feature `status = "pending"`.
- Trabalhar nela.
- Atualizar o status (`in_progress` → `done`).
- Registrar progresso em um log (ex.: `LOG.md`).

### 6.3 LOOP_PROMPT.md

Exemplo de layout:

```md
You are an AI software engineer working on this project.

Context:
- Product requirements are in PRD.md
- Task list is in FEATURES.json
- Code is in src/ and tests/ directories

Your responsibilities:
1. Read PRD.md to understand the product.
2. Read FEATURES.json and pick the highest-priority feature with status "pending" or "in_progress".
3. Plan small, incremental steps to complete that feature.
4. For each step:
   - Update or add tests.
   - Implement code changes.
   - Run tests and lint.
   - Update FEATURES.json with the current status.

Stopping criteria:
- All features have status "done", or
- You detect blocking issues and document them in BLOCKERS.md

When you have completed all features successfully, output:
<promise>DONE</promise>
```

---

## 7. Dicas para Evitar “Context Rot” e Erros Comuns

Baseado nas críticas (Vibe Coding, Better Stack, comunidade):

1. **Evite sessões gigantes**:
   - Prefira **sessions curtas + loop externo** (mata e recria o agente).
   - O que persiste é o **código e os arquivos**, não o contexto da conversa.

2. **Não confie só na memória da IA**:
   - Tudo importante precisa estar em:
     - arquivos (`PRD.md`, `FEATURES.json`),
     - testes,
     - documentação.
   - Pense como se a IA pudesse “esquecer” o chat a cada rodada.

3. **Sempre tenha um verificador automático**:
   - Testes, lint, build, scripts de health-check.
   - Coloque no prompt instruções explícitas: “se tests falharem, a tarefa não está concluída”.

4. **Use `--max-iterations` sempre** (no plugin):
   - Evita loops infinitos em tarefas impossíveis.
   - Combinado com lógica de “se não concluir até X, gera relatório de bloqueio”.

5. **Comece simples, depois adicione guardrails**:
   - Primeiros loops podem ser mais “livres”.
   - Quando ver problemas repetidos, você:
     - Ajusta o prompt,
     - Adiciona checks adicionais,
     - Melhora scripts de teste.

---

## 8. Exemplo completo de script Bash (loop externo)

```bash
#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ITERATION_LIMIT=50
ITERATION=0

cd "$PROJECT_DIR"

while :; do
  ITERATION=$((ITERATION + 1))
  echo "=== Ralph iteration $ITERATION ==="

  # Rodar testes/lint antes (opcional)
  if [ -f "package.json" ]; then
    echo "-> Running tests before iteration..."
    npm test || echo "Tests failing before iteration (may be expected at first)"
  fi

  # Chamar IA (troque 'claude' pelo seu CLI/modelo)
  claude -p "$(cat LOOP_PROMPT.md)" > .ralph_output.txt

  # Verificar promessa de conclusão
  if grep -q "<promise>DONE</promise>" .ralph_output.txt; then
    echo "Completion promise detected. Stopping loop."
    break
  fi

  # Segurança: parar após N iterações
  if [ "$ITERATION" -ge "$ITERATION_LIMIT" ]; then
    echo "Iteration limit reached ($ITERATION_LIMIT). Stopping loop."
    break
  fi

  sleep 2
done
```

---

## 9. Checklist Rápido para Você Aplicar

1. **Definir o alvo**:
   - O que exatamente o loop deve entregar? (API, feature, refactor, bugfix, UI).

2. **Criar arquivos de contexto**:
   - `PRD.md` com requisitos.
   - `FEATURES.json` com tarefas.

3. **Criar o prompt de loop**:
   - Seguindo os padrões de:
     - Critérios claros de conclusão.
     - Autocorreção (TDD, leitura de logs de falha).
     - Instruções para travamento/bloqueio.

4. **Escolher estratégia de loop**:
   - Plugin Claude (`/ralph-loop`) ou loop externo Bash.

5. **Adicionar verificação automática**:
   - `npm test`, `pnpm lint`, `pytest`, `go test`, etc, sendo sempre chamados.

6. **Configurar limites**:
   - `--max-iterations` no plugin.
   - `ITERATION_LIMIT` no bash.

7. **Rodar, observar e ajustar**:
   - Ver onde a IA se perde.
   - Documentar padrões de erro.
   - Refinar prompt / PRD / FEATURES / testes.

---

## 10. Ideias de Uso no Dia a Dia

- **Side projects**: deixar a IA implementando features enquanto você faz outras coisas.
- **Protótipos**: gerar uma primeira versão funcional de um produto (MVP) overnight.
- **Refactor grandes**: migrar partes de uma base legacy guiando por testes.
- **Explorar arquiteturas**: pedir múltiplos loops em branches/worktrees diferentes para comparar abordagens.