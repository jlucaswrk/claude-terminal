# Epic Brief: Sistema Multi-Agente para Claude Terminal

## Summary

O `file:claude-terminal` atual permite controlar Claude Code via WhatsApp, mas suporta apenas uma conversa por modelo (Haiku/Opus), sem organização para múltiplos projetos ou contextos simultâneos. Este Epic transforma o sistema em uma plataforma multi-agente onde o usuário pode criar e gerenciar múltiplos agentes Claude independentes, cada um com seu próprio contexto, workspace opcional e histórico de atividades. O sistema permitirá execução paralela com controle de prioridade, preservação de contexto ao trocar modelos, e visibilidade completa do status e histórico de cada agente através de uma interface WhatsApp aprimorada. A solução mantém a filosofia de simplicidade do projeto (sem banco de dados, sem servidores cloud) enquanto adiciona capacidades organizacionais essenciais para gerenciar trabalho complexo e multi-projeto.

## Context & Problem

**Quem é afetado:**
- Usuário do `file:claude-terminal` (desenvolvedor que controla Claude Code remotamente via WhatsApp)
- Especificamente, usuários que trabalham em múltiplos projetos ou tarefas simultaneamente

**Onde no produto:**
- Sistema de sessões em `file:src/terminal.ts` (atualmente `${userId}_${model}`)
- Fluxo de seleção de modelo em `file:src/index.ts`
- Interface WhatsApp via `file:src/whatsapp.ts`

**Dor atual:**

1. **Perda de contexto ao trocar modelos**: O sistema atual cria sessões separadas por modelo (`${userId}_haiku` e `${userId}_opus`). Quando o usuário troca de Haiku para Opus na mesma conversa, o contexto é perdido. Exemplo: Haiku cria um arquivo, depois o usuário quer usar Opus para adicionar uma feature complexa, mas Opus não sabe sobre o arquivo criado.

2. **Impossibilidade de gerenciar múltiplos projetos**: Apenas uma conversa ativa por modelo. Se o usuário está trabalhando no frontend de um projeto e precisa alternar para o backend ou outro projeto, perde o contexto do trabalho anterior.

3. **Falta de visibilidade**: Não há forma de ver o status de tarefas em andamento, histórico de atividades, ou organizar conversas por projeto/contexto.

4. **Sem controle de execução**: Não há priorização ou limite de execuções paralelas, dificultando o gerenciamento de múltiplas tarefas simultâneas.

**Impacto:**
- Produtividade reduzida ao trabalhar em múltiplos projetos
- Frustração ao perder contexto entre trocas de modelo
- Dificuldade em retomar trabalho anterior
- Impossibilidade de delegar tarefas paralelas a diferentes "instâncias" do Claude

**Oportunidade:**
Transformar o `file:claude-terminal` de uma ferramenta de conversa única em um sistema organizacional que permite gerenciar múltiplos contextos de trabalho simultaneamente, mantendo a simplicidade e filosofia do projeto original.