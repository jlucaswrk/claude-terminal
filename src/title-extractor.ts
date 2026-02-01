/**
 * TitleExtractor extracts conversation titles from Claude responses
 *
 * The expected format in Claude's response is: [TITLE: ...]
 * If parsing fails, falls back to first 5 words of the prompt
 */
export class TitleExtractor {
  private readonly titleRegex = /\[TITLE:\s*([^\]]+)\]/i;
  private readonly maxWords = 5;
  private readonly maxLength = 50;

  /**
   * Extract a title from Claude's response
   *
   * @param response - The full response from Claude
   * @param prompt - The original user prompt (used for fallback)
   * @returns A clean title string
   */
  extract(response: string, prompt: string): string {
    // Try to extract from response first
    const extracted = this.extractFromResponse(response);
    if (extracted) {
      return this.cleanTitle(extracted);
    }

    // Fallback to first words of prompt
    return this.generateFallback(prompt);
  }

  /**
   * Try to extract title from response using regex
   */
  private extractFromResponse(response: string): string | null {
    const match = response.match(this.titleRegex);
    if (match && match[1]) {
      return match[1].trim();
    }
    return null;
  }

  /**
   * Generate fallback title from first N words of prompt
   */
  private generateFallback(prompt: string): string {
    // Clean the prompt
    const cleaned = prompt
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .trim();

    if (!cleaned) {
      return 'New conversation';
    }

    // Split into words and take first N
    const words = cleaned.split(' ');
    const firstWords = words.slice(0, this.maxWords);

    // Join and potentially add ellipsis
    let title = firstWords.join(' ');
    if (words.length > this.maxWords) {
      title += '...';
    }

    return this.cleanTitle(title);
  }

  /**
   * Clean and normalize a title string
   */
  private cleanTitle(title: string): string {
    // Remove any remaining brackets or special markers
    let cleaned = title
      .replace(/\[TITLE:\s*/gi, '')
      .replace(/\]/g, '')
      .trim();

    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    // Truncate if too long
    if (cleaned.length > this.maxLength) {
      cleaned = cleaned.substring(0, this.maxLength - 3) + '...';
    }

    return cleaned || 'New conversation';
  }

  /**
   * Check if a response contains a title marker
   */
  hasTitle(response: string): boolean {
    return this.titleRegex.test(response);
  }
}
