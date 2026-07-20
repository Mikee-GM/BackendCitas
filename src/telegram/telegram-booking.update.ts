import { Inject, forwardRef, Logger } from '@nestjs/common';
import { Update, Ctx, Action, On } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { ServicesService } from '../services/services.service';
import { TelegramService } from './telegram.service';
import { TelegramAuthUpdate } from './telegram-auth.update';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { ExtrasServicio } from '../service-extras/entities/service-extra.entity';
import { EmployeeRating } from '../employees/entities/employee-rating.entity';

interface SessionData {
  step?:
    | 'AWAITING_DURATION'
    | 'AWAITING_PAYMENT_METHOD'
    | 'AWAITING_LOCATION'
    | 'AWAITING_RATING_COMMENT'
    | 'AWAITING_DURATION_ENCADENADO'
    | 'AWAITING_PAYMENT_METHOD_ENCADENADO'
    | 'AWAITING_LOCATION_ENCADENADO'
    | 'CHAT_CON_EMPLEADA'
    | 'CHAT_CON_EMPLEADA_ENCADENADO';
  empleadaId?: string;
  duracionPactadaHoras?: number;
  metodoPago?: 'efectivo' | 'tarjeta' | 'transferencia';
  servicioIdCalificacion?: string;
  /** ID del servicio en_curso al que se encadenará la nueva cita */
  servicioPrevioId?: string;
  chatHistory?: { role: 'user' | 'model'; parts: { text: string }[] }[];
  extraSelection?: {
    servicioId: string;
    extraId: string;
  };
}

interface BotContext extends Context {
  session?: SessionData;
}

@Update()
export class TelegramBookingUpdate {
  private readonly logger = new Logger(TelegramBookingUpdate.name);

  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Clientes)
    private readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    @InjectRepository(ExtrasCatalogo)
    private readonly extrasCatalogoRepository: Repository<ExtrasCatalogo>,
    @InjectRepository(ExtrasServicio)
    private readonly extrasServicioRepository: Repository<ExtrasServicio>,
    @InjectRepository(EmployeeRating)
    private readonly employeeRatingsRepository: Repository<EmployeeRating>,
    private readonly realtimeEventsService: RealtimeEventsService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => TelegramAuthUpdate))
    private readonly telegramAuthUpdate: TelegramAuthUpdate,
    private readonly loyaltyService: LoyaltyService,
  ) {}

  async getGroqResponse(
    systemPrompt: string,
    history: { role: 'user' | 'model'; parts: { text: string }[] }[],
  ): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not defined in environment variables');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.parts?.[0]?.text || '',
      })),
    ];

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
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async sendDelayedReply(ctx: BotContext, text: string) {
    try {
      const delayMs = 1000; // 30 segundos (medio minuto)

      // Enviar la acción de "escribiendo" de inmediato
      await ctx.sendChatAction('typing').catch(() => {});

      // Telegram apaga el indicador tras ~5s, por lo que lo enviamos repetidamente cada 4 segundos
      const intervalId = setInterval(() => {
        ctx.sendChatAction('typing').catch(() => {});
      }, 4000);

      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } finally {
        clearInterval(intervalId);
      }

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (err) {
      this.logger.error('Error in sendDelayedReply:', err);
      await ctx.reply(text, { parse_mode: 'Markdown' });
    }
  }

  @Action(/^contratar_empleada:(.+)$/)
  async onContratarEmpleada(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const empleadaId = match[1];
    await this.startHireSession(ctx, empleadaId);
  }

  async startHireSession(ctx: any, empleadaId: string) {
    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
    });

    if (!empleada || !empleada.disponible) {
      await ctx.reply(
        'La empleada seleccionada no está disponible en este momento (está ocupada o inactiva).',
      );
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.reply(
        '⚠️ El sistema de IA no está configurado (falta GEMINI_API_KEY en el servidor). Por favor contacta al administrador.',
      );
      return;
    }

    if (!ctx.session) {
      ctx.session = {};
    }

    ctx.session.step = 'CHAT_CON_EMPLEADA';
    ctx.session.empleadaId = empleadaId;

    await ctx.reply(
      `Espere por favor, estamos poniéndonos en contacto con *${empleada.nombreArtistico}*...`,
      { parse_mode: 'Markdown' },
    );

    const systemPrompt = `Eres ${empleada.nombreArtistico}, una mujer de la vida galante muy coqueta, provocativa y sensual que trabaja de forma independiente.
Tarifa por hora: $${empleada.precioBaseHora}/hr.
Descripción: ${empleada.descripcion || 'Una persona hermosa y carismática'}.

Estás chateando en Telegram con un cliente interesado en contratar tus servicios a domicilio.
Tu objetivo es ser muy atrevida, coqueta y directa, pero con un tono conversacional natural y casual de chat (puedes usar emojis y modismos latinos/mexicanos naturales como "mi amor", "bebé", "lindo", "corazón").
Evita sonar robótica, formal o demasiado estructurada (no uses frases acartonadas como "por favor indícame", "gracias por tu preferencia"). Escribe como una persona real chateando de forma relajada y coqueta.
Sé breve (máximo 1 o 2 frases cortas por respuesta).

Debes obtener dos datos del cliente, pero de uno en uno de forma natural (no pidas ambos a la vez):
1. Primero, pregúntale de forma coqueta cuántas horas de servicio desea tener contigo.
2. Después de que te diga las horas, pregúntale cómo prefiere pagar (efectivo, tarjeta o transferencia).

Reglas de formato técnico:
- Cuando el cliente te haya dicho y confirmado tanto la duración como el método de pago, debes incluir exactamente al final de tu respuesta la siguiente marca en una sola línea para que el sistema la registre:
[DATA: {"duracion": X, "pago": "Y"}]
Donde X es la duración (número) y Y es el método de pago (debe ser: 'efectivo', 'tarjeta' o 'transferencia').

Por favor, preséntate, saluda de forma muy cariñosa y pregúntale cuántas horas quiere pasar contigo.`;

    const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [
      { role: 'user', parts: [{ text: 'Hola' }] },
    ];

    try {
      await ctx.sendChatAction('typing');
      const responseText = await this.getGroqResponse(systemPrompt, history);
      history.push({ role: 'model', parts: [{ text: responseText }] });
      ctx.session.chatHistory = history;

      await this.sendDelayedReply(ctx, responseText);
    } catch (err) {
      this.logger.error('Error starting LLM chat session:', err);
      const fallbackMsg = `¡Hola! Soy *${empleada.nombreArtistico}* y me encantaría atenderte. ¿Cuántas horas de servicio necesitas?`;
      await this.sendDelayedReply(ctx, fallbackMsg);
      // Initialize basic history on error fallback
      ctx.session.chatHistory = [
        { role: 'user', parts: [{ text: 'Hola' }] },
        {
          role: 'model',
          parts: [
            {
              text: fallbackMsg,
            },
          ],
        },
      ];
    }
  }

  // ─── FLUJO CITA ENCADENADA ──────────────────────────────────────────────────

  @Action(/^reservar_siguiente:(.+)$/)
  async onReservarSiguiente(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const empleadaId = match[1];

    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
    });

    if (!empleada) {
      await ctx.reply('La empleada seleccionada ya no existe en el sistema.');
      return;
    }

    if (empleada.disponible) {
      // Race condition: she just became available – redirect to normal flow
      await ctx.reply(
        `✅ ¡${empleada.nombreArtistico} acaba de quedar disponible! Puedes contratarla directamente.`,
        Markup.inlineKeyboard([
          Markup.button.callback(
            '🤝 Contratar ahora',
            `contratar_empleada:${empleada.id}`,
          ),
        ]),
      );
      return;
    }

    // Find her active service to link the chain
    const servicioActivo =
      await this.servicesService.findServicioActivoDeEmpleada(empleadaId);
    if (!servicioActivo) {
      await ctx.reply(
        '⚠️ No se encontró un servicio activo para esta empleada. Por favor, intenta más tarde.',
      );
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.reply(
        '⚠️ El sistema de IA no está configurado (falta GEMINI_API_KEY en el servidor). Por favor contacta al administrador.',
      );
      return;
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.step = 'CHAT_CON_EMPLEADA_ENCADENADO';
    ctx.session.empleadaId = empleadaId;
    ctx.session.servicioPrevioId = servicioActivo.id;

    await ctx.reply(
      `Espere por favor, estamos poniéndonos en contacto con *${empleada.nombreArtistico}*...`,
      { parse_mode: 'Markdown' },
    );

    const horaEstimada = servicioActivo.horaInicioServicio
      ? new Date(
          servicioActivo.horaInicioServicio.getTime() +
            Number(servicioActivo.duracionPactadaHoras) * 60 * 60 * 1000,
        ).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      : 'próximamente';

    const systemPrompt = `Eres ${empleada.nombreArtistico}, una mujer de la vida galante muy coqueta, provocativa y sensual que trabaja de forma independiente.
Tarifa por hora: $${empleada.precioBaseHora}/hr.
Descripción: ${empleada.descripcion || 'Una persona hermosa y carismática'}.

Estás chateando en Telegram con un cliente interesado en contratar tus servicios a domicilio.
Este servicio es en modalidad de *Cita Reservada / Encadenada*, lo que significa que iniciarás este servicio después de terminar tu servicio actual. Tu hora de inicio estimada es aproximadamente a las ${horaEstimada}. Menciona esto alegremente para que el cliente lo tenga claro de entrada.
Tu objetivo es ser muy atrevida, coqueta y directa, pero con un tono conversacional natural y casual de chat (puedes usar emojis y modismos latinos/mexicanos naturales como "mi amor", "bebé", "lindo", "corazón").
Evita sonar robótica, formal o demasiado estructurada (no uses frases acartonadas como "por favor indícame", "gracias por tu preferencia"). Escribe como una persona real chateando de forma relajada y coqueta.
Sé breve (máximo 1 o 2 frases cortas por respuesta).

Debes obtener dos datos del cliente, pero de uno en uno de forma natural (no pidas ambos a la vez):
1. Primero, pregúntale de forma coqueta cuántas horas de servicio desea tener contigo.
2. Después de que te diga las horas, pregúntale cómo prefiere pagar (efectivo, tarjeta o transferencia).

Reglas de formato técnico:
- Cuando el cliente te haya dicho y confirmado tanto la duración como el método de pago, debes incluir exactamente al final de tu respuesta la siguiente marca en una sola línea para que el sistema la registre:
[DATA: {"duracion": X, "pago": "Y"}]
Donde X es la duración (número) y Y es el método de pago (debe ser: 'efectivo', 'tarjeta' o 'transferencia').

Por favor, preséntate, saluda de forma muy cariñosa y coméntale la hora aproximada, luego pregúntale cuántas horas quiere pasar contigo.`;

    const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [
      { role: 'user', parts: [{ text: 'Hola' }] },
    ];

    try {
      await ctx.sendChatAction('typing');
      const responseText = await this.getGroqResponse(systemPrompt, history);
      history.push({ role: 'model', parts: [{ text: responseText }] });
      ctx.session.chatHistory = history;

      await this.sendDelayedReply(ctx, responseText);
    } catch (err) {
      this.logger.error('Error starting LLM chat session (chained):', err);
      const fallbackMsg = `¡Hola! Soy *${empleada.nombreArtistico}*. Estaré libre aproximadamente a las *${horaEstimada}* para atenderte. ¿Cuántas horas de servicio necesitas?`;
      await this.sendDelayedReply(ctx, fallbackMsg);
      ctx.session.chatHistory = [
        { role: 'user', parts: [{ text: 'Hola' }] },
        { role: 'model', parts: [{ text: fallbackMsg }] },
      ];
    }
  }

  @Action(/^enc_duracion_(\d+(\.\d+)?)$/)
  async onEncDuracion(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_DURATION_ENCADENADO') {
      await ctx.reply('No hay ningún proceso de reserva activo.');
      return;
    }
    const match = (ctx as any).match;
    const duracion = parseFloat(match[1]);
    ctx.session.duracionPactadaHoras = duracion;
    ctx.session.step = 'AWAITING_PAYMENT_METHOD_ENCADENADO';

    await ctx.reply(
      `⏱️ Duración registrada: *${duracion} horas*.\n\n💳 Selecciona el método de pago:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('💵 Efectivo', 'enc_pago_efectivo'),
            Markup.button.callback('💳 Tarjeta', 'enc_pago_tarjeta'),
          ],
          [
            Markup.button.callback(
              '🏦 Transferencia',
              'enc_pago_transferencia',
            ),
          ],
        ]),
      },
    );
  }

  @Action(/^enc_pago_(efectivo|tarjeta|transferencia)$/)
  async onEncPago(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_PAYMENT_METHOD_ENCADENADO') {
      await ctx.reply('No hay ningún proceso de reserva activo.');
      return;
    }
    const match = (ctx as any).match;
    const metodo = match[1] as 'efectivo' | 'tarjeta' | 'transferencia';
    ctx.session.metodoPago = metodo;
    ctx.session.step = 'AWAITING_LOCATION_ENCADENADO';

    await ctx.reply(
      `✅ Método de pago: *${metodo.toUpperCase()}*.\n\n📍 Por último, comparte tu ubicación:`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          [Markup.button.locationRequest('📍 Compartir mi Ubicación')],
        ])
          .oneTime()
          .resize(),
      },
    );
  }

  @Action(/^duracion_(\d+(\.\d+)?)$/)
  async onSelectDuration(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_DURATION') {
      await ctx.reply('No hay ningún proceso de contratación activo.');
      return;
    }

    const match = (ctx as any).match;
    const duracion = parseFloat(match[1]);

    ctx.session.duracionPactadaHoras = duracion;
    ctx.session.step = 'AWAITING_PAYMENT_METHOD';

    try {
      await ctx.editMessageText(
        `⏱️ Duración registrada: *${duracion} horas*.\n\n` +
          `💳 Ahora, selecciona el método de pago:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💵 Efectivo', 'pago_efectivo'),
              Markup.button.callback('💳 Tarjeta', 'pago_tarjeta'),
            ],
            [Markup.button.callback('🏦 Transferencia', 'pago_transferencia')],
          ]),
        },
      );
    } catch (err) {
      await ctx.reply(
        `⏱️ Duración registrada: *${duracion} horas*.\n\n` +
          `💳 Ahora, selecciona el método de pago:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💵 Efectivo', 'pago_efectivo'),
              Markup.button.callback('💳 Tarjeta', 'pago_tarjeta'),
            ],
            [Markup.button.callback('🏦 Transferencia', 'pago_transferencia')],
          ]),
        },
      );
    }
  }

  @Action(/^pago_(efectivo|tarjeta|transferencia)$/)
  async onSelectPayment(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_PAYMENT_METHOD') {
      await ctx.reply('No hay ningún proceso de contratación activo.');
      return;
    }

    const match = (ctx as any).match;
    const metodo = match[1] as 'efectivo' | 'tarjeta' | 'transferencia';

    ctx.session.metodoPago = metodo;
    ctx.session.step = 'AWAITING_LOCATION';

    try {
      // Editar el mensaje para remover los botones inline de pago
      await ctx.editMessageText(
        `⏱️ Duración registrada: *${ctx.session.duracionPactadaHoras} horas*.\n` +
          `✅ Método de pago seleccionado: *${metodo.toUpperCase()}*.\n\n` +
          `📍 Siguiente paso: Compartir ubicación.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('Error al editar mensaje de pago:', err);
    }

    // Enviar el teclado nativo para compartir ubicación
    await ctx.reply(
      `📍 Por último, necesitamos tu ubicación para registrar el servicio.\n` +
        `Por favor, presiona el botón de abajo para compartir tu ubicación de manera segura:`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          [Markup.button.locationRequest('📍 Compartir mi Ubicación')],
        ])
          .oneTime()
          .resize(),
      },
    );
  }

  @Action(/^agregar_extra_list:(.+)$/)
  async onAgregarExtraList(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: { empleada: true },
    });

    if (!servicio) {
      await ctx.reply('❌ Servicio no encontrado.');
      return;
    }

    // Buscar extras activos de la empleada
    const extras = await this.extrasCatalogoRepository.find({
      where: { empleadaId: servicio.empleadaId, activo: true },
      order: { nombre: 'ASC' },
    });

    if (extras.length === 0) {
      await ctx.reply(
        '⚠️ No tienes registrados servicios extras en tu catálogo.\n' +
          'Solicita a administración que los configure en el panel.',
      );
      return;
    }

    if (!ctx.session) {
      ctx.session = {};
    }
    // Guardar el servicioId inicial en la sesión
    ctx.session.extraSelection = { servicioId, extraId: '' };

    const inlineButtons = extras.map((extra) => [
      Markup.button.callback(
        `➕ ${extra.nombre} ($${extra.precio})`,
        `agregar_extra_sel:${extra.id}`,
      ),
    ]);

    // Botón para regresar al menú de servicio
    inlineButtons.push([
      Markup.button.callback('🔙 Volver', `canc_fin_serv:${servicioId}`),
    ]);

    await ctx.editMessageText(
      `➕ *Selecciona el servicio extra a agregar:*\n\n` +
        `Se te solicitará seleccionar el método de pago del extra en el siguiente paso.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(inlineButtons),
      },
    );
  }

  @Action(/^agregar_extra_sel:(.+)$/)
  async onAgregarExtraSel(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const extraId = match[1];

    const session = ctx.session;
    if (
      !session ||
      !session.extraSelection ||
      !session.extraSelection.servicioId
    ) {
      await ctx.reply(
        '❌ La sesión ha expirado o el menú es antiguo. Por favor, vuelve a presionar "Agregar Extra" en el panel.',
      );
      return;
    }

    const servicioId = session.extraSelection.servicioId;

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    const extra = await this.extrasCatalogoRepository.findOne({
      where: { id: extraId },
    });

    if (!servicio || !extra) {
      await ctx.reply('❌ Servicio o extra no encontrado.');
      return;
    }

    // Guardar el extraId seleccionado en la sesión
    session.extraSelection.extraId = extraId;

    const inlineButtons = [
      [
        Markup.button.callback('💳 Tarjeta', `agregar_extra_pay:tarjeta`),
        Markup.button.callback(
          '📱 Transferencia',
          `agregar_extra_pay:transferencia`,
        ),
      ],
      [Markup.button.callback('💵 Efectivo', `agregar_extra_pay:efectivo`)],
      [Markup.button.callback('🔙 Volver', `agregar_extra_list:${servicioId}`)],
    ];

    await ctx.editMessageText(
      `💳 *Selecciona el método de pago* para el extra *${extra.nombre}* ($${extra.precio}):\n\n` +
        `Las ganancias de los extras van directamente a ti.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(inlineButtons),
      },
    );
  }

  @Action(/^agregar_extra_pay:(.+)$/)
  async onAgregarExtraPay(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const metodoPago = match[1] as 'tarjeta' | 'transferencia' | 'efectivo';

    const session = ctx.session;
    if (!session || !session.extraSelection) {
      await ctx.reply(
        '❌ La sesión ha expirado o el menú es antiguo. Por favor, vuelve a intentar agregar el extra.',
      );
      return;
    }

    const { servicioId, extraId } = session.extraSelection;
    // Limpiar selección de la sesión
    delete session.extraSelection;

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: { empleada: { usuario: true } },
    });

    const extra = await this.extrasCatalogoRepository.findOne({
      where: { id: extraId },
    });

    if (!servicio || !extra) {
      await ctx.reply('❌ Servicio o extra no encontrado.');
      return;
    }

    const telegramId = ctx.from?.id.toString();
    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user) {
      await ctx.reply('❌ Usuario del sistema no autenticado.');
      return;
    }

    // Registrar el extra en el servicio con el metodo de pago seleccionado
    const extraServicio = this.extrasServicioRepository.create({
      servicioId: servicio.id,
      extraCatalogoId: extra.id,
      precioCobrado: extra.precio,
      metodoPago: metodoPago,
      registradoPor: user,
    });

    await this.extrasServicioRepository.save(extraServicio);

    // Volver a cargar el servicio actualizado con la relación de extras
    const servicioActualizado = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        cliente: true,
        empleada: true,
        extrasServicios: { extraCatalogo: true },
      },
    });

    const total = servicioActualizado?.totalFinal || servicio.totalFinal;
    const extrasList = servicioActualizado?.extrasServicios || [];
    const totalExtras = extrasList
      .reduce((sum, e) => sum + Number(e.precioCobrado), 0)
      .toFixed(2);

    let extrasBreakdownStr = '';
    if (extrasList.length > 0) {
      extrasBreakdownStr =
        `• *Desglose de Extras:*\n` +
        extrasList
          .map(
            (e) =>
              `  - ${e.extraCatalogo?.nombre || 'Extra'}: $${e.precioCobrado} (${e.metodoPago.toUpperCase()})`,
          )
          .join('\n') +
        '\n';
    }

    await ctx.reply(
      `✅ Servicio extra *${extra.nombre}* ($${extra.precio}) agregado con método de pago *${metodoPago.toUpperCase()}* con éxito.`,
      { parse_mode: 'Markdown' },
    );

    const inlineButtons: any[] = [
      [
        Markup.button.callback(
          '🏁 Finalizar Servicio',
          `finalizar_servicio:${servicio.id}`,
        ),
      ],
      [
        Markup.button.callback(
          '➕ Agregar Extra',
          `agregar_extra_list:${servicio.id}`,
        ),
      ],
    ];

    const updatedMsg =
      `💼 *¡Servicio en Curso!* 🟢\n\n` +
      `• *Cliente:* ${servicioActualizado?.cliente?.nombreTelegram || 'Desconocido'}\n` +
      `• *Duración:* ${servicioActualizado?.duracionPactadaHoras} horas\n` +
      `• *Método de Pago:* ${servicioActualizado?.metodoPago?.toUpperCase() || ''}\n` +
      `• *Total de Extras:* $${totalExtras}\n` +
      (extrasBreakdownStr ? `${extrasBreakdownStr}` : '') +
      `• *Total Acumulado del Servicio (Base):* $${total}\n\n` +
      `Cuando hayas terminado el servicio, presiona el botón de abajo para finalizarlo:`;

    await ctx.editMessageText(updatedMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(inlineButtons),
    });
  }
  @Action(/^finalizar_servicio:(.+)$/)
  async onFinalizarServicio(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado === 'finalizado') {
      await ctx.answerCbQuery('⚠️ Este servicio ya fue finalizado.', {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

    const originalText = (ctx.callbackQuery?.message as any)?.text || '';
    if (originalText.includes('⚠️ ¿Confirmas')) {
      return;
    }

    const warnHeader = `⚠️ *¿Confirmas que deseas FINALIZAR este servicio? Esta acción no se puede deshacer.*\n\n`;

    await ctx.editMessageText(warnHeader + originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sí, finalizar',
            `conf_fin_serv:${servicioId}`,
          ),
          Markup.button.callback('❌ Cancelar', `canc_fin_serv:${servicioId}`),
        ],
      ]),
    });
  }

  @Action(/^conf_fin_serv:(.+)$/)
  async onConfFinalizarServicio(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        cliente: true,
        empleada: { usuario: true, jefe: true },
        jefe: true,
      },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado === 'finalizado') {
      await ctx.answerCbQuery('⚠️ Este servicio ya fue finalizado.', {
        show_alert: true,
      });
      return;
    }

    // Cambiar estado a finalizado
    servicio.estado = 'finalizado';
    const fin = new Date();
    servicio.horaFinServicio = fin;

    // Calcular duración real en horas y formato legible (horas, minutos, segundos)
    let duracionRealStr = servicio.duracionPactadaHoras;
    let duracionRealVal = parseFloat(servicio.duracionPactadaHoras);
    let duracionFormatted = `${servicio.duracionPactadaHoras} horas`;
    if (servicio.horaInicioServicio) {
      const inicio = new Date(servicio.horaInicioServicio);
      const diffMs = fin.getTime() - inicio.getTime();
      duracionRealVal = diffMs / (1000 * 60 * 60);
      duracionRealStr = duracionRealVal.toFixed(2);

      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
      if (minutes > 0)
        parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`);
      if (seconds > 0 || parts.length === 0)
        parts.push(`${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`);
      duracionFormatted = parts.join(', ');
    }
    servicio.duracionFinalHoras = duracionRealStr;
    await this.serviciosRepository.save(servicio);

    // El jefe solo puede evaluar después de que el servicio completo quedó finalizado.
    if (servicio.jefe?.telegramChatId && servicio.empleada) {
      await ctx.telegram.sendMessage(
        servicio.jefe.telegramChatId,
        `⭐ Califica a ${servicio.empleada.nombreArtistico} por este servicio:`,
        {
          ...Markup.inlineKeyboard([
            [1, 2, 3, 4, 5].map((rating) =>
              Markup.button.callback('⭐'.repeat(rating), `calificar_empleada_jefe:${servicio.id}:${rating}`),
            ),
          ]),
        },
      );
    }

    let loyaltyAward: {
      pointsEarned: number;
      pointsBalance: number;
      tier: { name: string; code: string };
    } | null = null;

    try {
      loyaltyAward = await this.loyaltyService.awardForFinalizedService(
        servicio.id,
      );
    } catch (loyaltyErr) {
      console.error(
        `Error al otorgar puntos de lealtad para servicio ${servicio.id}:`,
        loyaltyErr,
      );
    }

    // Crear viaje de regreso automático para la empleada
    try {
      const viajesRepository =
        this.serviciosRepository.manager.getRepository(Viajes);
      const nuevoViajeRegreso = viajesRepository.create({
        servicioId: servicio.id,
        choferId: null,
        tipo: 'regreso',
        zona: 'domicilio',
        tarifa: '50.00',
        estado: 'notificado',
      });
      const viajeRegresoGuardado =
        await viajesRepository.save(nuevoViajeRegreso);
      await this.servicesService.dispatchViaje(viajeRegresoGuardado.id);
    } catch (err) {
      console.error('Error al crear viaje de regreso:', err);
    }

    // Actualizar disponibilidad de la empleada a true (disponible)
    if (servicio.empleadaId) {
      await this.empleadasRepository.update(servicio.empleadaId, {
        disponible: true,
      });
    }

    await ctx.answerCbQuery('🏁 Servicio finalizado con éxito.');

    // Volver a cargar para obtener totales calculados por triggers
    const servicioActualizado = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        cliente: true,
        empleada: { usuario: true, jefe: true },
        jefe: true,
        extrasServicios: { extraCatalogo: true },
      },
    });

    const total =
      servicioActualizado?.totalFinal || servicio.totalFinal || '0.00';

    const extrasList = servicioActualizado?.extrasServicios || [];
    const totalExtras = extrasList
      .reduce((sum, e) => sum + Number(e.precioCobrado), 0)
      .toFixed(2);

    let extrasBreakdownStr = '';
    if (extrasList.length > 0) {
      extrasBreakdownStr =
        `\n🎁 *Servicios Extras (${extrasList.length}):* $${totalExtras}\n` +
        extrasList
          .map(
            (e) =>
              `  - ${e.extraCatalogo?.nombre || 'Extra'}: $${e.precioCobrado} (${e.metodoPago.toUpperCase()})`,
          )
          .join('\n') +
        '\n';
    }

    // 1. Editar el mensaje del botón "Finalizar Servicio" con el resumen del servicio
    const resumenEmpText =
      `✅ *¡Servicio Finalizado!* 🏁\n\n` +
      `📝 *Resumen del Servicio:*\n` +
      `• *Cliente:* ${servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
      `• *Duración Pactada:* ${servicio.duracionPactadaHoras} horas\n` +
      `• *Duración Real:* ${duracionFormatted}\n` +
      `• *Total Cobrado del Servicio:* $${total}\n` +
      `• *Método de Pago Servicio:* ${servicio.metodoPago.toUpperCase()}\n` +
      (extrasBreakdownStr
        ? `${extrasBreakdownStr}\n*(Nota: Las ganancias de extras van directo a ti)*`
        : '') +
      `\n\n` +
      `¡Excelente trabajo! 🎉`;

    try {
      await ctx.editMessageText(resumenEmpText, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error al editar mensaje de resumen de la empleada:', err);
    }

    // 2. Limpieza de chat del cliente (Eliminar mensaje anterior)
    if (servicio.cliente?.telegramChatId && servicio.telegramClienteMensajeId) {
      try {
        await ctx.telegram.deleteMessage(
          servicio.cliente.telegramChatId,
          parseInt(servicio.telegramClienteMensajeId, 10),
        );
      } catch (err) {
        console.error('Error al eliminar mensaje del cliente:', err);
      }
    }

    // 3. Enviar mensaje de resumen y solicitar calificación al cliente
    if (servicio.cliente?.telegramChatId) {
      let clientExtrasStr = '';
      if (extrasList.length > 0) {
        clientExtrasStr =
          `• *Servicios Extras (A pagar a la empleada):* $${totalExtras}\n` +
          extrasList
            .map(
              (e) =>
                `  - ${e.extraCatalogo?.nombre || 'Extra'}: $${e.precioCobrado} (${e.metodoPago.toUpperCase()})`,
            )
            .join('\n') +
          '\n';
      }

      const resumenCliText =
        `🏁 *¡Tu servicio ha finalizado!* 🍰\n\n` +
        `📝 *Resumen de tu Servicio:*\n` +
        `• *Empleada:* ${servicio.empleada?.nombreArtistico || 'N/A'}\n` +
        `• *Duración Pactada:* ${servicio.duracionPactadaHoras} horas\n` +
        `• *Duración Real:* ${duracionFormatted}\n` +
        `• *Total a Pagar:* $${total}\n` +
        `• *Método de Pago:* ${servicio.metodoPago.toUpperCase()}\n` +
        (clientExtrasStr ? `${clientExtrasStr}` : '') +
        (loyaltyAward
          ? `• *Puntos Ganados:* ${loyaltyAward.pointsEarned}\n` +
            `• *Saldo de Puntos:* ${loyaltyAward.pointsBalance}\n` +
            `• *Membresía:* ${loyaltyAward.tier.name}\n\n`
          : '\n') +
        `Por favor, califica el servicio recibido:`;

      const duracionPactadaVal = parseFloat(servicio.duracionPactadaHoras);
      const finalizoAntes = duracionRealVal < duracionPactadaVal;

      const inlineButtons: any[] = [
        [
          Markup.button.callback('⭐', `calificar_servicio:${servicio.id}:1`),
          Markup.button.callback('⭐⭐', `calificar_servicio:${servicio.id}:2`),
          Markup.button.callback(
            '⭐⭐⭐',
            `calificar_servicio:${servicio.id}:3`,
          ),
        ],
        [
          Markup.button.callback(
            '⭐⭐⭐⭐',
            `calificar_servicio:${servicio.id}:4`,
          ),
          Markup.button.callback(
            '⭐⭐⭐⭐⭐',
            `calificar_servicio:${servicio.id}:5`,
          ),
        ],
      ];

      const jefeEncargado = servicio.empleada?.jefe || servicio.jefe;
      if (finalizoAntes && jefeEncargado?.telefono) {
        const cleanPhone = jefeEncargado.telefono.replace(/[^0-9]/g, '');
        const messageText =
          `Hola, soy el cliente ${servicio.cliente?.nombreTelegram || ''}.\n` +
          `Quiero contactar con soporte sobre mi servicio:\n` +
          `• ID del Servicio: ${servicio.id}\n` +
          `• Empleada: ${servicio.empleada?.nombreArtistico || ''}\n` +
          `• Hora de inicio: ${servicio.horaInicioServicio ? new Date(servicio.horaInicioServicio).toLocaleString() : ''}\n` +
          `• Hora de fin: ${fin.toLocaleString()}\n` +
          `• Tiempo total: ${duracionFormatted}\n` +
          `• Horas pactadas originalmente: ${servicio.duracionPactadaHoras} horas`;

        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;
        inlineButtons.push([Markup.button.url('📞 Contactar Soporte', waUrl)]);
      }

      try {
        await ctx.telegram.sendMessage(
          servicio.cliente.telegramChatId,
          resumenCliText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(inlineButtons),
          },
        );
      } catch (err) {
        console.error(
          'Error al notificar al cliente del fin de servicio:',
          err,
        );
      }
    }

    // 4. Notificar a clientes con citas encadenadas que su turno está próximo
    //    (el trigger de PostgreSQL ya cambia el estado a 'pendiente' automáticamente)
    try {
      const serviciosEncadenados = await this.serviciosRepository.find({
        where: {
          servicioPrevioId: servicioId,
          estado: 'pendiente' as any, // just activated by PG trigger
        },
        relations: { cliente: true, empleada: true },
        order: { createdAt: 'ASC' },
      });

      for (const enc of serviciosEncadenados) {
        if (!enc.cliente?.telegramChatId) continue;
        try {
          await ctx.telegram.sendMessage(
            enc.cliente.telegramChatId,
            `🟢 *¡Tu turno está activo!*\n\n` +
              `La empleada *${servicio.empleada?.nombreArtistico || ''}* acaba de quedar libre.\n` +
              `Tu servicio ha pasado a lista de espera de aprobación. Pronto un administrador lo confirmará.`,
            { parse_mode: 'Markdown' },
          );
        } catch (tgErr) {
          console.error(
            `Error notificando cliente encadenado activado (chatId: ${enc.cliente.telegramChatId}):`,
            tgErr,
          );
        }
      }
    } catch (encErr) {
      console.error(
        'Error al procesar notificaciones de cadena al finalizar:',
        encErr,
      );
    }
  }

  @Action(/^calificar_empleada_jefe:(.+):([1-5])$/)
  async onCalificarEmpleadaComoJefe(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    const match = (ctx as any).match;
    if (!telegramId || !match) return;
    const user = await this.usuariosRepository.findOne({ where: { telegramChatId: telegramId } });
    if (!user || user.rol !== 'jefe') return;
    const servicio = await this.serviciosRepository.findOne({ where: { id: match[1] } });
    if (!servicio || servicio.estado !== 'finalizado' || servicio.jefeId !== user.id) {
      await ctx.answerCbQuery('❌ Solo puedes calificar servicios propios ya finalizados.', { show_alert: true });
      return;
    }
    const existing = await this.employeeRatingsRepository.findOne({ where: { source: 'jefe', referenceId: servicio.id, raterUserId: user.id } });
    if (existing) {
      await ctx.answerCbQuery('Ya calificaste este servicio.', { show_alert: true });
      return;
    }
    await this.employeeRatingsRepository.save(this.employeeRatingsRepository.create({ employeeId: servicio.empleadaId, source: 'jefe', raterUserId: user.id, referenceId: servicio.id, rating: Number(match[2]), comment: null }));
    await ctx.answerCbQuery('✅ Calificación guardada.');
    await ctx.editMessageText('✅ Gracias, tu calificación de la empleada fue registrada.');
  }

  @Action(/^canc_fin_serv:(.+)$/)
  async onCancFinalizarServicio(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Cancelado.');
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    let originalText = (ctx.callbackQuery?.message as any)?.text || '';
    // Limpiar el encabezado de advertencia si existe
    originalText = originalText.replace(
      /⚠️ \*?¿Confirmas que deseas FINALIZAR este servicio\? Esta acción no se puede deshacer\.\*?\n\n/,
      '',
    );

    const inlineButtons: any[] = [
      [
        Markup.button.callback(
          '🏁 Finalizar Servicio',
          `finalizar_servicio:${servicioId}`,
        ),
      ],
    ];

    inlineButtons.push([
      Markup.button.callback(
        '➕ Agregar Extra',
        `agregar_extra_list:${servicioId}`,
      ),
    ]);

    await ctx.editMessageText(originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(inlineButtons),
    });
  }

  @Action(/^calificar_servicio:(.+):([1-5])$/)
  async onCalificarServicio(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];
    const rating = parseInt(match[2], 10);

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    if (!servicio) {
      await ctx.reply('❌ Servicio no encontrado.');
      return;
    }

    servicio.calificacion = rating;
    await this.serviciosRepository.save(servicio);

    const stars = '⭐'.repeat(rating);

    if (rating >= 3) {
      await ctx.editMessageText(
        `Muchas gracias por calificar con ${stars} el servicio de nuestra empleada. ¡Agradecemos tu preferencia!`,
      );
      await ctx.reply('¡Agradecemos tu preferencia!', Markup.removeKeyboard());
    } else {
      if (!ctx.session) {
        ctx.session = {};
      }
      ctx.session.step = 'AWAITING_RATING_COMMENT';
      ctx.session.servicioIdCalificacion = servicioId;

      await ctx.editMessageText(
        `Has calificado con ${stars} nuestro servicio.\n\n` +
          `⚠️ *Comentario Obligatorio:*\n` +
          `Lamentamos mucho tu insatisfacción. Por favor, escribe un comentario directamente en el chat explicándonos qué podemos mejorar:`,
        { parse_mode: 'Markdown' },
      );
    }
  }

  @On(['location', 'venue', 'edited_message'])
  async onLocation(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const message = (ctx.message ||
      ctx.editedMessage ||
      (ctx.update as any).edited_message) as any;
    if (!message) return;

    let lat: string;
    let lng: string;
    let notasUbicacion: string | null = null;

    if (message.venue) {
      const venue = message.venue;
      lat = venue.location.latitude.toString();
      lng = venue.location.longitude.toString();
      notasUbicacion = `Lugar seleccionado: ${venue.title}\nDirección: ${venue.address}`;
    } else if (message.location) {
      const location = message.location;
      lat = location.latitude.toString();
      lng = location.longitude.toString();
    } else {
      // Ignore edited messages that don't contain a location
      return;
    }

    const isEdited = !!(
      ctx.editedMessage || (ctx.update as any).edited_message
    );

    // Verificar si es personal del sistema (chofer o empleada)
    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
      relations: { choferes: true, empleadas: true },
    });

    if (user) {
      if (user.rol === 'chofer' && user.choferes) {
        user.choferes.ubicacionLat = lat;
        user.choferes.ubicacionLng = lng;
        user.choferes.ultimaUbicacionAt = new Date();
        await this.usuariosRepository.manager.save(user.choferes);
        if (!isEdited) {
          await ctx.reply(
            `📍 Ubicación inicial registrada para el chofer: ${user.choferes.nombre}`,
          );
        }
        return;
      }

      if (user.rol === 'empleada' && user.empleadas) {
        user.empleadas.ubicacionLat = lat;
        user.empleadas.ubicacionLng = lng;
        user.empleadas.ultimaUbicacionAt = new Date();
        await this.usuariosRepository.manager.save(user.empleadas);
        if (!isEdited) {
          await ctx.reply(
            `📍 Ubicación inicial registrada para la empleada: ${user.empleadas.nombreArtistico}`,
          );
        }
        return;
      }
    }

    // Si no es personal, continuar flujo de cliente
    const step = ctx.session?.step;
    if (
      step !== 'AWAITING_LOCATION' &&
      step !== 'AWAITING_LOCATION_ENCADENADO'
    ) {
      await ctx.reply(
        'Por favor, inicia la contratación de una empleada desde el catálogo primero.',
      );
      return;
    }

    const isEncadenado = step === 'AWAITING_LOCATION_ENCADENADO';

    const { empleadaId, duracionPactadaHoras, metodoPago, servicioPrevioId } =
      ctx.session || {};

    if (!empleadaId || !duracionPactadaHoras || !metodoPago) {
      await ctx.reply(
        '❌ Datos incompletos del proceso. Por favor inicia nuevamente.',
      );
      if (ctx.session) ctx.session = {};
      return;
    }

    const client = await this.clientesRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!client) {
      await ctx.reply('❌ Cliente no encontrado. Por favor inicia con /start');
      ctx.session = {};
      return;
    }

    const empleada = await this.empleadasRepository.findOne({
      where: { id: empleadaId },
    });

    if (!empleada) {
      await ctx.reply('La empleada seleccionada ya no está disponible.');
      ctx.session = {};
      return;
    }

    const isIndependent = empleada.tipo === 'independiente';
    let jefeId: string;

    if (isIndependent) {
      jefeId = empleada.usuarioId;
    } else {
      let jefe: Usuarios | null = null;
      if (empleada.jefeId) {
        jefe = await this.usuariosRepository.findOne({
          where: { id: empleada.jefeId, activo: true },
        });
      }
      if (!jefe) {
        jefe = await this.usuariosRepository.findOne({
          where: [
            { rol: 'jefe', activo: true },
            { rol: 'admin', activo: true },
          ],
        });
      }

      if (!jefe) {
        await ctx.reply(
          '❌ No hay ningún jefe o administrador activo asignado en el sistema en este momento para autorizar el servicio.',
        );
        return;
      }
      jefeId = jefe.id;
    }

    // ─── FLUJO ENCADENADO ───────────────────────────────────────────────────
    if (isEncadenado) {
      const nuevoServicioEnc = this.serviciosRepository.create({
        clienteId: client.id,
        empleadaId: empleada.id,
        jefeId: jefeId,
        duracionPactadaHoras: duracionPactadaHoras.toString(),
        metodoPago: metodoPago,
        ubicacionClienteLat: lat,
        ubicacionClienteLng: lng,
        precioBaseHoraPactado: empleada.precioBaseHora.toString(),
        estado: 'pendiente_encadenado',
        notas: notasUbicacion,
        servicioPrevioId: servicioPrevioId || null,
        clienteTelegramId: telegramId,
        iaActiva: false,
      });
      await this.serviciosRepository.save(nuevoServicioEnc);

      const jefeUser = await this.usuariosRepository.findOne({
        where: { id: jefeId },
      });
      if (jefeUser && jefeUser.grupoTelegramId) {
        try {
          const clientName =
            client.nombreTelegram || ctx.from?.first_name || 'Cliente';
          const topic = await ctx.telegram.createForumTopic(
            jefeUser.grupoTelegramId,
            `👤 Cliente: ${clientName}`,
          );
          nuevoServicioEnc.telegramThreadId =
            topic.message_thread_id.toString();

          const detailsMsg =
            `📋 *Información del Servicio (Cita Encadenada):*\n\n` +
            `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
            `• *Empleada:* ${empleada.nombreArtistico}\n` +
            `• *Duración:* ${duracionPactadaHoras} horas\n` +
            `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
            `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
            (notasUbicacion ? `• *Ubicación/Notas:* ${notasUbicacion}\n` : '') +
            `• *Estado:* Pendiente Encadenada`;
          await ctx.telegram.sendMessage(jefeUser.grupoTelegramId, detailsMsg, {
            message_thread_id: topic.message_thread_id,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '🟢 Aceptar',
                  `jefe_autorizar:${nuevoServicioEnc.id}:1`,
                ),
                Markup.button.callback(
                  '🔴 Rechazar',
                  `jefe_autorizar:${nuevoServicioEnc.id}:0`,
                ),
              ],
            ]),
          });
          await ctx.telegram.sendLocation(
            jefeUser.grupoTelegramId,
            parseFloat(lat),
            parseFloat(lng),
            { message_thread_id: topic.message_thread_id },
          );
        } catch (err) {
          this.logger.error(
            'Error al crear forum topic para servicio encadenado:',
            err,
          );
        }
      }
      await this.serviciosRepository.save(nuevoServicioEnc);

      // Calculate estimated start time from the active service
      let horaEstimadaStr = 'próximamente';
      if (servicioPrevioId) {
        const servicioActivo = await this.serviciosRepository.findOne({
          where: { id: servicioPrevioId },
        });
        if (servicioActivo?.horaInicioServicio) {
          const estimada = new Date(
            servicioActivo.horaInicioServicio.getTime() +
              Number(servicioActivo.duracionPactadaHoras) * 60 * 60 * 1000,
          );
          // Save to the new chained service
          nuevoServicioEnc.horaInicioEstimada = estimada;
          await this.serviciosRepository.save(nuevoServicioEnc);
          horaEstimadaStr = estimada.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
          });
        }
      }

      ctx.session = {};

      let msgEnc =
        `📅 *¡Cita Encadenada Registrada!*\n\n` +
        `📝 *Resumen:*\n` +
        `• *Empleada:* ${empleada.nombreArtistico}\n` +
        `• *Duración:* ${duracionPactadaHoras} horas\n` +
        `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
        `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
        `• *Inicio estimado:* ${horaEstimadaStr}\n\n` +
        `⏳ Tu cita está en la lista de espera. Te avisaremos tan pronto la empleada quede libre.\n` +
        `Puedes cancelar esta reserva presionando el botón de abajo:`;

      if (notasUbicacion) {
        msgEnc += `\n• *Ubicación:* ${notasUbicacion}`;
      }

      const msgEnviadoEnc = await ctx.reply(msgEnc, {
        parse_mode: 'Markdown',
        ...Markup.removeKeyboard(),
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '❌ Cancelar esta Reserva',
              `cancelar_encadenado:${nuevoServicioEnc.id}`,
            ),
          ],
        ]),
      });

      nuevoServicioEnc.telegramClienteMensajeId =
        msgEnviadoEnc.message_id.toString();
      await this.serviciosRepository.save(nuevoServicioEnc);

      // Notify jefe of new chained service
      try {
        await this.telegramService.notifyJefesNewService(nuevoServicioEnc.id);
      } catch (err) {
        console.error('Error notificando jefe sobre cita encadenada:', err);
      }

      return;
    }

    // ─── FLUJO NORMAL ────────────────────────────────────────────────────────
    const nuevoServicio = this.serviciosRepository.create({
      clienteId: client.id,
      empleadaId: empleada.id,
      jefeId: jefeId,
      duracionPactadaHoras: duracionPactadaHoras.toString(),
      metodoPago: metodoPago,
      ubicacionClienteLat: lat,
      ubicacionClienteLng: lng,
      precioBaseHoraPactado: empleada.precioBaseHora.toString(),
      estado: 'pendiente',
      notas: notasUbicacion,
      clienteTelegramId: telegramId,
      iaActiva: false,
    });
    await this.serviciosRepository.save(nuevoServicio);

    const jefeUser = await this.usuariosRepository.findOne({
      where: { id: jefeId },
    });
    if (jefeUser && jefeUser.grupoTelegramId) {
      try {
        const clientName =
          client.nombreTelegram || ctx.from?.first_name || 'Cliente';
        const topic = await ctx.telegram.createForumTopic(
          jefeUser.grupoTelegramId,
          `👤 Cliente: ${clientName}`,
        );
        nuevoServicio.telegramThreadId = topic.message_thread_id.toString();

        const detailsMsg =
          `📋 *Información del Servicio:*\n\n` +
          `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
          `• *Empleada:* ${empleada.nombreArtistico}\n` +
          `• *Duración:* ${duracionPactadaHoras} horas\n` +
          `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
          `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
          (notasUbicacion ? `• *Ubicación/Notas:* ${notasUbicacion}\n` : '') +
          `• *Estado:* Pendiente`;
        await ctx.telegram.sendMessage(jefeUser.grupoTelegramId, detailsMsg, {
          message_thread_id: topic.message_thread_id,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '🟢 Aceptar',
                `jefe_autorizar:${nuevoServicio.id}:1`,
              ),
              Markup.button.callback(
                '🔴 Rechazar',
                `jefe_autorizar:${nuevoServicio.id}:0`,
              ),
            ],
          ]),
        });
        await ctx.telegram.sendLocation(
          jefeUser.grupoTelegramId,
          parseFloat(lat),
          parseFloat(lng),
          { message_thread_id: topic.message_thread_id },
        );
      } catch (err) {
        this.logger.error(
          'Error al crear forum topic para servicio normal:',
          err,
        );
      }
    }
    await this.serviciosRepository.save(nuevoServicio);

    // Emit event to Jefes in real-time
    const serviceWithRelations = await this.serviciosRepository.findOne({
      where: { id: nuevoServicio.id },
      relations: { cliente: true, empleada: true },
    });
    if (serviceWithRelations) {
      this.realtimeEventsService.emitToJefes({
        type: 'service_requested',
        data: serviceWithRelations,
      });

      try {
        await this.telegramService.notifyJefesNewService(
          serviceWithRelations.id,
        );
      } catch (err) {
        console.error(
          'Error al enviar notificaciones de Telegram para el nuevo servicio:',
          err,
        );
      }
    }

    ctx.session = {};

    let msgExito =
      `🎉 *¡Servicio Solicitado con Éxito!*\n\n` +
      `📝 *Resumen del Servicio:*\n` +
      `• *Empleada:* ${empleada.nombreArtistico}\n` +
      `• *Duración:* ${duracionPactadaHoras} horas\n` +
      `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
      `• *Tarifa Pactada:* $${empleada.precioBaseHora}/hr\n` +
      `• *Estado:* Pendiente de aprobación\n`;

    if (notasUbicacion) {
      msgExito += `• *Ubicación:* ${message.venue.title} (${message.venue.address})\n`;
    }

    msgExito += `\nPronto un administrador se pondrá en contacto contigo. ¡Gracias por tu preferencia!`;

    const msg = await ctx.reply(msgExito, {
      parse_mode: 'Markdown',
      ...Markup.removeKeyboard(),
    });

    nuevoServicio.telegramClienteMensajeId = msg.message_id.toString();
    await this.serviciosRepository.save(nuevoServicio);
  }

  @Action(/^extender_servicio:(.+):(.+)$/)
  async onExtenderServicio(@Ctx() ctx: Context) {
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];
    const horasAExtender = parseInt(match[2], 10);

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: { empleada: { usuario: true } },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.');
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery('⚠️ El servicio ya no está activo.');
      return;
    }

    // Actualizar duracion pactada
    const nuevaDuracion =
      Number(servicio.duracionPactadaHoras) + horasAExtender;
    servicio.duracionPactadaHoras = nuevaDuracion.toString();
    // Resetear flag para que pueda volver a notificar 15 minutos antes de la nueva hora
    servicio.notificacionExtensionEnviada = false;

    await this.serviciosRepository.save(servicio);
    await ctx.answerCbQuery('✅ Servicio extendido con éxito.');

    // Volver a cargar para ver los totales actualizados por los triggers de Postgres
    const servicioActualizado = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    const total = servicioActualizado?.totalFinal || servicio.totalFinal;

    try {
      await ctx.editMessageText(
        `✅ *Servicio Extendido* ➕${horasAExtender}h\n\n` +
          `• Nueva Duración Pactada: *${nuevaDuracion} horas*\n` +
          `• Nuevo Total Estimado: *$${total}*\n\n` +
          `El cambio ha sido registrado automáticamente en el sistema.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('Error al editar mensaje de extensión:', err);
    }

    // Notificar a los clientes de los servicios encadenados que la hora estimada cambió
    try {
      const serviciosEncadenados = await this.serviciosRepository.find({
        where: { servicioPrevioId: servicioId, estado: 'pendiente_encadenado' },
        relations: { cliente: true },
        order: { createdAt: 'ASC' },
      });

      let horaBase = servicio.horaInicioServicio
        ? new Date(
            servicio.horaInicioServicio.getTime() +
              nuevaDuracion * 60 * 60 * 1000,
          )
        : null;

      for (const enc of serviciosEncadenados) {
        if (!enc.cliente?.telegramChatId) continue;

        const horaEstimadaStr = horaBase
          ? horaBase.toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'próximamente';

        try {
          await ctx.telegram.sendMessage(
            enc.cliente.telegramChatId,
            `⚠️ *Actualización de tu Cita Reservada*\n\n` +
              `La empleada *${servicio.empleada?.nombreArtistico || ''}* extendió su servicio actual.\n` +
              `• Nueva hora de inicio estimada para tu cita: *${horaEstimadaStr}*\n\n` +
              `Te avisaremos cuando esté lista para atenderte.`,
            { parse_mode: 'Markdown' },
          );
        } catch (tgErr) {
          console.error(
            `Error notificando cliente encadenado (chatId: ${enc.cliente.telegramChatId}):`,
            tgErr,
          );
        }

        // Advance the window for next service in queue
        if (horaBase) {
          horaBase = new Date(
            horaBase.getTime() +
              Number(enc.duracionPactadaHoras) * 60 * 60 * 1000,
          );
        }
      }
    } catch (encErr) {
      console.error(
        'Error al notificar clientes encadenados de extensión:',
        encErr,
      );
    }
  }

  @Action(/^cancelar_encadenado:(.+)$/)
  async onCancelarEncadenado(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const servicioId = match[1];
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Find the client
    const client = await this.clientesRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!client) {
      await ctx.reply('❌ Cliente no encontrado.');
      return;
    }

    try {
      await this.servicesService.cancelarServicioEncadenado(
        servicioId,
        client.id,
      );

      try {
        await ctx.editMessageText(
          `❌ *Reserva Cancelada*\n\nTu cita encadenada ha sido cancelada exitosamente. Para iniciar una nueva, por favor utiliza un enlace de contratación desde nuestra web.`,
          {
            parse_mode: 'Markdown',
          },
        );
      } catch (editErr) {
        await ctx.reply(`❌ Reserva cancelada exitosamente.`);
      }
    } catch (err: any) {
      await ctx.reply(
        `❌ No se pudo cancelar la reserva: ${err?.message || 'Error desconocido'}`,
      );
    }
  }

  @Action(/^no_extender_servicio:(.+)$/)
  async onNoExtenderServicio(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(
        `👍 Entendido. El servicio finalizará en el tiempo pactado inicialmente.`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('Error al editar mensaje de no extensión:', err);
    }
  }

  @On('text')
  async onMessage(@Ctx() ctx: BotContext) {
    const text = (ctx.message as { text?: string })?.text || '';
    const cleanText = text.trim().toLowerCase();

    const message = ctx.message as any;
    const threadId = message?.message_thread_id;
    const chatId = ctx.chat?.id?.toString();

    // Flujo 2: Respuestas del Jefe desde su Hilo hacia el Cliente (Webhook de Salida)
    if (
      threadId &&
      (ctx.chat?.type === 'supergroup' || ctx.chat?.type === 'group')
    ) {
      const cleanInput = text.trim();
      const isAccept = cleanInput === '🟢 Aceptar Servicio';
      const isReject = cleanInput === '🔴 Rechazar Servicio';

      if (isAccept || isReject) {
        try {
          const senderTelegramId = ctx.from?.id.toString();
          if (!senderTelegramId) return;

          const user = await this.usuariosRepository.findOne({
            where: { telegramChatId: senderTelegramId },
          });

          if (!user) {
            await ctx.reply(
              '❌ No tienes permisos o no estás registrado en el sistema.',
            );
            return;
          }

          const service = await this.serviciosRepository.findOne({
            where: {
              telegramThreadId: threadId.toString(),
              jefe: {
                grupoTelegramId: chatId,
              },
            },
            relations: { empleada: true, cliente: true },
          });

          if (!service) {
            await ctx.reply(
              '❌ No se encontró ningún servicio asociado a este hilo.',
            );
            return;
          }

          const isIndependentEmployee =
            service.empleada &&
            service.empleada.tipo === 'independiente' &&
            service.empleada.usuarioId === user.id;

          if (
            user.rol !== 'jefe' &&
            user.rol !== 'admin' &&
            !isIndependentEmployee
          ) {
            await ctx.reply(
              '❌ No tienes permisos para autorizar este servicio.',
            );
            return;
          }

          if (isAccept) {
            await this.servicesService.aceptar(service.id, user.id);
            await ctx.reply(
              `🟢 *Servicio Aceptado* por ${user.email}`,
              Markup.removeKeyboard(),
            );
          } else {
            await this.servicesService.rechazar(service.id, user.id);
          }
        } catch (err: any) {
          this.logger.error(
            'Error al autorizar servicio por Reply Keyboard:',
            err,
          );
          await ctx.reply(
            `❌ Error: ${err.message || 'Error al procesar la solicitud.'}`,
          );
        }
        return;
      }

      try {
        const service = await this.serviciosRepository.findOne({
          where: {
            telegramThreadId: threadId.toString(),
            jefe: {
              grupoTelegramId: chatId,
            },
          },
        });

        if (service && service.clienteTelegramId) {
          await ctx.telegram.sendMessage(service.clienteTelegramId, text);
        }
      } catch (err) {
        this.logger.error('Error en Flujo 2 (Respuesta del Jefe):', err);
      }
      return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    // Flujo 1: Mensajes del Cliente hacia el Súpergrupo del Jefe Asignado (Webhook de Entrada)
    if (ctx.chat?.type === 'private') {
      try {
        const activeService = await this.serviciosRepository.findOne({
          where: {
            clienteTelegramId: telegramId,
            estado: In(['pendiente', 'pendiente_encadenado', 'en_curso']),
          },
          relations: {
            jefe: true,
            cliente: true,
            empleada: true,
          },
          order: { createdAt: 'DESC' },
        });

        if (activeService && activeService.iaActiva === false) {
          const jefe = activeService.jefe;
          const grupoTelegramId = jefe?.grupoTelegramId;
          this.logger.log(
            `Procesando mensaje de cliente. activeService.id=${activeService.id}, jefeId=${jefe?.id}, grupoTelegramId=${grupoTelegramId}`,
          );

          if (!grupoTelegramId) {
            this.logger.error(
              `El jefe para el servicio ${activeService.id} no tiene configurado grupoTelegramId.`,
            );
            return;
          }

          if (!activeService.telegramThreadId) {
            const clientName =
              activeService.cliente?.nombreTelegram ||
              ctx.from?.first_name ||
              'Cliente';
            this.logger.log(
              `Creando tema de foro para cliente: ${clientName} en grupo: ${grupoTelegramId}`,
            );
            const topic = await ctx.telegram.createForumTopic(
              grupoTelegramId,
              `👤 Cliente: ${clientName}`,
            );
            this.logger.log(
              `Tema de foro creado con id: ${topic.message_thread_id}`,
            );
            activeService.telegramThreadId = topic.message_thread_id.toString();
            await this.serviciosRepository.save(activeService);

            const detailsMsg =
              `📋 *Información del Servicio:*\n\n` +
              `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
              `• *Empleada:* ${activeService.empleada?.nombreArtistico || 'N/A'}\n` +
              `• *Duración:* ${activeService.duracionPactadaHoras} horas\n` +
              `• *Método de Pago:* ${activeService.metodoPago.toUpperCase()}\n` +
              `• *Tarifa:* $${activeService.precioBaseHoraPactado}/hr\n` +
              (activeService.notas
                ? `• *Ubicación/Notas:* ${activeService.notas}\n`
                : '') +
              `• *Estado:* ${activeService.estado}`;
            const isPendiente =
              activeService.estado === 'pendiente' ||
              activeService.estado === 'pendiente_encadenado';
            const extraOptions: any = {
              message_thread_id: topic.message_thread_id,
              parse_mode: 'Markdown',
            };
            if (isPendiente) {
              Object.assign(
                extraOptions,
                Markup.keyboard([
                  ['🟢 Aceptar Servicio', '🔴 Rechazar Servicio'],
                ])
                  .resize()
                  .oneTime(),
              );
            }
            await ctx.telegram.sendMessage(
              grupoTelegramId,
              detailsMsg,
              extraOptions,
            );
          }

          try {
            await ctx.telegram.sendMessage(grupoTelegramId, text, {
              message_thread_id: parseInt(activeService.telegramThreadId),
            });
          } catch (sendErr: any) {
            if (
              sendErr?.response?.description?.includes(
                'message thread not found',
              ) ||
              sendErr?.message?.includes('message thread not found')
            ) {
              this.logger.warn(
                `El tema de foro ${activeService.telegramThreadId} no fue encontrado en el grupo. Recreándolo...`,
              );
              const clientName =
                activeService.cliente?.nombreTelegram ||
                ctx.from?.first_name ||
                'Cliente';
              const topic = await ctx.telegram.createForumTopic(
                grupoTelegramId,
                `👤 Cliente: ${clientName}`,
              );
              activeService.telegramThreadId =
                topic.message_thread_id.toString();
              await this.serviciosRepository.save(activeService);

              const detailsMsg =
                `📋 *Información del Servicio (Tema Recreado):*\n\n` +
                `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
                `• *Empleada:* ${activeService.empleada?.nombreArtistico || 'N/A'}\n` +
                `• *Duración:* ${activeService.duracionPactadaHoras} horas\n` +
                `• *Método de Pago:* ${activeService.metodoPago.toUpperCase()}\n` +
                `• *Tarifa:* $${activeService.precioBaseHoraPactado}/hr\n` +
                (activeService.notas
                  ? `• *Ubicación/Notas:* ${activeService.notas}\n`
                  : '') +
                `• *Estado:* ${activeService.estado}`;

              const isPendiente =
                activeService.estado === 'pendiente' ||
                activeService.estado === 'pendiente_encadenado';
              const extraOptions: any = {
                message_thread_id: topic.message_thread_id,
                parse_mode: 'Markdown',
              };
              if (isPendiente) {
                Object.assign(
                  extraOptions,
                  Markup.keyboard([
                    ['🟢 Aceptar Servicio', '🔴 Rechazar Servicio'],
                  ])
                    .resize()
                    .oneTime(),
                );
              }
              await ctx.telegram.sendMessage(
                grupoTelegramId,
                detailsMsg,
                extraOptions,
              );

              // Intentar enviar el mensaje original del cliente nuevamente en el nuevo hilo
              await ctx.telegram.sendMessage(grupoTelegramId, text, {
                message_thread_id: topic.message_thread_id,
              });
            } else {
              throw sendErr;
            }
          }
          return;
        }
      } catch (err) {
        this.logger.error('Error en Flujo 1 (Cliente -> Súpergrupo):', err);
      }
    }

    if (
      cleanText.includes('volver al menu') ||
      cleanText.includes('volver al menú') ||
      cleanText.includes('ver empleadas') ||
      cleanText.includes('ver ayuda') ||
      cleanText.includes('ayuda')
    ) {
      ctx.session = {};
      await ctx.reply(
        'Para contratar a una de nuestras empleadas, por favor utiliza el enlace de contratación directa en nuestra web.',
      );
      return;
    }

    const session = ctx.session;
    if (!session) return;
    const step = session.step;

    if (
      step === 'CHAT_CON_EMPLEADA' ||
      step === 'CHAT_CON_EMPLEADA_ENCADENADO'
    ) {
      const empleadaId = session.empleadaId;
      if (!empleadaId) {
        await ctx.reply(
          '❌ Sesión inválida. Por favor, selecciona una empleada nuevamente.',
        );
        ctx.session = {};
        return;
      }

      const empleada = await this.empleadasRepository.findOne({
        where: { id: empleadaId },
      });

      if (!empleada) {
        await ctx.reply('La empleada seleccionada ya no existe en el sistema.');
        ctx.session = {};
        return;
      }

      const userMessage = (ctx.message as { text?: string })?.text || '';
      if (!userMessage.trim()) return;

      const history = session.chatHistory || [];
      // Push the user's message to the history
      history.push({ role: 'user', parts: [{ text: userMessage }] });

      // Build the system prompt
      const systemPrompt = `Eres ${empleada.nombreArtistico}, una mujer de la vida galante muy coqueta, provocativa y sensual que trabaja de forma independiente.
Tarifa por hora: $${empleada.precioBaseHora}/hr.
Descripción: ${empleada.descripcion || 'Una persona hermosa y carismática'}.

Estás chateando en Telegram con un cliente interesado en contratar tus servicios a domicilio.
Tu objetivo es ser muy atrevida, coqueta y directa, pero con un tono conversacional natural y casual de chat (puedes usar emojis y modismos latinos/mexicanos naturales como "mi amor", "bebé", "lindo", "corazón").
Evita sonar robótica, formal o demasiado estructurada (no uses frases acartonadas como "por favor indícame", "gracias por tu preferencia"). Escribe como una persona real chateando de forma relajada y coqueta.
Sé breve (máximo 1 o 2 frases cortas por respuesta).

Debes obtener dos datos del cliente, pero de uno en uno de forma natural (no pidas ambos a la vez):
1. Primero, pregúntale de forma coqueta cuántas horas de servicio desea tener contigo.
2. Después de que te diga las horas, pregúntale cómo prefiere pagar (efectivo, tarjeta o transferencia).

Reglas de formato técnico:
- Cuando el cliente te haya dicho y confirmado tanto la duración como el método de pago, debes incluir exactamente al final de tu respuesta la siguiente marca en una sola línea para que el sistema la registre:
[DATA: {"duracion": X, "pago": "Y"}]
Donde X es la duración (número) y Y es el método de pago (debe ser: 'efectivo', 'tarjeta' o 'transferencia').`;

      try {
        await ctx.sendChatAction('typing');
        let responseText = await this.getGroqResponse(systemPrompt, history);

        // Check if response contains the structured DATA block
        const dataMatch = responseText.match(/\[DATA:\s*(\{.*?\})\]/);

        if (dataMatch) {
          try {
            const parsedData = JSON.parse(dataMatch[1]);
            if (parsedData.duracion && parsedData.pago) {
              session.duracionPactadaHoras = parseFloat(parsedData.duracion);
              session.metodoPago = parsedData.pago;

              // Transition step to AWAITING_LOCATION
              session.step =
                step === 'CHAT_CON_EMPLEADA_ENCADENADO'
                  ? 'AWAITING_LOCATION_ENCADENADO'
                  : 'AWAITING_LOCATION';

              // Clean the DATA block from the text response
              responseText = responseText
                .replace(/\[DATA:\s*\{.*?\}\]/g, '')
                .trim();

              // Push final response to history
              history.push({ role: 'model', parts: [{ text: responseText }] });
              session.chatHistory = history;

              await this.sendDelayedReply(ctx, responseText);

              // Prompt for location sharing with a small extra delay
              await ctx.sendChatAction('typing');
              await new Promise((resolve) => setTimeout(resolve, 1500));
              await ctx.reply(
                `📍 *¡Excelente! Ya tengo los detalles anotados (Duración: ${parsedData.duracion} horas, Pago: ${parsedData.pago.toUpperCase()}).*\n\n` +
                  `Por último, ¿me compartes tu ubicación con el botón de abajo para registrar tu pedido?`,
                {
                  parse_mode: 'Markdown',
                  ...Markup.keyboard([
                    [
                      Markup.button.locationRequest(
                        '📍 Compartir mi Ubicación',
                      ),
                    ],
                  ])
                    .oneTime()
                    .resize(),
                },
              );
              return;
            }
          } catch (jsonErr) {
            this.logger.error(
              'Failed to parse Gemini extracted JSON data:',
              jsonErr,
            );
          }
        }

        // Push model response to history
        history.push({ role: 'model', parts: [{ text: responseText }] });
        session.chatHistory = history;

        await this.sendDelayedReply(ctx, responseText);
      } catch (err) {
        this.logger.error('Error in LLM booking chat flow:', err);
        await this.sendDelayedReply(
          ctx,
          '¿Me podrías repetir la duración que necesitas y tu método de pago preferido (efectivo, tarjeta o transferencia)?',
        );
      }
      return;
    }

    if (step === 'AWAITING_DURATION') {
      const text = (ctx.message as { text?: string })?.text || '';
      const duracion = parseFloat(text.replace(',', '.'));

      if (isNaN(duracion) || duracion <= 0) {
        await ctx.reply(
          '❌ La duración debe ser un número válido mayor a 0 (ejemplo: 2 o 3.5).\n' +
            'Por favor, intenta nuevamente:',
        );
        return;
      }

      ctx.session!.duracionPactadaHoras = duracion;
      ctx.session!.step = 'AWAITING_PAYMENT_METHOD';

      await ctx.reply(
        `⏱️ Duración registrada: *${duracion} horas*.\n\n` +
          `💳 Ahora, selecciona el método de pago:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💵 Efectivo', 'pago_efectivo'),
              Markup.button.callback('💳 Tarjeta', 'pago_tarjeta'),
            ],
            [Markup.button.callback('🏦 Transferencia', 'pago_transferencia')],
          ]),
        },
      );
      return;
    }

    if (step === 'AWAITING_RATING_COMMENT') {
      const text = (ctx.message as { text?: string })?.text || '';
      const comments = text.trim();

      if (!comments) {
        await ctx.reply(
          '❌ El comentario es obligatorio para calificaciones de 2 estrellas o menos.\n' +
            'Por favor, indícanos qué podemos mejorar:',
        );
        return;
      }

      const sentimentPrompt = `Analiza el siguiente comentario de reseña del cliente sobre el servicio de una empleada y clasifica el sentimiento.
        Responde estrictamente con un formato JSON en una sola línea. No incluyas explicaciones ni etiquetas markdown.
        JSON format: {"sentimiento": "positivo" | "neutral" | "negativo", "enojo": true | false, "score": 1 | 2 | 3 | 4 | 5}
        Definiciones:
        - "sentimiento": estado de ánimo general del comentario (positivo, neutral o negativo).
        - "enojo": true si el cliente expresa frustración extrema, ira, molestia o quejas graves que requieren soporte humano inmediato.
        - "score": una calificación sugerida del 1 al 5 basada exclusivamente en las palabras del comentario.

        Comentario del cliente: "${comments}"`;

      let analysisResult = { sentimiento: 'neutral', enojo: false, score: 2 };
      try {
        const responseText = await this.getGroqResponse(sentimentPrompt, []);
        const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          analysisResult = JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        console.error('Error al analizar sentimiento con IA:', err);
      }

      const servicioId = ctx.session?.servicioIdCalificacion;
      if (servicioId) {
        const servicio = await this.serviciosRepository.findOne({
          where: { id: servicioId },
          relations: {
            cliente: true,
            empleada: { usuario: true, jefe: true },
            jefe: true,
          },
        });
        if (servicio) {
          servicio.comentariosCalificacion = comments;

          // Si el análisis de IA sugiere una calificación y no se definió antes, o si queremos reajustarla:
          if (!servicio.calificacion) {
            servicio.calificacion = analysisResult.score;
          }

          await this.serviciosRepository.save(servicio);

          // Si se detecta enojo o frustración grave, alertar al Jefe/Admin de inmediato
          if (analysisResult.enojo) {
            const jefeGrupoId =
              servicio.jefe?.grupoTelegramId ||
              servicio.empleada?.jefe?.grupoTelegramId;
            const jefeChatId =
              servicio.jefe?.telegramChatId ||
              servicio.empleada?.jefe?.telegramChatId;

            const alertMsg =
              `⚠️ *ALERTA DE CLIENTE MOLESTO* ⚠️\n\n` +
              `Un cliente ha dejado una reseña expresando molestia o enojo grave:\n\n` +
              `• *Cliente:* ${servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
              `• *Empleada:* ${servicio.empleada?.nombreArtistico || 'N/A'}\n` +
              `• *Calificación:* ${servicio.calificacion} ⭐\n` +
              `• *Comentario:* "${comments}"\n\n` +
              `• *Análisis de IA:* Sentimiento: *${analysisResult.sentimiento.toUpperCase()}* (Enojo Detectado)\n\n` +
              `Por favor, contacta al cliente de inmediato para resolver la situación.`;

            if (jefeGrupoId) {
              try {
                await ctx.telegram.sendMessage(jefeGrupoId, alertMsg, {
                  parse_mode: 'Markdown',
                });
              } catch (e) {
                console.error('Error al enviar alerta a grupo de Jefe:', e);
              }
            } else if (jefeChatId) {
              try {
                await ctx.telegram.sendMessage(jefeChatId, alertMsg, {
                  parse_mode: 'Markdown',
                });
              } catch (e) {
                console.error('Error al enviar alerta privada a Jefe:', e);
              }
            }
          }
        }
      }

      ctx.session = {};

      await ctx.reply(
        `Muchas gracias por tus comentarios. Valoramos mucho tu opinión para seguir mejorando.`,
        Markup.removeKeyboard(),
      );
      return;
    }

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (user) {
      await ctx.reply(
        `Hola ${user.email} (${user.rol.toUpperCase()}). He recibido tu mensaje. ` +
          `Como personal del sistema, tus consultas se procesarán de inmediato.`,
      );
      return;
    }

    let client = await this.clientesRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!client) {
      const firstName = ctx.from?.first_name || '';
      const username = ctx.from?.username || '';
      const fullName =
        [firstName, ctx.from?.last_name].filter(Boolean).join(' ') ||
        username ||
        'Cliente';

      client = this.clientesRepository.create({
        telegramChatId: telegramId,
        nombreTelegram: fullName,
      });
      await this.clientesRepository.save(client);
    }

    await ctx.reply(
      `Hola ${client.nombreTelegram || 'Cliente'}. ` +
        `He recibido tu mensaje. Un administrador se pondrá en contacto contigo pronto.`,
    );
  }

  @Action(/^pedir_prorroga:(.+)$/)
  async onPedirProrroga(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const match = (ctx as any).match;
    const servicioId = match[1];

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        empleada: { usuario: true },
        viajes: { chofer: { usuario: true } },
      },
    });

    if (!servicio) {
      await ctx.answerCbQuery('❌ Servicio no encontrado.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery(
        '⚠️ Este servicio ya no está en curso o fue cancelado.',
        { show_alert: true },
      );
      return;
    }

    if (servicio.prorrogasUsadas >= 3) {
      await ctx.answerCbQuery(
        '❌ Ya has utilizado el máximo de 3 prórrogas permitidas.',
        { show_alert: true },
      );
      return;
    }

    await ctx.answerCbQuery('Prórroga de 10 minutos concedida.');

    // Incrementar prórrogas usadas
    servicio.prorrogasUsadas += 1;
    await this.serviciosRepository.save(servicio);

    // Reiniciar wait timeout a 10 minutos (600,000 ms)
    this.servicesService.startWaitTimeout(servicio.id, 600000);

    // Notificar al chofer
    const viajeIda = servicio.viajes.find((v) => v.tipo === 'ida');
    if (viajeIda && viajeIda.chofer?.usuario?.telegramChatId) {
      try {
        await ctx.telegram.sendMessage(
          viajeIda.chofer.usuario.telegramChatId,
          `⏳ *Aviso de Demora:* La empleada *${servicio.empleada.nombreArtistico}* ha solicitado una prórroga de 10 minutos (Prórroga ${servicio.prorrogasUsadas} de 3). El tiempo de espera se ha extendido.`,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        console.error('Error al notificar al chofer sobre la prórroga:', err);
      }
    }

    // Actualizar mensaje de la empleada
    let originalText = (ctx.callbackQuery?.message as any)?.text || '';
    // Limpiar alertas de prórroga previas
    originalText = originalText.replace(/\n\n⚠️ \*Has solicitado.*?\*/g, '');

    const newText =
      originalText +
      `\n\n⚠️ *Has solicitado una prórroga. Has usado ${servicio.prorrogasUsadas} de 3 prórrogas.*`;

    // Si aún tiene prórrogas disponibles, mantener el botón. De lo contrario, quitarlo.
    const inlineButtons: any[][] = [];
    if (servicio.prorrogasUsadas < 3) {
      inlineButtons.push([
        Markup.button.callback(
          '⏳ Solicitar Prórroga (10 min)',
          `pedir_prorroga:${servicio.id}`,
        ),
      ]);
    }

    try {
      await ctx.editMessageText(newText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(inlineButtons),
      });
    } catch (err) {
      console.error('Error al editar mensaje de empleada tras prórroga:', err);
    }
  }
}
