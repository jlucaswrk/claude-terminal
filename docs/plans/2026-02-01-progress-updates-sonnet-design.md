# Design: Progress Updates, Sonnet Model, e Última Ação

Data: 2026-02-01

## Resumo

Três funcionalidades novas para o Claude Terminal:

1. **Updates de progresso a cada 30s** - Notificar o usuário periodicamente sobre o que o agente está fazendo
2. **Modelo Sonnet** - Adicionar terceira opção de modelo além de Haiku e Opus
3. **Descrição = última ação** - Mostrar última ação do agente no menu em vez do primeiro prompt

---

## 1. Updates de Progresso

### Comportamento

- Durante processamento, enviar mensagem a cada 30 segundos
- Formato: `🔧 Agente X: [ação atual] (Xs)`
- Capturar qual tool está sendo usada via eventos do SDK
- Parar timer quando terminar (success ou error)

### Implementação

**terminal.ts:**
- Adicionar callback opcional `onProgress` no método `send()`
- Capturar eventos `tool_use` do stream e chamar callback
- Passar nome da tool e input resumido

**queue-manager.ts:**
- Iniciar `setInterval` de 30s ao começar processamento
- Armazenar última ação detectada
- Enviar mensagem WhatsApp com status atual
- Limpar interval no finally

### Exemplo de Output

```
🔧 General: Lendo arquivo src/index.ts... (32s)
🔧 General: Executando npm test... (1m 15s)
🔧 General: Escrevendo arquivo api.ts... (2m 03s)
```

---

## 2. Modelo Sonnet

### Implementação

**terminal.ts:**
```typescript
export type Model = 'haiku' | 'sonnet' | 'opus';
```

**types.ts:**
```typescript
model: 'haiku' | 'sonnet' | 'opus';  // Em Output e SerializedOutput
```

**whatsapp.ts - sendModelSelector():**
- Adicionar terceiro botão "Sonnet"

**whatsapp.ts - sendAgentWithModelSelector():**
- Adicionar opções com Sonnet para cada agente

---

## 3. Descrição = Última Ação

### Comportamento

- Após processar prompt, gerar resumo das ações realizadas
- Exemplos: "Criou 3 arquivos", "Rodou npm test", "Leu 5 arquivos"
- Salvar no campo `statusDetails` do agente
- Mostrar no menu de agentes

### Implementação

**terminal.ts:**
- Retornar lista de tools usadas no `ClaudeResponse`
- Incluir contagem por tipo de tool

**queue-manager.ts:**
- Gerar resumo a partir das tools usadas
- Atualizar `statusDetails` com o resumo após sucesso

**whatsapp.ts:**
- `sendAgentsList()`: Mostrar `statusDetails` na description
- `sendAgentMenu()`: Mostrar `statusDetails` no body

### Lógica de Resumo

```typescript
function generateActionSummary(tools: ToolUsage[]): string {
  const writes = tools.filter(t => t.name === 'Write').length;
  const reads = tools.filter(t => t.name === 'Read').length;
  const bashes = tools.filter(t => t.name === 'Bash').length;

  if (writes > 0) return `Criou ${writes} arquivo${writes > 1 ? 's' : ''}`;
  if (bashes > 0) return `Executou ${bashes} comando${bashes > 1 ? 's' : ''}`;
  if (reads > 0) return `Leu ${reads} arquivo${reads > 1 ? 's' : ''}`;
  return 'Processou prompt';
}
```

---

## Arquivos a Modificar

1. `src/terminal.ts` - Callback de progresso, retornar tools usadas
2. `src/types.ts` - Adicionar 'sonnet' ao tipo Model
3. `src/queue-manager.ts` - Timer de 30s, gerar resumo de ação
4. `src/whatsapp.ts` - Botão Sonnet, mostrar statusDetails

---

## Ordem de Implementação

1. Adicionar Sonnet (mais simples, mudança pontual)
2. Descrição = última ação (depende de capturar tools)
3. Updates de progresso (mais complexo, usa mesma captura de tools)
