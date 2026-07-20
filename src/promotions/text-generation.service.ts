import { Injectable } from '@nestjs/common';
import { PromotionTone } from './dto/promotion.dto';

const TONE_INSTRUCTIONS: Record<PromotionTone, string> = {
  coqueta:
    'Coqueta y cariñosa, con picardía sutil y modismos naturales como mi amor, bebé o corazón.',
  cachonda:
    'Provocativa, sensual y atrevida, con doble sentido sugerente sin ser gráfica ni vulgar.',
  juguetona:
    'Divertida, traviesa y espontánea, con picardía ligera y energía casual.',
};

@Injectable()
export class TextGenerationService {
  async generate(
    offer: string,
    tone: PromotionTone,
    name?: string | null,
  ): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const greeting = name ? `Hola ${name}` : 'Hola, corazón';
      const endings: Record<PromotionTone, string> = {
        coqueta: '¿Te animas, mi amor?',
        cachonda: 'Ven a consentirte y déjate sorprender.',
        juguetona: '¿Jugamos? Escríbenos y aparta tu lugar.',
      };
      return `${greeting}, tengo algo especial para ti: ${offer}. ${endings[tone]}`;
    }
    const response = await fetch(
      process.env.OPENAI_API_URL ||
        'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.8,
          messages: [
            {
              role: 'system',
              content:
                'Escribe como una mujer de la vida galante: atrevida, coqueta y natural. Usa un estilo casual de chat, modismos latinos o mexicanos y, si encaja, emojis. Sé breve: máximo dos frases. Evita sonar formal, robótica o estructurada. No inventes condiciones ni contenido sexual gráfico.',
            },
            {
              role: 'user',
              content: `Estilo elegido: ${TONE_INSTRUCTIONS[tone]} Cliente: ${name || 'cliente'}. Incluye literalmente y sin alterar esta oferta: ${offer}`,
            },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`AI provider error: ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || offer;
  }
}
