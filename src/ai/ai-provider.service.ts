import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  constructor(private readonly configService: ConfigService) {}

  async generateChatResponse(
    systemPrompt: string,
    history: { role: string; content: string }[],
  ): Promise<string> {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not defined in environment variables');
    }

    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    // Explicit 30 seconds timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages,
          }),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        this.logger.error('Groq API call timed out after 30 seconds');
        throw new Error(
          'La llamada a la API de IA superó el tiempo límite de espera.',
        );
      }
      this.logger.error('Failed to call Groq API:', err.message);
      throw err;
    }
  }
}
