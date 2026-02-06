// src/ronin-agent.ts
/**
 * RoninAgent - Read-only agent for Dojo mode WhatsApp
 *
 * A lightweight, restricted agent that can only read and search.
 * Responds concisely (max 3 lines) and never modifies files.
 */

/**
 * Tools the Ronin agent is allowed to use
 */
export const RONIN_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebSearch',
  'WebFetch',
] as const;

/**
 * System prompt for the Ronin agent
 */
export const RONIN_SYSTEM_PROMPT = `Voce e o Ronin, um assistente read-only extremamente conciso.

REGRAS ABSOLUTAS:
1. Responda em NO MAXIMO 3 linhas
2. Seja direto ao ponto - sem introducoes ou conclusoes
3. Voce SO pode LER - nunca modifique arquivos
4. Se pedirem para modificar algo, diga: "Use o Dojo no Telegram para isso"
5. Prefira codigo inline a blocos de codigo
6. Sem emojis, sem formatacao excessiva

Voce tem acesso a: Read, Glob, Grep, LS, WebSearch, WebFetch.
Voce NAO tem acesso a: Write, Edit, Bash, NotebookEdit.

Exemplos de respostas boas:
- "A funcao esta em src/utils.ts:42, recebe string e retorna number"
- "Erro na linha 15: falta fechar parenteses"
- "Use git status para ver mudancas pendentes"`;

/**
 * RoninAgent class for managing read-only interactions
 */
export class RoninAgent {
  private maxResponseLength: number;

  constructor(maxResponseLength = 500) {
    this.maxResponseLength = maxResponseLength;
  }

  /**
   * Check if a tool is allowed for Ronin
   */
  isAllowedTool(toolName: string): boolean {
    return RONIN_ALLOWED_TOOLS.includes(toolName as typeof RONIN_ALLOWED_TOOLS[number]);
  }

  /**
   * Get the system prompt
   */
  getSystemPrompt(): string {
    return RONIN_SYSTEM_PROMPT;
  }

  /**
   * Truncate response to max length
   */
  truncateResponse(response: string, maxLength?: number): string {
    const limit = maxLength || this.maxResponseLength;
    if (response.length <= limit) return response;
    return response.slice(0, limit) + '...';
  }

  /**
   * Filter tools from a response/event (for SDK integration)
   */
  filterDisallowedTools(tools: Array<{ name: string }>): Array<{ name: string; blocked: true; reason: string }> {
    return tools
      .filter(tool => !this.isAllowedTool(tool.name))
      .map(tool => ({
        name: tool.name,
        blocked: true,
        reason: 'Ronin e read-only. Use o Dojo no Telegram para modificacoes.',
      }));
  }
}

// Singleton instance
export const roninAgent = new RoninAgent();
