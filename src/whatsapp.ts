import type { Agent, Output } from './types';

const KAPSO_API_KEY = process.env.KAPSO_API_KEY!;
const KAPSO_PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID!;

const MAX_MESSAGE_LENGTH = 4000; // WhatsApp limit is ~4096

// Status emojis for agent display
const STATUS_EMOJI: Record<Agent['status'], string> = {
  idle: '⚪',
  processing: '🔵',
  error: '🔴',
};

// Output status emojis
const OUTPUT_STATUS_EMOJI: Record<Output['status'], string> = {
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

// Priority display labels
const PRIORITY_LABEL: Record<Agent['priority'], string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

/**
 * Formats a timestamp as relative time (e.g., "agora", "2min", "1h", "3d")
 */
export function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'agora';
  }
  if (diffMin < 60) {
    return `${diffMin}min`;
  }
  if (diffHour < 24) {
    return `${diffHour}h`;
  }
  if (diffDay < 7) {
    return `${diffDay}d`;
  }

  // Format as date for older timestamps
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

export async function sendWhatsAppImage(to: string, mediaId: string, caption?: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: {
          id: mediaId,
          ...(caption && { caption }),
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp image send error:', await response.text());
  }
}

export async function sendWhatsApp(to: string, text: string): Promise<void> {
  // Split long messages
  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);

  for (const chunk of chunks) {
    await sendChunk(to, chunk);
  }
}

export async function sendCommandsList(to: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: 'Comandos disponiveis:',
          },
          action: {
            button: 'Ver comandos',
            sections: [
              {
                title: 'Sessao',
                rows: [
                  {
                    id: 'cmd_reset',
                    title: '/reset',
                    description: 'Limpar sessao e iniciar nova conversa',
                  },
                  {
                    id: 'cmd_compact',
                    title: '/compact',
                    description: 'Compactar contexto da conversa',
                  },
                ],
              },
              {
                title: 'Informacoes',
                rows: [
                  {
                    id: 'cmd_help',
                    title: '/help',
                    description: 'Mostrar ajuda',
                  },
                ],
              },
            ],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

export async function sendModelSelector(to: string, messageId?: string): Promise<void> {
  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: 'Modelo:',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `model_haiku_${Date.now()}`,
              title: 'Haiku',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `model_opus_${Date.now()}`,
              title: 'Opus',
            },
          },
        ],
      },
    },
  };

  // Reply to original message if we have the ID
  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

async function sendChunk(to: string, text: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find last newline within limit
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      // No good newline, split at space
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt === -1 || splitAt < maxLength / 2) {
      // No good space, hard split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Truncates text to a maximum length, adding ellipsis if needed
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Sends an interactive list of agents with management options
 */
export async function sendAgentsList(
  to: string,
  agents: Agent[],
  messageId?: string
): Promise<void> {
  const agentRows = agents.slice(0, 10).map((agent) => {
    const emoji = STATUS_EMOJI[agent.status];
    const time = formatTimestamp(agent.lastActivity);
    const title = agent.title || 'Nova conversa';

    return {
      id: `agent_${agent.id}`,
      title: truncate(agent.name, 24),
      description: truncate(`${emoji} ${title} - ${agent.status} - ${time}`, 72),
    };
  });

  const sections: any[] = [];

  // Agents section (only if there are agents)
  if (agentRows.length > 0) {
    sections.push({
      title: '🤖 Agentes',
      rows: agentRows,
    });
  }

  // Management section
  sections.push({
    title: '➕ Gerenciar',
    rows: [
      {
        id: 'action_create_agent',
        title: 'Criar novo agente',
        description: 'Criar um agente com nome e workspace',
      },
      {
        id: 'action_configure_limit',
        title: 'Configurar execução',
        description: 'Limite de agentes simultâneos',
      },
      {
        id: 'action_configure_priority',
        title: 'Configurar prioridade',
        description: 'Alterar prioridade de um agente',
      },
    ],
  });

  // Commands section
  sections.push({
    title: '🔧 Comandos',
    rows: [
      {
        id: 'cmd_reset',
        title: '/reset',
        description: 'Limpar sessão e iniciar nova conversa',
      },
      {
        id: 'cmd_compact',
        title: '/compact',
        description: 'Compactar contexto da conversa',
      },
      {
        id: 'cmd_help',
        title: '/help',
        description: 'Mostrar ajuda',
      },
    ],
  });

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: agents.length > 0
          ? `Agentes disponíveis (${agents.length}):`
          : 'Nenhum agente criado ainda.',
      },
      action: {
        button: 'Ver opções',
        sections,
      },
    },
  };

  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Sends an interactive menu for a specific agent
 */
export async function sendAgentMenu(
  to: string,
  agent: Agent,
  messageId?: string
): Promise<void> {
  const emoji = STATUS_EMOJI[agent.status];
  const time = formatTimestamp(agent.lastActivity);
  const title = agent.title || 'Nova conversa';

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: `${emoji} *${agent.name}*\n${title}\nStatus: ${agent.status} - ${time}\nPrioridade: ${PRIORITY_LABEL[agent.priority]}`,
      },
      action: {
        button: 'Ações',
        sections: [
          {
            title: 'Ações do Agente',
            rows: [
              {
                id: `agentmenu_prompt_${agent.id}`,
                title: '💬 Enviar prompt',
                description: 'Enviar nova mensagem para este agente',
              },
              {
                id: `agentmenu_history_${agent.id}`,
                title: '📋 Ver histórico',
                description: `Últimas ${agent.outputs.length} interações`,
              },
              {
                id: `agentmenu_priority_${agent.id}`,
                title: '⚙️ Configurar prioridade',
                description: `Atual: ${PRIORITY_LABEL[agent.priority]}`,
              },
              {
                id: `agentmenu_reset_${agent.id}`,
                title: '🔄 Resetar agente',
                description: 'Limpar contexto da conversa',
              },
              {
                id: `agentmenu_delete_${agent.id}`,
                title: '🗑️ Deletar agente',
                description: 'Remover permanentemente',
              },
              {
                id: 'agentmenu_back',
                title: '⬅️ Voltar',
                description: 'Voltar para lista de agentes',
              },
            ],
          },
        ],
      },
    },
  };

  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Sends a list of recent outputs (history) for an agent
 */
export async function sendHistoryList(
  to: string,
  agentName: string,
  outputs: Output[],
  messageId?: string
): Promise<void> {
  // Take last 10 outputs, reversed (most recent first)
  const recentOutputs = outputs.slice(-10).reverse();

  const rows = recentOutputs.map((output, index) => {
    const emoji = OUTPUT_STATUS_EMOJI[output.status];
    const time = formatTimestamp(output.timestamp);
    const summary = output.summary || truncate(output.response, 30);

    return {
      id: `history_${output.id}`,
      title: truncate(`${emoji} ${summary}`, 24),
      description: truncate(`${time} - ${output.model.toUpperCase()}`, 72),
    };
  });

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: outputs.length > 0
          ? `📋 Histórico - ${agentName}\n\nÚltimas ${recentOutputs.length} interações:`
          : `📋 Histórico - ${agentName}\n\nNenhuma interação ainda.`,
      },
      action: {
        button: 'Ver histórico',
        sections: [
          {
            title: 'Interações',
            rows: rows.length > 0
              ? rows
              : [
                  {
                    id: 'history_empty',
                    title: 'Sem histórico',
                    description: 'Envie um prompt para começar',
                  },
                ],
          },
        ],
      },
    },
  };

  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Sends an error message with recovery action buttons
 */
export async function sendErrorWithActions(
  to: string,
  agentName: string,
  error: string,
  messageId?: string
): Promise<void> {
  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `❌ Erro no agente '${agentName}'\n\n${truncate(error, 500)}`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `error_retry_${Date.now()}`,
              title: 'Tentar novamente',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `error_log_${Date.now()}`,
              title: 'Ver log',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `error_ignore_${Date.now()}`,
              title: 'Ignorar',
            },
          },
        ],
      },
    },
  };

  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Sends a menu to configure the concurrent execution limit
 */
export async function sendConfigureLimitMenu(
  to: string,
  currentLimit: number,
  messageId?: string
): Promise<void> {
  const limitOptions = [
    { value: 1, label: '1 agente' },
    { value: 3, label: '3 agentes' },
    { value: 5, label: '5 agentes' },
    { value: 10, label: '10 agentes' },
    { value: 0, label: 'Sem limite' },
  ];

  const rows = limitOptions.map((option) => ({
    id: `limit_${option.value}`,
    title: option.label,
    description: option.value === currentLimit ? '✓ Atual' : '',
  }));

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: `⚙️ Configurar limite de execução\n\nLimite atual: ${currentLimit === 0 ? 'Sem limite' : `${currentLimit} agente${currentLimit > 1 ? 's' : ''}`}\n\nQuantos agentes podem executar simultaneamente?`,
      },
      action: {
        button: 'Escolher',
        sections: [
          {
            title: 'Limite de agentes',
            rows,
          },
        ],
      },
    },
  };

  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Sends a menu to configure an agent's priority
 */
export async function sendConfigurePriorityMenu(
  to: string,
  agentName: string,
  currentPriority: Agent['priority'],
  messageId?: string
): Promise<void> {
  const priorityOptions: { value: Agent['priority']; emoji: string }[] = [
    { value: 'high', emoji: '🔴' },
    { value: 'medium', emoji: '🟡' },
    { value: 'low', emoji: '🟢' },
  ];

  const rows = priorityOptions.map((option) => ({
    id: `priority_${option.value}`,
    title: `${option.emoji} ${PRIORITY_LABEL[option.value]}`,
    description: option.value === currentPriority ? '✓ Atual' : '',
  }));

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: `⚙️ Configurar prioridade\n\nAgente: ${agentName}\nPrioridade atual: ${PRIORITY_LABEL[currentPriority]}\n\nAgentes com alta prioridade são processados primeiro.`,
      },
      action: {
        button: 'Escolher',
        sections: [
          {
            title: 'Prioridade',
            rows,
          },
        ],
      },
    },
  };

  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}
