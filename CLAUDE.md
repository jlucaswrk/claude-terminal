# Claude Terminal

WhatsApp como interface para múltiplos agentes Claude Code. Cada agente é uma sessão independente com contexto próprio, capaz de executar código, navegar na web e gerar arquivos.

## Arquitetura

```
                                    ┌─────────────────────────────────────────┐
                                    │              Claude Terminal            │
                                    ├─────────────────────────────────────────┤
WhatsApp ──→ Kapso ──→ Tailscale ──→│  Webhook Handler (index.ts)             │
                                    │         │                               │
                                    │         ▼                               │
                                    │  UserContextManager ←→ AgentManager     │
                                    │  (multi-step flows)    (CRUD, state)    │
                                    │         │                               │
                                    │         ▼                               │
                                    │  QueueManager ←→ Semaphore              │
                                    │  (priority queue)  (concurrency)        │
                                    │         │                               │
                                    │         ▼                               │
                                    │  ClaudeTerminal (SDK sessions)          │
                                    │         │                               │
                                    │         ├──→ MCP Servers                │
                                    │         │    (firecrawl, browser, auggie)│
                                    │         │                               │
                                    │         ▼                               │
                                    │  Storage (Kapso Media)                  │
                                    │  (upload de arquivos gerados)           │
                                    └─────────────────────────────────────────┘
                                              │
WhatsApp ←── Kapso ←──────────────────────────┘
   (texto, imagens, documentos)
```

## Funcionalidades

### Agentes Inteligentes

Cada agente é uma sessão Claude independente com:
- **Nome**: identificador do usuário (ex: "API Backend", "Frontend")
- **Workspace**: diretório de trabalho opcional para projetos específicos
- **Sessão persistente**: contexto mantido entre mensagens
- **Prioridade**: high/medium/low para ordenação na fila
- **Status**: idle/processing/error com detalhes
- **Histórico**: últimas 10 interações com prompt/resposta

### Ferramentas Disponíveis

Os agentes têm acesso a:
- **Bash**: execução de comandos no terminal
- **Read/Write/Edit**: manipulação de arquivos
- **Glob/Grep**: busca em arquivos e diretórios

### MCP Servers Integrados

- **Firecrawl**: scraping e crawling de websites
- **Browser MCP**: automação de navegador (screenshots, interação)
- **Auggie**: integração com Augment para contexto de código

### Envio de Mídia

O sistema detecta e envia automaticamente:
- **Screenshots**: capturados de ferramentas de browser
- **Arquivos gerados**: planilhas, PDFs, documentos, código
- Formatos suportados: xlsx, csv, pdf, docx, txt, json, imagens, etc.

### Fila com Prioridade

Tasks são ordenadas por:
1. Prioridade (high=0, medium=1, low=2)
2. Timestamp (FIFO dentro da mesma prioridade)

### Controle de Concorrência

O `Semaphore` limita execuções simultâneas:
- **Modo limitado**: 1-N permits configuráveis
- **Modo ilimitado**: maxPermits=0 desabilita limite

### Fluxos Conversacionais

O `UserContextManager` rastreia estados multi-step:
- Criação de agente (nome → workspace → confirmação)
- Configuração de prioridade
- Configuração de limite de concorrência
- Deleção de agente com confirmação

## Estrutura

```
src/
├── index.ts              # Servidor HTTP, webhook handler, orquestração
├── types.ts              # Tipos e interfaces do sistema
├── agent-manager.ts      # CRUD de agentes, persistência, estado
├── queue-manager.ts      # Fila prioritária, processamento de tasks
├── semaphore.ts          # Controle de concorrência (bounded/unbounded)
├── terminal.ts           # Wrapper do Claude SDK com sessões e detecção de arquivos
├── user-context-manager.ts  # Estado conversacional multi-step
├── whatsapp.ts           # Cliente Kapso (menus interativos, botões, mídia)
├── persistence.ts        # Serialização/deserialização de estado
├── storage.ts            # Upload de arquivos para Kapso Media Storage
└── title-extractor.ts    # Extração de títulos de respostas
```

## Interface WhatsApp

### Comandos

| Comando | Descrição |
|---------|-----------|
| `/` | Menu principal (lista agentes e ações) |
| `/reset` | Limpar sessão de um ou todos os agentes |
| `/compact` | Compactar contexto da conversa |
| `/help` | Mostrar ajuda |

### Fluxo de Uso

1. **Primeiro uso**: envie qualquer mensagem → agente "General" criado automaticamente
2. **Enviar prompt**: digite mensagem → selecione agente → escolha modelo (Haiku/Sonnet/Opus)
3. **Gerenciar**: use `/` para criar agentes, configurar prioridades, ver histórico

### Menus Interativos

- Lista de agentes com status e última ação (ex: "Criou 3 arquivos")
- Menu de ações por agente (prompt, histórico, prioridade, reset, deletar)
- Seletor de modelo (Haiku/Sonnet/Opus)
- Confirmações para ações destrutivas

### Updates de Progresso

Durante o processamento, o sistema envia atualizações a cada 30 segundos:
- Formato: `🔧 Agente X: Lendo arquivo.ts... (45s)`
- Mostra qual ferramenta está sendo usada
- Inclui tempo decorrido desde o início

## Modelos de Dados

```typescript
interface Agent {
  id: string;
  userId: string;           // Telefone do usuário
  name: string;
  workspace?: string;       // Diretório de trabalho
  sessionId?: string;       // ID da sessão Claude SDK
  title: string;            // Título auto-gerado
  status: 'idle' | 'processing' | 'error';
  statusDetails: string;    // Última ação realizada (ex: "Criou 3 arquivos")
  priority: 'high' | 'medium' | 'low';
  messageCount: number;
  outputs: Output[];        // Últimas 10 respostas
  lastActivity: Date;
  createdAt: Date;
}

interface Output {
  id: string;
  summary: string;          // Resumo da ação
  prompt: string;           // Prompt original
  response: string;         // Resposta completa
  model: 'haiku' | 'sonnet' | 'opus';
  status: 'success' | 'warning' | 'error';
  timestamp: Date;
}

interface CreatedFile {
  path: string;             // Caminho do arquivo criado
  mediaId: string;          // ID no Kapso Media Storage
  filename: string;         // Nome do arquivo
  mimeType: string;         // Tipo MIME
  mediaType: 'image' | 'video' | 'audio' | 'document';
}
```

## Setup

```bash
# Instalar dependências
bun install

# Desenvolvimento (hot reload)
bun run dev

# Produção
bun run start

# Testes
bun test
```

### Variáveis de Ambiente

```env
KAPSO_API_KEY=xxx              # API key do Kapso
KAPSO_PHONE_NUMBER_ID=xxx      # ID do telefone no Kapso
KAPSO_WEBHOOK_SECRET=xxx       # Token de verificação do webhook
USER_PHONE_NUMBER=xxx          # Telefone autorizado (ex: +5581999999999)
```

### Expor Servidor

```bash
tailscale funnel 3000
```

Configurar URL do funnel como webhook no Kapso.

## Fluxo de Mensagem

```
1. Webhook recebe mensagem do WhatsApp via Kapso
2. Valida origem (apenas USER_PHONE_NUMBER autorizado)
3. UserContextManager verifica se há fluxo em andamento
   - Se sim: processa step do fluxo
   - Se não: interpreta como prompt ou comando
4. Se for prompt:
   - Usuário seleciona agente e modelo
   - QueueManager enfileira task com prioridade
   - Semaphore controla concorrência
   - ClaudeTerminal executa via SDK
   - Detecta arquivos criados (Write tool)
   - Upload de arquivos para Kapso Media
5. Envia resposta via WhatsApp:
   - Screenshots (se houver)
   - Texto da resposta
   - Arquivos gerados (documentos, planilhas, etc.)
6. AgentManager atualiza e persiste estado
```

## Fluxo de Arquivos

```
Claude usa Write tool para criar arquivo
           ↓
terminal.ts detecta evento tool_use
           ↓
Após execução, verifica se arquivo existe
           ↓
storage.ts faz upload para Kapso Media
           ↓
queue-manager.ts envia via WhatsApp
           ↓
Usuário recebe documento no chat
```

### MIME Types Suportados

| Extensão | Tipo | WhatsApp Media Type |
|----------|------|---------------------|
| .xlsx, .xls | Planilhas | document |
| .pdf | PDF | document |
| .docx, .doc | Word | document |
| .csv, .txt, .json | Texto | document |
| .png, .jpg, .gif | Imagens | image |
| .mp4, .webm | Vídeo | video |
| .mp3, .wav | Áudio | audio |

## Recuperação de Erros

- **Crash recovery**: agentes em 'processing' são resetados para 'idle' no startup
- **Error recovery**: botões de retry/ignorar quando um prompt falha
- **Backup de estado**: arquivo .bak para recuperação de corrupção

## Testes

263 testes cobrindo:
- `agent-manager.test.ts`: CRUD, persistência, outputs
- `queue-manager.test.ts`: prioridade, processamento, erros
- `semaphore.test.ts`: permits, blocking, unbounded mode
- `terminal.test.ts`: sessões, modelos, workspaces
- `user-context-manager.test.ts`: fluxos multi-step
- `whatsapp.test.ts`: menus interativos, formatação
- `persistence.test.ts`: serialização, backup, recovery
- `index.test.ts`: integração de fluxos completos
