# Claude Terminal

WhatsApp como terminal para o Claude Code. Envia mensagem, recebe resposta. Simples assim.

## Contexto

Este projeto nasceu de uma necessidade: controlar o Claude Code rodando no Mac local via WhatsApp, como um terminal remoto puro - não um assistente elaborado.

Inspirado no [Telminal](https://github.com/fristhon/telminal) que faz isso para Telegram.

## Arquitetura

```
WhatsApp → Kapso → Tailscale Funnel → Servidor local → Claude Code CLI
                                                             ↓
WhatsApp ← Kapso ← ──────────────────────────────── Output ──┘
```

**Decisões importantes:**
- **Tailscale Funnel** em vez de ngrok (URL fixa, mais estável)
- **Sem banco de dados** - é um terminal, não precisa persistir
- **Sem filas** - um processo Claude por vez
- **Kapso** para WhatsApp API (já estava configurado)

## Comandos

```bash
bun install          # Instalar dependências
bun run dev          # Rodar com hot reload
bun run start        # Produção
```

## Setup

1. Copiar `.env.example` para `.env` e preencher
2. Rodar `tailscale funnel 3000` para expor localmente
3. Configurar webhook do Kapso para a URL do Tailscale Funnel
4. Iniciar servidor: `bun run dev`

## Estrutura

```
src/
├── index.ts      # Servidor HTTP, handler do webhook Kapso
├── terminal.ts   # Wrapper do processo Claude Code CLI
└── whatsapp.ts   # Cliente da API do Kapso
```

## TODO

- [ ] Testar integração Kapso com Tailscale Funnel
- [ ] Ajustar timeout do terminal.ts para comandos longos
- [ ] Adicionar comando especial para matar/reiniciar Claude
- [ ] Suporte a envio de arquivos (screenshots, logs)
