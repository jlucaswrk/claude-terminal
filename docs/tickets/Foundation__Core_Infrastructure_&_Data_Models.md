# Foundation: Core Infrastructure & Data Models

## Objetivo

Implementar a infraestrutura base e modelos de dados que servirão de fundação para todo o sistema multi-agente.

## Escopo

**Incluído:**
- Implementar `Semaphore` class para controle de concorrência
- Implementar `PersistenceService` para salvar/carregar JSON
- Definir todas as interfaces TypeScript (Agent, Output, UserContext, QueueTask, SystemConfig)
- Implementar `TitleExtractor` para parsing de títulos
- Criar arquivo `agents-state.json` com schema versionado
- Testes unitários para Semaphore e PersistenceService

**Explicitamente fora:**
- Lógica de negócio de agentes (ticket #2)
- Fila de execução (ticket #3)
- Estado conversacional (ticket #4)
- Integração com WhatsApp (ticket #6)

## Referências de Spec

- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` - Seção 1.3 (Semaphore), 2 (Data Model), 3.3 (Semaphore), 3.5 (PersistenceService), 3.6 (TitleExtractor)

## Componentes

### 1. Semaphore Class

```typescript
class Semaphore {
  constructor(permits: number)
  async acquire(): Promise<void>
  release(): void
  availablePermits(): number
}
```

**Comportamento:**
- Controla número de permits disponíveis
- Bloqueia (await) quando permits = 0
- Resolve Promises em ordem FIFO quando permits liberados

### 2. PersistenceService Class

```typescript
class PersistenceService {
  save(state: { config: SystemConfig; agents: Agent[] }): void
  load(): { config: SystemConfig; agents: Agent[] } | null
  detectOldSessions(): boolean
  migrateOldSessions(): void
}
```

**Comportamento:**
- Salva em `./agents-state.json`
- Cria backup `.bak` antes de sobrescrever
- Valida schema ao carregar
- Fallback para backup se JSON corrompido

### 3. TypeScript Interfaces

Definir em arquivo separado (ex: `types.ts`):
- `Agent`
- `Output`
- `UserContext`
- `QueueTask`
- `SystemConfig`

Conforme especificado em `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` seção 2.

### 4. TitleExtractor Class

```typescript
class TitleExtractor {
  extract(response: string, prompt: string): string
}
```

**Comportamento:**
- Procura por `[TITLE: ...]` no response
- Fallback: primeiras 5 palavras do prompt
- Retorna string limpa (sem marcadores)

## Critérios de Aceitação

- [ ] Semaphore implementado e testado (concorrência, FIFO)
- [ ] PersistenceService salva e carrega JSON corretamente
- [ ] Backup criado antes de sobrescrever
- [ ] Validação de schema funciona
- [ ] Todas as interfaces TypeScript definidas
- [ ] TitleExtractor extrai título do response
- [ ] TitleExtractor usa fallback quando parsing falha
- [ ] Testes unitários passando (Semaphore, PersistenceService, TitleExtractor)

## Dependências

Nenhuma (ticket foundation)

## Notas de Implementação

- Semaphore: usar Promise queue para aguardar permits
- PersistenceService: usar `Bun.write` para I/O
- TitleExtractor: regex para `\[TITLE:\s*([^\]]+)\]`
- Validação de schema: verificar `version` e campos obrigatórios