# Session System Migration

## Objetivo

Refatorar o sistema de sessões do `ClaudeTerminal` para usar `agentId` ao invés de `model`, implementar suporte a workspace, e criar fluxo de migração de sessões antigas.

## Escopo

**Incluído:**
- Modificar `ClaudeTerminal` class em `file:src/terminal.ts`
- Mudar chave de sessão: `${userId}_${model}` → `${userId}_${agentId}`
- Adicionar suporte a workspace (working directory)
- Implementar detecção de sessões antigas
- Implementar fluxo de migração (aviso + escolha do usuário)
- Atualizar método `send()` para aceitar `agentId` e `workspace`
- Testes unitários

**Explicitamente fora:**
- Lógica de AgentManager (ticket #2)
- Fila de execução (ticket #3)
- UI WhatsApp (ticket #6)
- Webhook handler (ticket #7)

## Referências de Spec

- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` - Seção 1.7 (Migração), 2 (Mudanças no Sistema Existente), 3.7 (ClaudeTerminal)
- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/7756992f-2840-44ad-88eb-b64634e0f43a` - Problema 1 (Perda de contexto ao trocar modelos)

## Mudanças no ClaudeTerminal

### 1. Mudança de Chave de Sessão

**ANTES:**
```typescript
function getSessionKey(userId: string, model: Model): string {
  return `${userId}_${model}`;
}
```

**DEPOIS:**
```typescript
function getSessionKey(userId: string, agentId: string): string {
  return `${userId}_${agentId}`;
}
```

**Impacto:**
- Sessão única por agente (não por modelo)
- Trocar modelo mantém contexto ✅
- Resolve problema principal do Epic

### 2. Suporte a Workspace

Modificar método `send()`:

```typescript
async send(
  input: string,
  model: Model,
  userId: string,
  agentId: string,
  workspace?: string
): Promise<ClaudeResponse>
```

Passar `workspace` como working directory ao Claude SDK:
- Se fornecido: usar como `cwd` na chamada ao SDK
- Se não fornecido: usar diretório atual

### 3. Atualização de Título

Integrar com `TitleExtractor`:
- Após receber response do Claude
- Extrair título usando `TitleExtractor.extract()`
- Retornar título junto com response

Modificar `ClaudeResponse`:
```typescript
type ClaudeResponse = {
  text: string
  images: string[]
  title?: string  // Novo campo
}
```

### 4. Detecção de Sessões Antigas

Adicionar método:
```typescript
detectOldSessions(userId: string): boolean {
  // Verifica se existem sessões com formato antigo
  const oldKeys = [`${userId}_haiku`, `${userId}_opus`]
  return oldKeys.some(key => sessions.has(key))
}
```

### 5. Migração de Sessões

Adicionar método:
```typescript
migrateOldSessions(userId: string): { haiku?: string; opus?: string } {
  // Retorna session IDs das sessões antigas
  const haiku = sessions.get(`${userId}_haiku`)
  const opus = sessions.get(`${userId}_opus`)
  
  // Remove sessões antigas
  sessions.delete(`${userId}_haiku`)
  sessions.delete(`${userId}_opus`)
  
  return { haiku, opus }
}
```

## Fluxo de Migração

Quando usuário envia primeiro prompt:
1. Detectar sessões antigas via `detectOldSessions()`
2. Se encontradas:
   - Enviar mensagem: "⚠️ Detectadas sessões antigas. Deseja migrar?"
   - Opções: [Migrar] [Limpar tudo] [Cancelar]
3. Se usuário escolhe "Migrar":
   - Chamar `migrateOldSessions()`
   - Criar agentes "Haiku" e "Opus" com session IDs antigas
   - Associar sessões aos novos agentes
4. Se usuário escolhe "Limpar tudo":
   - Chamar `migrateOldSessions()` (remove sessões)
   - Não criar agentes
5. Se usuário escolhe "Cancelar":
   - Manter sessões antigas (compatibilidade temporária)

## Critérios de Aceitação

- [ ] getSessionKey usa `agentId` ao invés de `model`
- [ ] Trocar modelo (Haiku ↔ Opus) mantém contexto do agente
- [ ] Workspace é passado ao Claude SDK como working directory
- [ ] TitleExtractor é usado para extrair título do response
- [ ] Título é retornado em `ClaudeResponse`
- [ ] detectOldSessions identifica sessões antigas corretamente
- [ ] migrateOldSessions retorna session IDs e remove sessões antigas
- [ ] Testes unitários passando

## Dependências

- Ticket #1 (TitleExtractor, interfaces)

## Notas de Implementação

- Workspace: passar como opção `cwd` ao Claude SDK
- Migração: implementar lógica no webhook handler (ticket #7)
- Compatibilidade: manter suporte temporário a sessões antigas até migração
- Título: incluir instrução no system prompt para Claude gerar título