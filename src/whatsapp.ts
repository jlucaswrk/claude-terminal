import type { Agent, Output } from './types';

const KAPSO_API_KEY = process.env.KAPSO_API_KEY!;
const KAPSO_PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID!;

const MAX_MESSAGE_LENGTH = 4000; // WhatsApp limit is ~4096

// Status emojis for agent display
const STATUS_EMOJI: Record<Agent['status'], string> = {
  idle: '⚪',
  processing: '🔵',
  error: '🔴',
  'ralph-loop': '🔄',
  'ralph-paused': '⏸️',
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

export async function sendWhatsAppDocument(to: string, mediaId: string, filename: string, caption?: string): Promise<void> {
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
        type: 'document',
        document: {
          id: mediaId,
          filename,
          ...(caption && { caption }),
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp document send error:', await response.text());
  }
}

export async function sendWhatsAppMedia(
  to: string,
  mediaId: string,
  mediaType: 'image' | 'video' | 'audio' | 'document',
  filename?: string,
  caption?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: mediaType,
  };

  if (mediaType === 'document') {
    body.document = {
      id: mediaId,
      ...(filename && { filename }),
      ...(caption && { caption }),
    };
  } else if (mediaType === 'image') {
    body.image = {
      id: mediaId,
      ...(caption && { caption }),
    };
  } else if (mediaType === 'video') {
    body.video = {
      id: mediaId,
      ...(caption && { caption }),
    };
  } else if (mediaType === 'audio') {
    body.audio = {
      id: mediaId,
    };
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
    console.error(`WhatsApp ${mediaType} send error:`, await response.text());
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
        text: 'Selecione um modelo para executar essa task:',
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
              id: `model_sonnet_${Date.now()}`,
              title: 'Sonnet',
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

/**
 * Sends an interactive list of agents with model selection (Haiku/Opus for each agent)
 */
/**
 * Sends a "Continue with last choice" button for quick repeat interactions
 */
export async function sendContinueWithLastChoice(
  to: string,
  agentName: string,
  model: string,
  messageId?: string
): Promise<void> {
  const modelDisplay = model.charAt(0).toUpperCase() + model.slice(1);

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `Ou continuar com última escolha:`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `continue_last_choice_${Date.now()}`,
              title: `${agentName} (${modelDisplay})`,
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

export async function sendAgentSelector(
  to: string,
  agents: Agent[],
  messageId?: string
): Promise<void> {
  // Max 10 agents to fit WhatsApp's row limit
  const agentRows = agents.slice(0, 10).map((agent) => {
    const agentEmoji = agent.emoji || '🤖';
    const statusEmoji = STATUS_EMOJI[agent.status];
    const time = formatTimestamp(agent.lastActivity);

    return {
      id: `selectagent_${agent.id}`,
      title: truncate(`${agentEmoji} ${agent.name}`, 24),
      description: truncate(`${statusEmoji} ${agent.status} - ${time}`, 72),
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
        text: '1️⃣ Selecione o agente:',
      },
      action: {
        button: 'Escolher agente',
        sections: [
          {
            title: '🤖 Agentes',
            rows: agentRows,
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

export async function sendModelSelectorList(
  to: string,
  agentName: string,
  messageId?: string
): Promise<void> {
  const modelRows = [
    {
      id: 'selectmodel_haiku',
      title: '⚡ Haiku',
      description: 'Rápido e econômico',
    },
    {
      id: 'selectmodel_sonnet',
      title: '🎭 Sonnet',
      description: 'Equilibrado',
    },
    {
      id: 'selectmodel_opus',
      title: '🎼 Opus',
      description: 'Mais capaz e detalhado',
    },
  ];

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: `2️⃣ Selecione o modelo para *${agentName}*:`,
      },
      action: {
        button: 'Escolher modelo',
        sections: [
          {
            title: '🧠 Modelos',
            rows: modelRows,
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
// Ralph loop status emoji
const RALPH_STATUS_EMOJI: Record<string, string> = {
  'ralph-loop': '🔄',
  'ralph-paused': '⏸️',
};

export async function sendAgentsList(
  to: string,
  agents: Agent[],
  messageId?: string,
  bashModeEnabled?: boolean
): Promise<void> {
  // WhatsApp limit: max 10 rows total across all sections
  // Reserve 3 rows for management (create + delete + bash mode)
  // So max 7 agents can be shown
  const maxAgents = Math.min(agents.length, 7);
  const agentRows = agents.slice(0, maxAgents).map((agent) => {
    const agentEmoji = agent.emoji || (agent.type === 'bash' ? '🖥️' : '🤖');
    const statusEmoji = RALPH_STATUS_EMOJI[agent.status] || STATUS_EMOJI[agent.status] || '⚪';
    const time = formatTimestamp(agent.lastActivity);

    // Show Ralph loop status if in Ralph mode
    let lastAction = agent.statusDetails || 'Aguardando prompt';
    if (agent.status === 'ralph-loop' || agent.status === 'ralph-paused') {
      const loopStatus = agent.status === 'ralph-loop' ? 'Loop ativo' : 'Loop pausado';
      lastAction = `${loopStatus} - ${lastAction}`;
    }

    return {
      id: `agent_${agent.id}`,
      title: truncate(`${agentEmoji} ${agent.name}`, 24),
      description: truncate(`${statusEmoji} ${lastAction} - ${time}`, 72),
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

  // Management section - condensed to fit WhatsApp's 10 row limit
  const bashStatus = bashModeEnabled ? '🟢 ON' : '⚪ OFF';
  const managementRows = [
    {
      id: 'action_create_agent',
      title: '➕ Criar agente',
      description: 'Novo agente com emoji e workspace',
    },
    {
      id: 'action_toggle_bash',
      title: `🖥️ Modo Bash: ${bashStatus}`,
      description: bashModeEnabled ? 'Clique para desativar' : 'Clique para ativar',
    },
  ];

  // Only show delete option if there are agents
  if (agentRows.length > 0) {
    managementRows.push({
      id: 'action_delete_agents',
      title: '🗑️ Remover agentes',
      description: 'Deletar um ou todos',
    });
  }

  sections.push({
    title: '⚙️ Gerenciar',
    rows: managementRows,
  });

  // Note: Commands like /reset, /help are accessible via text
  // Removed from menu to respect WhatsApp's 10 row limit

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
  const statusEmoji = STATUS_EMOJI[agent.status] || '⚪';
  const agentEmoji = agent.emoji || '🤖';
  const time = formatTimestamp(agent.lastActivity);
  const lastAction = agent.statusDetails || 'Aguardando prompt';

  // Check if agent is in Ralph mode
  const isInRalphLoop = agent.status === 'ralph-loop' || agent.status === 'ralph-paused';
  const modeLabel = agent.mode === 'ralph' ? '🔄 Ralph' : '💬 Conversacional';

  // Build menu rows based on agent state
  const rows: Array<{ id: string; title: string; description: string }> = [];

  if (isInRalphLoop) {
    // Ralph loop is active - show loop controls
    if (agent.status === 'ralph-loop') {
      rows.push({
        id: `agentmenu_pause_loop_${agent.id}`,
        title: '⏸️ Pausar Loop',
        description: 'Pausar execução do loop',
      });
    } else if (agent.status === 'ralph-paused') {
      rows.push({
        id: `agentmenu_resume_loop_${agent.id}`,
        title: '▶️ Retomar Loop',
        description: 'Continuar execução do loop',
      });
    }
    rows.push({
      id: `agentmenu_cancel_loop_${agent.id}`,
      title: '⏹️ Cancelar Loop',
      description: 'Parar loop permanentemente',
    });
  } else {
    // Normal state - show prompt option
    rows.push({
      id: `agentmenu_prompt_${agent.id}`,
      title: '💬 Enviar prompt',
      description: 'Enviar nova mensagem para este agente',
    });
  }

  // Common actions
  rows.push(
    {
      id: `agentmenu_mode_${agent.id}`,
      title: '🔧 Alterar modo',
      description: `Atual: ${modeLabel}`,
    },
    {
      id: `agentmenu_history_${agent.id}`,
      title: '📋 Ver histórico',
      description: `Últimas ${agent.outputs.length} interações`,
    },
    {
      id: `agentmenu_emoji_${agent.id}`,
      title: '🎨 Alterar emoji',
      description: `Atual: ${agentEmoji}`,
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
    }
  );

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: `${agentEmoji} *${agent.name}*\n${statusEmoji} ${lastAction}\nStatus: ${agent.status} - ${time}\nModo: ${modeLabel}\nPrioridade: ${PRIORITY_LABEL[agent.priority]}`,
      },
      action: {
        button: 'Ações',
        sections: [
          {
            title: 'Ações do Agente',
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
          ? `📋 Histórico - *${agentName}*\n\nÚltimas ${recentOutputs.length} interações:`
          : `📋 Histórico - *${agentName}*\n\nNenhuma interação ainda.`,
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
        text: `❌ Erro no agente *${agentName}*\n\n${truncate(error, 500)}`,
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

  // currentLimit of 0 means unbounded/unlimited
  const currentLimitDisplay = currentLimit === 0
    ? 'Sem limite'
    : `${currentLimit} agente${currentLimit > 1 ? 's' : ''}`;

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
        text: `⚙️ Configurar limite de execução\n\nLimite atual: ${currentLimitDisplay}\n\nQuantos agentes podem executar simultaneamente?`,
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
        text: `⚙️ Configurar prioridade\n\nAgente: *${agentName}*\nPrioridade atual: ${PRIORITY_LABEL[currentPriority]}\n\nAgentes com alta prioridade são processados primeiro.`,
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

/**
 * Sends a confirmation message with action buttons
 */
export async function sendConfirmation(
  to: string,
  message: string,
  buttons: Array<{ id: string; title: string }>,
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
        text: message,
      },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title,
          },
        })),
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
 * Sends session migration options
 */
export async function sendMigrationOptions(to: string): Promise<void> {
  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: 'Deseja migrar as sessões antigas para o novo sistema multi-agente?\n\nIsso criará agentes separados para suas conversas Haiku e Opus existentes.',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'migration_migrate',
              title: 'Migrar',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'migration_clear',
              title: 'Limpar tudo',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'migration_cancel',
              title: 'Cancelar',
            },
          },
        ],
      },
    },
  };

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
 * Sends generic buttons
 */
export async function sendButtons(
  to: string,
  message: string,
  buttons: Array<{ id: string; title: string }>,
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
        text: message,
      },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title,
          },
        })),
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
 * Sends agent selection list for reset with "All" option
 */
export async function sendAgentSelectionForReset(
  to: string,
  agents: Agent[],
  messageId?: string
): Promise<void> {
  const agentRows = agents.slice(0, 9).map((agent) => {
    const emoji = STATUS_EMOJI[agent.status];
    const time = formatTimestamp(agent.lastActivity);

    return {
      id: `reset_${agent.id}`,
      title: truncate(agent.name, 24),
      description: truncate(`${emoji} ${agent.status} - ${time}`, 72),
    };
  });

  // Add "Reset all" option
  const rows = [
    {
      id: 'reset_all',
      title: '🔄 Todos os agentes',
      description: 'Limpar todas as sessões',
    },
    ...agentRows,
  ];

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: '🔄 Resetar sessão\n\nEscolha qual agente deseja resetar:',
      },
      action: {
        button: 'Escolher',
        sections: [
          {
            title: 'Agentes',
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
 * Sends agent selection list for delete with "All" option
 */
export async function sendAgentSelectionForDelete(
  to: string,
  agents: Agent[],
  messageId?: string
): Promise<void> {
  const agentRows = agents.slice(0, 9).map((agent) => {
    const emoji = STATUS_EMOJI[agent.status];
    const time = formatTimestamp(agent.lastActivity);

    return {
      id: `delete_${agent.id}`,
      title: truncate(agent.name, 24),
      description: truncate(`${emoji} ${agent.status} - ${time}`, 72),
    };
  });

  // Add "Delete all" option
  const rows = [
    {
      id: 'delete_all',
      title: '🗑️ Todos os agentes',
      description: 'Remover todos permanentemente',
    },
    ...agentRows,
  ];

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: '🗑️ Remover agente(s)\n\nEscolha qual agente deseja remover:',
      },
      action: {
        button: 'Escolher',
        sections: [
          {
            title: 'Agentes',
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
 * Sends emoji selector list for agent creation
 */
export async function sendEmojiSelector(
  to: string,
  messageId?: string
): Promise<void> {
  const emojis = [
    { emoji: '🤖', key: 'robo', label: 'Robô' },
    { emoji: '🔧', key: 'ferramentas', label: 'Ferramentas' },
    { emoji: '📊', key: 'graficos', label: 'Gráficos' },
    { emoji: '💡', key: 'ideia', label: 'Ideia' },
    { emoji: '🎯', key: 'alvo', label: 'Alvo' },
    { emoji: '📝', key: 'notas', label: 'Notas' },
    { emoji: '🚀', key: 'foguete', label: 'Foguete' },
    { emoji: '⚡', key: 'raio', label: 'Raio' },
    { emoji: '🔍', key: 'busca', label: 'Busca' },
    { emoji: '💻', key: 'computador', label: 'Computador' },
  ];

  const rows = emojis.map((e) => ({
    id: `emoji_${e.key}`,
    title: `${e.emoji} ${e.label}`,
    description: '',
  }));

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: '🎨 Escolha um emoji para o agente:\n\n_Você pode alterar depois nas configurações do agente._',
      },
      action: {
        button: 'Escolher emoji',
        sections: [
          {
            title: 'Emojis',
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
 * Sends workspace selector list for agent creation
 */
export async function sendWorkspaceSelector(
  to: string,
  messageId?: string
): Promise<void> {
  const homeDir = process.env.HOME || '/Users/lucas';

  const options = [
    { id: 'workspace_home', title: '🏠 Home', description: homeDir },
    { id: 'workspace_desktop', title: '🖥️ Mesa', description: `${homeDir}/Desktop` },
    { id: 'workspace_documents', title: '📄 Documentos', description: `${homeDir}/Documents` },
    { id: 'workspace_custom', title: '✏️ Caminho customizado', description: 'Inserir manualmente' },
    { id: 'workspace_skip', title: '⏭️ Pular', description: 'Sem workspace' },
  ];

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: '📁 Workspace do agente\n\nEscolha onde o agente vai trabalhar:',
      },
      action: {
        button: 'Escolher',
        sections: [
          {
            title: 'Opções',
            rows: options,
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
 * Sends action options for a history output item
 */
export async function sendOutputActions(
  to: string,
  agentId: string,
  output: Output,
  messageId?: string
): Promise<void> {
  const emoji = OUTPUT_STATUS_EMOJI[output.status];
  const time = formatTimestamp(output.timestamp);
  const summary = output.summary || truncate(output.response, 50);

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: `${emoji} ${summary}\n\nModelo: ${output.model.toUpperCase()}\nData: ${time}`,
      },
      action: {
        button: 'Ações',
        sections: [
          {
            title: 'Opções',
            rows: [
              {
                id: `outputaction_details_${agentId}_${output.id}`,
                title: '📄 Ver detalhes',
                description: 'Prompt e resposta completos',
              },
              {
                id: `outputaction_reexecute_${agentId}_${output.id}`,
                title: '🔄 Reexecutar',
                description: 'Executar o prompt novamente',
              },
              {
                id: `outputaction_back_${agentId}_${output.id}`,
                title: '⬅️ Voltar',
                description: 'Voltar para o histórico',
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
 * Sends agent type selector list for agent creation
 */
export async function sendAgentTypeSelector(
  to: string,
  messageId?: string
): Promise<void> {
  const options = [
    {
      id: 'agenttype_claude',
      title: '🤖 Claude Code',
      description: 'IA com ferramentas (bash, arquivos, web)',
    },
    {
      id: 'agenttype_bash',
      title: '🖥️ Bash',
      description: 'Terminal direto, sem IA',
    },
  ];

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: '🔧 Tipo de agente\n\nEscolha o tipo do novo agente:',
      },
      action: {
        button: 'Escolher tipo',
        sections: [
          {
            title: 'Tipos',
            rows: options,
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
 * Sends bash mode status message with toggle button
 */
/**
 * Sends transcription error with "describe manually" fallback button
 */
export async function sendTranscriptionError(
  to: string,
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
        text: '❌ Não consegui entender o áudio.\n\nO áudio pode estar muito baixo, com ruído, ou em um formato não suportado.',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `transcription_manual_${Date.now()}`,
              title: 'Descrever manualmente',
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

export async function sendBashModeStatus(
  to: string,
  isEnabled: boolean,
  messageId?: string
): Promise<void> {
  const status = isEnabled ? 'ON' : 'OFF';
  const emoji = isEnabled ? '🟢' : '⚪';
  const action = isEnabled ? 'Desativar' : 'Ativar';

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🖥️ *Modo Bash: ${emoji} ${status}*\n\nQuando ativo, todas as mensagens são executadas como comandos no terminal.\n\nDica: Use \`$ comando\` para executar bash sem ativar o modo.`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: isEnabled ? 'bashmode_disable' : 'bashmode_enable',
              title: action,
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

// =============================================================================
// Ralph Mode UI Functions
// =============================================================================

/**
 * Sends mode selector buttons for an agent (Conversational vs Ralph Loop)
 */
export async function sendModeSelector(
  to: string,
  agentName: string,
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
        text: `🔧 Modo de execução para *${agentName}*:\n\n• *Conversacional*: Responde a cada prompt individualmente\n• *Ralph Loop*: Executa tarefas autonomamente em loop`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `mode_conversational_${Date.now()}`,
              title: 'Conversacional',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `mode_ralph_${Date.now()}`,
              title: 'Ralph Loop',
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
 * Sends max iterations selector for Ralph configuration
 */
export async function sendRalphIterationsSelector(
  to: string,
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
        text: '🔄 *Configurar Ralph Loop*\n\nQuantas iterações no máximo?\n\n_O agente pode terminar antes se completar a tarefa._',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'ralph_iterations_20',
              title: '20',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'ralph_iterations_50',
              title: '50',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'ralph_iterations_100',
              title: '100',
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
 * Sends the complete Ralph configuration flow:
 * Shows the task being configured plus the 20/50/100 iteration buttons
 */
export async function sendRalphConfigFlow(
  to: string,
  task: string,
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
        text: `🔄 *Configurar Ralph Loop*\n\n📝 *Tarefa:*\n${truncate(task, 300)}\n\nQuantas iterações no máximo?\n\n_O agente pode terminar antes se completar a tarefa._`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'ralph_iterations_20',
              title: '20',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'ralph_iterations_50',
              title: '50',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'ralph_iterations_100',
              title: '100',
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
 * Sends Ralph loop progress notification
 */
export async function sendLoopProgress(
  to: string,
  agentName: string,
  iteration: number,
  maxIterations: number,
  action: string,
  model: 'haiku' | 'sonnet' | 'opus'
): Promise<void> {
  const progress = Math.round((iteration / maxIterations) * 100);
  const progressBar = generateProgressBar(progress);

  const text = `🔄 *${agentName}* - Ralph Loop\n\n` +
    `${progressBar} ${progress}% ${iteration}/${maxIterations}\n\n` +
    `${truncate(action, 200)}`;

  await sendWhatsApp(to, text);
}

/**
 * Sends Ralph loop completion notification with summary
 */
export async function sendLoopComplete(
  to: string,
  agentName: string,
  iterationsUsed: number,
  maxIterations: number,
  summary: string,
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
        text: `✅ *${agentName}* - Loop Completo!\n\n` +
          `Iterações: ${iterationsUsed}/${maxIterations}\n\n` +
          `*Resumo:*\n${truncate(summary, 500)}`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `ralph_details_${Date.now()}`,
              title: 'Ver detalhes',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `ralph_restart_${Date.now()}`,
              title: 'Reiniciar',
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
 * Sends Ralph loop blocked/needs input notification
 * Note: Blocked loops cannot be resumed - they must be restarted or cancelled
 */
export async function sendLoopBlocked(
  to: string,
  agentName: string,
  iteration: number,
  maxIterations: number,
  reason: string,
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
        text: `⚠️ *${agentName}* - Loop Bloqueado\n\n` +
          `Iteração: ${iteration}/${maxIterations}\n\n` +
          `*Motivo:*\n${truncate(reason, 300)}\n\n` +
          `O loop atingiu o limite sem completar a tarefa.`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `ralph_restart_${Date.now()}`,
              title: 'Reconfigurar',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `ralph_dismiss_${Date.now()}`,
              title: 'OK',
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
 * Sends Ralph loop error notification
 */
export async function sendLoopError(
  to: string,
  agentName: string,
  iteration: number,
  maxIterations: number,
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
        text: `❌ *${agentName}* - Erro no Loop\n\n` +
          `Iteração: ${iteration}/${maxIterations}\n\n` +
          `*Erro:*\n${truncate(error, 300)}`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `ralph_retry_${Date.now()}`,
              title: 'Tentar novamente',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `ralph_cancel_${Date.now()}`,
              title: 'Cancelar',
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
 * Sends Ralph loop pause/resume controls
 */
export async function sendLoopControls(
  to: string,
  agentName: string,
  iteration: number,
  maxIterations: number,
  isPaused: boolean,
  messageId?: string
): Promise<void> {
  const status = isPaused ? '⏸️ Pausado' : '▶️ Executando';
  const action = isPaused ? 'Retomar' : 'Pausar';
  const actionId = isPaused ? 'ralph_resume' : 'ralph_pause';

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🔄 *${agentName}* - Ralph Loop\n\n` +
          `Status: ${status}\n` +
          `Iteração: ${iteration}/${maxIterations}`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `${actionId}_${Date.now()}`,
              title: action,
            },
          },
          {
            type: 'reply',
            reply: {
              id: `ralph_cancel_${Date.now()}`,
              title: 'Cancelar',
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
 * Generates a text-based progress bar
 */
function generateProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${percent}%`;
}

// =============================================================================
// WhatsApp Groups API Functions
// =============================================================================

/**
 * Create a new WhatsApp group and add the user as participant
 * Uses the WhatsApp Groups API (available since October 2025)
 *
 * @param name - Group name (will be prefixed with emoji)
 * @param description - Group description with workspace and type info
 * @param userPhone - Phone number to add as participant
 * @returns Group ID (format: 120363...@g.us)
 */
export async function createWhatsAppGroup(
  name: string,
  description: string,
  userPhone: string
): Promise<string> {
  // Create the group
  const createResponse = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/groups`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: name,
        description,
      }),
    }
  );

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error('WhatsApp group creation error:', error);
    throw new Error(`Failed to create WhatsApp group: ${error}`);
  }

  const { id: groupId } = (await createResponse.json()) as { id: string };

  // Add user to the group
  const addResponse = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/groups/${groupId}/participants`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        participants: [userPhone.replace('+', '')],
      }),
    }
  );

  if (!addResponse.ok) {
    console.error('Failed to add participant to group:', await addResponse.text());
    // Group was created, return ID anyway - user can be added manually
  }

  return groupId;
}

/**
 * Delete a WhatsApp group
 *
 * @param groupId - Group ID to delete
 */
export async function deleteWhatsAppGroup(groupId: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/groups/${groupId}`,
    {
      method: 'DELETE',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('WhatsApp group deletion error:', error);
    throw new Error(`Failed to delete WhatsApp group: ${error}`);
  }
}
