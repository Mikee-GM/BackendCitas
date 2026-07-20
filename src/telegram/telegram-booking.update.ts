import {
  Inject,
  forwardRef,
  Logger,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { Update, Ctx, Action, On } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Choferes } from '../drivers/entities/driver.entity';
import { Servicios } from '../services/entities/service.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { ServicesService } from '../services/services.service';
import { TelegramService } from './telegram.service';
import { TelegramAuthUpdate } from './telegram-auth.update';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { ExtrasServicio } from '../service-extras/entities/service-extra.entity';
import { TelegramBookingService } from './telegram-booking.service';
import {
  getHireSystemPrompt,
  getGeneralChatSystemPrompt,
  getSentimentPrompt,
} from '../ai/prompts/prompts';
import { clientMessages } from './client-messages';
import { AiMessageService } from '../ai/ai-message.service';
import { ConversacionesTelegram } from '../telegram-conversations/entities/telegram-conversation.entity';
import { EmployeeReportsService } from '../employee-reports/employee-reports.service';
import { ReportCategory } from '../employee-reports/entities/employee-report.entity';
import {
  buildReportCategoryCallback,
  parseReportCategoryCode,
} from '../employee-reports/report-callback';
import { ExtensionsService } from '../extensions/extensions.service';
import { TransportOperationsService } from '../transport-operations/transport-operations.service';

interface SessionData {
  step?:
    | 'AWAITING_DURATION'
    | 'AWAITING_PAYMENT_METHOD'
    | 'AWAITING_LOCATION'
    | 'AWAITING_RATING_COMMENT'
    | 'AWAITING_CLIENT_REPORT_DESCRIPTION'
    | 'AWAITING_UBER_SCREENSHOT'
    | 'AWAITING_UBER_FARE_ACTION'
    | 'AWAITING_UBER_FARE'
    | 'CHAT_CON_EMPLEADA';
  empleadaId?: string;
  duracionPactadaHoras?: number;
  metodoPago?: 'efectivo' | 'tarjeta' | 'transferencia';
  servicioIdCalificacion?: string;
  reportServiceId?: string;
  reportCategory?: ReportCategory;
  reportDescription?: string;
  uberTripId?: string;
  pendingUberFare?: number;
  presetLocationId?: string;
  locationNameSnapshot?: string;
  locationAddressSnapshot?: string;
  customerTransportCharge?: number;
  chatHistory?: { role: 'user' | 'model'; parts: { text: string }[] }[];
  extraSelection?: {
    servicioId: string;
    extraId: string;
  };
}

interface BotContext extends Context {
  session?: SessionData;
}

export function isUberAdminInputSession(session?: { step?: string }): boolean {
  return (
    session?.step === 'AWAITING_UBER_SCREENSHOT' ||
    session?.step === 'AWAITING_UBER_FARE_ACTION' ||
    session?.step === 'AWAITING_UBER_FARE'
  );
}

export function parseUberFareInput(text: string): number | undefined {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

export function extractHireDuration(text: string): number | undefined {
  const match = text.match(
    /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)?(?:\s|$)/i,
  );
  if (match) {
    const duration = Number(match[1].replace(',', '.'));
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  }

  const normalized = text.toLowerCase().trim();
  const wordDurations: Record<string, number> = {
    una: 1,
    un: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
  };
  const word = Object.keys(wordDurations).find(
    (candidate) =>
      normalized === candidate ||
      new RegExp(`\\b${candidate}\\s+horas?\\b`).test(normalized),
  );
  return word ? wordDurations[word] : undefined;
}

export function extractHirePaymentMethod(
  text: string,
): SessionData['metodoPago'] | undefined {
  const normalized = text.toLowerCase();
  if (/\befectivo\b/.test(normalized)) return 'efectivo';
  if (/\btarjeta\b/.test(normalized)) return 'tarjeta';
  if (/\btransferencia\b/.test(normalized)) return 'transferencia';
  return undefined;
}

@Update()
export class TelegramBookingUpdate implements BeforeApplicationShutdown {
  private readonly logger = new Logger(TelegramBookingUpdate.name);
  private readonly userLocationCache = new Map<
    string,
    {
      id: string;
      rol: string;
      name: string;
      lat: number;
      lng: number;
      lastSaved: number;
      dirty: boolean;
    }
  >();

  private readonly locationCleanupInterval: NodeJS.Timeout;

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
    @InjectRepository(ConversacionesTelegram)
    private readonly conversationsRepository: Repository<ConversacionesTelegram>,
    private readonly realtimeEventsService: RealtimeEventsService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => TelegramAuthUpdate))
    private readonly telegramAuthUpdate: TelegramAuthUpdate,
    @Inject(forwardRef(() => LoyaltyService))
    private readonly loyaltyService: LoyaltyService,
    private readonly telegramBookingService: TelegramBookingService,
    private readonly aiMessageService: AiMessageService,
    private readonly employeeReportsService: EmployeeReportsService,
    private readonly extensionsService: ExtensionsService,
    private readonly transportOperations: TransportOperationsService,
  ) {
    // TTL / Inactivity Cleanup: run every 5 minutes to clean up users inactive for > 1 hour
    this.locationCleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, cached] of this.userLocationCache.entries()) {
        if (now - cached.lastSaved > 3600000) {
          this.userLocationCache.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.logger.log(
          `Inactivity cleanup: removed ${cleaned} inactive users from location cache.`,
        );
      }
    }, 300000);
  }

  // Graceful Shutdown Hook: Flush any dirty/unsaved location updates to DB
  async beforeApplicationShutdown() {
    if (this.locationCleanupInterval) {
      clearInterval(this.locationCleanupInterval);
    }
    this.logger.log(
      'Graceful shutdown: flushing dirty locations to database...',
    );
    let flushedCount = 0;
    for (const [telegramId, cached] of this.userLocationCache.entries()) {
      if (cached.dirty) {
        try {
          if (cached.rol === 'chofer') {
            await this.usuariosRepository.manager.update(Choferes, cached.id, {
              ubicacionLat: cached.lat,
              ubicacionLng: cached.lng,
              ultimaUbicacionAt: new Date(cached.lastSaved),
            });
            flushedCount++;
          } else if (cached.rol === 'empleada') {
            await this.usuariosRepository.manager.update(Empleadas, cached.id, {
              ubicacionLat: cached.lat,
              ubicacionLng: cached.lng,
              ultimaUbicacionAt: new Date(cached.lastSaved),
            });
            flushedCount++;
          }
          cached.dirty = false;
        } catch (err) {
          this.logger.error(
            `Error flushing location for telegramId=${telegramId}:`,
            err,
          );
        }
      }
    }
    if (flushedCount > 0) {
      this.logger.log(
        `Gracefully flushed ${flushedCount} locations to database.`,
      );
    }
  }

  // Helper function to calculate distance in meters using Haversine formula
  private getDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) *
        Math.cos(phi2) *
        Math.sin(deltaLambda / 2) *
        Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
  }

  async getGroqResponse(
    systemPrompt: string,
    history: { role: 'user' | 'model'; parts: { text: string }[] }[],
    clientTelegramId?: string,
  ): Promise<string> {
    return this.telegramBookingService.getGroqResponse(
      systemPrompt,
      history,
      clientTelegramId,
    );
  }

  async sendDelayedReply(ctx: BotContext, text: string) {
    try {
      const delayMs = 1000; // 30 segundos (medio minuto)

      // Enviar la acción de "escribiendo" de inmediato
      await ctx.sendChatAction('typing').catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, delayMs));

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

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      await ctx.reply(
        '⚠️ El sistema de IA no está configurado (falta GROQ_API_KEY en el servidor). Por favor contacta al administrador.',
      );
      return;
    }

    // Cada contratación debe comenzar sin datos residuales de servicios,
    // calificaciones o conversaciones anteriores.
    ctx.session = {
      step: 'CHAT_CON_EMPLEADA',
      empleadaId,
    };

    await ctx.reply(
      `Espere por favor, estamos poniéndonos en contacto con *${empleada.nombreArtistico}*...`,
      { parse_mode: 'Markdown' },
    );

    const systemPrompt = getHireSystemPrompt({
      nombreArtistico: empleada.nombreArtistico,
      precioBaseHora: empleada.precioBaseHora,
      descripcion: empleada.descripcion,
    });

    const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [
      { role: 'user', parts: [{ text: 'Hola' }] },
    ];

    const telegramId = ctx.from?.id?.toString();

    try {
      await ctx.sendChatAction('typing');
      const responseText = await this.getGroqResponse(
        systemPrompt,
        history,
        telegramId,
      );
      history.push({ role: 'model', parts: [{ text: responseText }] });
      ctx.session.chatHistory = history;

      await this.sendDelayedReply(ctx, responseText);
    } catch (err: any) {
      if (err?.message === 'AI_LIMIT_REACHED') {
        await ctx.reply(
          '⚠️ *Límite de IA alcanzado:* Has agotado tus consultas gratuitas de hoy con la Inteligencia Artificial. Por favor, intenta de nuevo mañana.',
          { parse_mode: 'Markdown' },
        );
        return;
      }
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
      await ctx.editMessageText(clientMessages.locationRequest(), {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Error al editar mensaje de pago:', err);
    }

    await this.replyWithServiceLocationOptions(ctx);
  }

  @Action(/^service_location:(external|[0-9a-f-]{36})$/)
  async onSelectServiceLocation(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    if (ctx.session?.step !== 'AWAITING_LOCATION') {
      await ctx.reply('No hay un proceso de contratación activo.');
      return;
    }
    const id = (ctx as any).match[1] as string;
    if (id === 'external') {
      const configuration = await this.transportOperations.getConfiguration();
      ctx.session.presetLocationId = undefined;
      ctx.session.locationNameSnapshot = undefined;
      ctx.session.locationAddressSnapshot = undefined;
      ctx.session.customerTransportCharge = Number(
        configuration.externalLocationFee,
      );
      await this.replyWithLocationKeyboard(
        ctx,
        'Perfecto. En ese caso, mándame el pin del lugar donde quieres que nos encontremos.',
      );
      return;
    }
    const location = (await this.transportOperations.activeLocations()).find(
      (item) => item.id === id,
    );
    if (!location) {
      await ctx.reply('La ubicación seleccionada ya no está disponible.');
      return;
    }
    ctx.session.presetLocationId = location.id;
    ctx.session.locationNameSnapshot = location.name;
    ctx.session.locationAddressSnapshot = location.address;
    ctx.session.customerTransportCharge = 0;
    await this.onLocation(ctx, {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      title: location.name,
      address: location.address,
    });
  }

  private async replyWithLocationKeyboard(
    ctx: BotContext,
    text: string,
  ): Promise<void> {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.keyboard([
        [Markup.button.locationRequest('📍 Compartir mi Ubicación')],
      ])
        .oneTime()
        .resize(),
    });
  }

  private async replyWithServiceLocationOptions(
    ctx: BotContext,
    introduction = 'Oye, mira: te voy a mostrar unas opciones para que me digas dónde quieres que nos encontremos. Elige la que te quede mejor y, si ninguna te sirve, selecciona “Otra ubicación”.',
  ): Promise<void> {
    const locations = await this.transportOperations.activeLocations();
    const rows = locations.map((location) => [
      Markup.button.callback(location.name, `service_location:${location.id}`),
    ]);
    rows.push([
      Markup.button.callback('Otra ubicación', 'service_location:external'),
    ]);
    await ctx.reply(introduction, {
      ...Markup.removeKeyboard(),
      ...Markup.inlineKeyboard(rows),
    });
  }

  @Action(/^agregar_extra_list:(.+)$/)
  async onAgregarExtraList(@Ctx() ctx: BotContext) {
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

    if (!(await this.isAssignedEmployee(ctx, servicio))) {
      await ctx.answerCbQuery('No puedes modificar este servicio.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery('Este servicio ya no está activo.', {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

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

    if (!(await this.isAssignedEmployee(ctx, servicio))) {
      await ctx.answerCbQuery('No puedes modificar este servicio.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery('Este servicio ya no está activo.', {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

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

    if (!(await this.isAssignedEmployee(ctx, servicio))) {
      await ctx.answerCbQuery('No puedes modificar este servicio.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery('Este servicio ya no está activo.', {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

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

    if (!(await this.isAssignedEmployee(ctx, servicio))) {
      await ctx.answerCbQuery('No puedes modificar este servicio.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery('Este servicio ya no está activo.', {
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

  @Action(/^eu:([^:]+):([if])$/)
  async onEmployeeUberStatus(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;
    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });
    if (!user)
      return ctx.answerCbQuery('Usuario no autorizado', { show_alert: true });
    const match = (ctx as any).match;
    try {
      await this.servicesService.updateUberStatus(
        match[1],
        user.id,
        match[2] === 'f' ? 'employee_arrived' : 'employee_en_route',
      );
      await ctx.answerCbQuery(
        match[2] === 'f' ? 'Llegada registrada' : 'Cliente notificado',
      );
      if (match[2] === 'i') {
        await ctx.editMessageText(
          'Cuando llegues al destino, confirma tu llegada.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📍 Ya llegué', `eu:${match[1]}:f`)],
            ]),
          },
        );
      } else {
        (ctx as any).session = {
          ...(ctx.session ?? {}),
          step: 'AWAITING_UBER_SCREENSHOT',
          uberTripId: match[1],
        };
        await ctx
          .editMessageText('Tu llegada quedó registrada.')
          .catch(() => undefined);
        await ctx.reply(
          'Ahora necesito que me envíes una captura de pantalla del resumen del viaje de Uber, donde se vea el costo final.',
        );
      }
    } catch (error: any) {
      await ctx.answerCbQuery(error.message, { show_alert: true });
    }
  }

  @On('photo')
  async onEmployeeUberScreenshot(@Ctx() ctx: BotContext) {
    if (
      ctx.session?.step !== 'AWAITING_UBER_SCREENSHOT' ||
      !ctx.session.uberTripId
    )
      return;
    const telegramId = ctx.from?.id.toString();
    const user = telegramId
      ? await this.usuariosRepository.findOne({
          where: { telegramChatId: telegramId },
        })
      : null;
    const photos = (ctx.message as any)?.photo as
      | Array<{ file_id: string }>
      | undefined;
    const fileId = photos?.[photos.length - 1]?.file_id;
    if (!user || !fileId) {
      await ctx.reply(
        'No fue posible procesar la captura. Intenta nuevamente.',
      );
      return;
    }
    try {
      const trip = await this.servicesService.saveEmployeeUberScreenshot(
        ctx.session.uberTripId,
        user.id,
        fileId,
      );
      ctx.session = {};
      await ctx.reply('Captura enviada para validación.');
      if (trip.tipo === 'ida' && trip.servicio.estado === 'en_curso') {
        const serviceMessage = await ctx.reply(
          `*Servicio en curso*\n\n` +
            `• *Cliente:* ${trip.servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
            `• *Duración:* ${trip.servicio.duracionPactadaHoras} horas\n` +
            `• *Método de pago:* ${trip.servicio.metodoPago.toUpperCase()}\n\n` +
            `Cuando termine la actividad con el cliente, finaliza el servicio desde aquí.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  'Finalizar servicio',
                  `finalizar_servicio:${trip.servicio.id}`,
                ),
              ],
              [
                Markup.button.callback(
                  'Agregar extra',
                  `agregar_extra_list:${trip.servicio.id}`,
                ),
              ],
            ]),
          },
        );
        await this.serviciosRepository.update(trip.servicio.id, {
          telegramEmpleadaMensajeId: serviceMessage.message_id.toString(),
        });
      }
    } catch (error: any) {
      await ctx.reply(error.message || 'No fue posible guardar la captura.');
    }
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

    if (!(await this.isAssignedEmployee(ctx, servicio))) {
      await ctx.answerCbQuery('No puedes modificar este servicio.', {
        show_alert: true,
      });
      return;
    }

    if (servicio.estado !== 'en_curso') {
      await ctx.answerCbQuery('Este servicio ya no está activo.', {
        show_alert: true,
      });
      return;
    }

    // Cambiar estado a finalizado
    servicio.estado = 'finalizado';
    const fin = new Date();
    servicio.horaFinServicio = fin;

    // Calcular duración real en horas y formato legible (horas, minutos, segundos)
    let duracionRealVal = servicio.duracionPactadaHoras;
    let duracionFormatted = `${servicio.duracionPactadaHoras} horas`;
    if (servicio.horaInicioServicio) {
      const inicio = new Date(servicio.horaInicioServicio);
      const diffMs = fin.getTime() - inicio.getTime();
      duracionRealVal = diffMs / (1000 * 60 * 60);

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
    servicio.duracionFinalHoras = Number(duracionRealVal.toFixed(2));
    servicio.estadoLiquidacion = 'transporte_pendiente';
    servicio.recordatoriosRegreso = 0;
    servicio.proximoRecordatorioRegresoAt = new Date(Date.now() + 5 * 60_000);
    await this.serviciosRepository.save(servicio);

    const servicioConTotal =
      (await this.serviciosRepository.findOne({
        where: { id: servicio.id },
      })) ?? servicio;

    const empleadaPromise = (async () => {
      try {
        if (servicio.empleadaId) {
          await this.empleadasRepository.update(servicio.empleadaId, {
            disponible: true,
          });
        }
      } catch (err) {
        console.error(
          'Error al actualizar disponibilidad de la empleada:',
          err,
        );
      }
    })();

    await Promise.allSettled([empleadaPromise]);

    await ctx.answerCbQuery('🏁 Servicio finalizado con éxito.');

    const totalFinal = Number(servicioConTotal.totalFinal);
    const cargoTransporte = Number(
      servicioConTotal.customerTransportCharge ??
        servicioConTotal.totalTransporte ??
        0,
    );
    const formatoMoneda = new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
    });
    const resumenEmpText =
      `*Actividad con el cliente finalizada*\n\n` +
      `• *Cliente:* ${servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
      `• *Duración Real:* ${duracionFormatted}\n` +
      `• *Servicio pactado:* ${formatoMoneda.format(Number(servicioConTotal.totalBase))}\n` +
      (cargoTransporte > 0
        ? `• *Cargo de transporte:* ${formatoMoneda.format(cargoTransporte)}\n`
        : `• *Cargo de transporte:* Sin costo\n`) +
      `• *Método de pago:* ${servicioConTotal.metodoPago.toUpperCase()}\n\n` +
      `*Total que debes cobrar al cliente: ${formatoMoneda.format(totalFinal)}*`;

    try {
      await ctx.editMessageText(resumenEmpText, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error al editar mensaje de cierre de actividad:', err);
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

    try {
      await this.servicesService.requestReturnTransport(servicio.id);
    } catch (err) {
      console.error('Error al solicitar transporte de regreso:', err);
    }
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
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '⚠️ Reportar empleada',
              `er_client_start:${servicioId}`,
            ),
          ],
        ]),
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

  private reportCategoryLabel(category: ReportCategory): string {
    return (
      {
        trato_inadecuado: 'Trato inadecuado',
        demora_impuntualidad: 'Demora o impuntualidad',
        incumplimiento: 'Incumplimiento',
        cobro: 'Cobro',
        seguridad: 'Seguridad',
        otro: 'Otro',
      } as Record<ReportCategory, string>
    )[category];
  }

  private reportCategoryKeyboard(serviceId: string) {
    const categories: ReportCategory[] = [
      'trato_inadecuado',
      'demora_impuntualidad',
      'incumplimiento',
      'cobro',
      'seguridad',
      'otro',
    ];
    return Markup.inlineKeyboard([
      ...categories.map((category) => [
        Markup.button.callback(
          this.reportCategoryLabel(category),
          buildReportCategoryCallback('client', serviceId, category),
        ),
      ]),
      [Markup.button.callback('❌ Cancelar', 'er_client_cancel')],
    ]);
  }

  @Action(/^er_client_start:(.+)$/)
  async onClientReportStart(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const serviceId = (ctx as any).match?.[1];
    if (!serviceId) return;
    await ctx.reply(
      'Selecciona la categoría que mejor describe lo ocurrido:',
      this.reportCategoryKeyboard(serviceId),
    );
  }

  @Action(/^erc:([^:]+):([tdicso])$/)
  async onClientReportCategory(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    ctx.session = ctx.session || {};
    const category = parseReportCategoryCode(match[2]);
    if (!category) {
      await ctx.reply('La categoría seleccionada no es válida.');
      return;
    }
    ctx.session.step = 'AWAITING_CLIENT_REPORT_DESCRIPTION';
    ctx.session.reportServiceId = match[1];
    ctx.session.reportCategory = category;
    delete ctx.session.reportDescription;
    await ctx.reply(
      `Describe brevemente lo ocurrido para la categoría “${this.reportCategoryLabel(ctx.session.reportCategory)}”.`,
    );
  }

  @Action('er_client_confirm')
  async onClientReportConfirm(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery();
    const telegramId = ctx.from?.id.toString();
    const session = ctx.session;
    if (
      !telegramId ||
      !session?.reportServiceId ||
      !session.reportCategory ||
      !session.reportDescription
    ) {
      await ctx.reply(
        'La sesión del reporte expiró. Inicia el proceso nuevamente.',
      );
      return;
    }
    try {
      await this.employeeReportsService.createFromClient(
        telegramId,
        session.reportServiceId,
        session.reportCategory,
        session.reportDescription,
      );
      ctx.session = {};
      await ctx.editMessageText(
        '✅ Recibimos tu reporte. Un administrador lo revisará.',
      );
    } catch (error: any) {
      await ctx.reply(
        `No fue posible registrar el reporte: ${error?.message || 'intenta nuevamente'}`,
      );
    }
  }

  @Action('er_client_cancel')
  async onClientReportCancel(@Ctx() ctx: BotContext) {
    await ctx.answerCbQuery('Reporte cancelado');
    ctx.session = {};
    await ctx.editMessageText('Reporte cancelado.');
  }

  @On(['location', 'venue', 'edited_message'])
  async onLocation(
    @Ctx() ctx: BotContext,
    selectedLocation?: {
      latitude: number;
      longitude: number;
      title: string;
      address: string;
    },
  ) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const message = selectedLocation
      ? undefined
      : ctx.message || ctx.editedMessage || (ctx.update as any).edited_message;
    if (!selectedLocation && !message) return;

    let lat: string;
    let lng: string;
    let notasUbicacion: string | null = null;

    if (selectedLocation) {
      lat = selectedLocation.latitude.toString();
      lng = selectedLocation.longitude.toString();
      notasUbicacion = `Lugar seleccionado: ${selectedLocation.title}\nDirección: ${selectedLocation.address}`;
    } else if (message?.venue) {
      const venue = message.venue;
      lat = venue.location.latitude.toString();
      lng = venue.location.longitude.toString();
      notasUbicacion = `Lugar seleccionado: ${venue.title}\nDirección: ${venue.address}`;
    } else if (message?.location) {
      const location = message.location;
      lat = location.latitude.toString();
      lng = location.longitude.toString();
    } else {
      return;
    }

    const isEdited = !!(
      ctx.editedMessage || (ctx.update as any).edited_message
    );

    // Check in-memory cache to throttle database operations completely
    const nowTime = Date.now();
    const cached = this.userLocationCache.get(telegramId);
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (cached) {
      const diffMs = nowTime - cached.lastSaved;
      const distanceMeters = this.getDistanceMeters(
        cached.lat,
        cached.lng,
        parsedLat,
        parsedLng,
      );

      // Throttling: Skip database read/write if within 60s AND has moved less than 50 meters
      if (diffMs < 60000 && distanceMeters < 50) {
        // Update ONLY in-memory coordinates in cache
        cached.lat = parsedLat;
        cached.lng = parsedLng;
        cached.dirty = true; // Mark as dirty since cache is ahead of DB

        // Broadcast SSE update immediately using cached/updated details
        this.realtimeEventsService.emitToJefes({
          type:
            cached.rol === 'chofer'
              ? 'DRIVER_LOCATION_UPDATE'
              : 'EMPLOYEE_LOCATION_UPDATE',
          choferId: cached.rol === 'chofer' ? cached.id : undefined,
          empleadaId: cached.rol === 'empleada' ? cached.id : undefined,
          lat: parsedLat,
          lng: parsedLng,
        });
        return;
      }

      // Throttle expired (toca escribir a DB) pero YA está en cache: NO findOne, actualizar DB directo
      try {
        if (cached.rol === 'chofer') {
          await this.usuariosRepository.manager.update(Choferes, cached.id, {
            ubicacionLat: parsedLat,
            ubicacionLng: parsedLng,
            ultimaUbicacionAt: new Date(),
          });
          // Update cache details
          cached.lat = parsedLat;
          cached.lng = parsedLng;
          cached.lastSaved = nowTime;
          cached.dirty = false;

          // Emit real-time event to Jefes/Dashboard
          this.realtimeEventsService.emitToJefes({
            type: 'DRIVER_LOCATION_UPDATE',
            choferId: cached.id,
            lat: parsedLat,
            lng: parsedLng,
          });
        } else if (cached.rol === 'empleada') {
          await this.usuariosRepository.manager.update(Empleadas, cached.id, {
            ubicacionLat: parsedLat,
            ubicacionLng: parsedLng,
            ultimaUbicacionAt: new Date(),
          });
          // Update cache details
          cached.lat = parsedLat;
          cached.lng = parsedLng;
          cached.lastSaved = nowTime;
          cached.dirty = false;

          // Emit real-time event to Jefes/Dashboard
          this.realtimeEventsService.emitToJefes({
            type: 'EMPLOYEE_LOCATION_UPDATE',
            empleadaId: cached.id,
            lat: parsedLat,
            lng: parsedLng,
          });
        }
        return;
      } catch (err) {
        this.logger.error(
          `Error updating location directly for telegramId=${telegramId}:`,
          err,
        );
      }
    }

    // Si cached es undefined: Primera vez que se ve ese telegramId. Sí buscar en DB con relaciones.
    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
      relations: { choferes: true, empleadas: true },
    });

    if (user) {
      if (user.rol === 'chofer' && user.choferes) {
        user.choferes.ubicacionLat = parsedLat;
        user.choferes.ubicacionLng = parsedLng;
        user.choferes.ultimaUbicacionAt = new Date();
        await this.usuariosRepository.manager.save(user.choferes);

        // Cache user info
        this.userLocationCache.set(telegramId, {
          id: user.choferes.id,
          rol: 'chofer',
          name: user.choferes.nombre,
          lat: parsedLat,
          lng: parsedLng,
          lastSaved: nowTime,
          dirty: false,
        });

        // Emit real-time event to Jefes/Dashboard
        this.realtimeEventsService.emitToJefes({
          type: 'DRIVER_LOCATION_UPDATE',
          choferId: user.choferes.id,
          lat: user.choferes.ubicacionLat,
          lng: user.choferes.ubicacionLng,
        });

        // Solo notificar si no estaba en caché (primera vez) y no está editada
        if (!isEdited) {
          await ctx.reply(
            `📍 Ubicación registrada para el chofer: ${user.choferes.nombre}.`,
          );
        }
        return;
      }

      if (user.rol === 'empleada' && user.empleadas) {
        user.empleadas.ubicacionLat = parsedLat;
        user.empleadas.ubicacionLng = parsedLng;
        user.empleadas.ultimaUbicacionAt = new Date();
        await this.usuariosRepository.manager.save(user.empleadas);

        // Cache user info
        this.userLocationCache.set(telegramId, {
          id: user.empleadas.id,
          rol: 'empleada',
          name: user.empleadas.nombreArtistico,
          lat: parsedLat,
          lng: parsedLng,
          lastSaved: nowTime,
          dirty: false,
        });

        // Emit real-time event to Jefes/Dashboard
        this.realtimeEventsService.emitToJefes({
          type: 'EMPLOYEE_LOCATION_UPDATE',
          empleadaId: user.empleadas.id,
          lat: user.empleadas.ubicacionLat,
          lng: user.empleadas.ubicacionLng,
        });

        // Solo notificar si no estaba en caché (primera vez) y no está editada
        if (!isEdited) {
          await ctx.reply(
            `📍 Ubicación registrada para la empleada: ${user.empleadas.nombreArtistico}.`,
          );
        }
        return;
      }
    } else {
      this.logger.log(`No system user found for telegramChatId=${telegramId}`);
    }

    // Si no es personal, continuar flujo de cliente
    // Helper: escape Markdown v1 special characters so Telegram doesn't choke
    const escapeMd = (text: string): string =>
      text
        .replace(/\n/g, ' ') // newlines → space (critical for inline fields)
        .replace(/([_*[`])/g, '\\$1'); // escape Markdown special chars
    const step = ctx.session?.step;
    if (step !== 'AWAITING_LOCATION') {
      await ctx.reply(
        'Por favor, inicia la contratación de una empleada desde el catálogo primero.',
      );
      return;
    }

    // Sanitize notasUbicacion so it is safe to embed in Markdown messages
    const notasUbicacionSafe = notasUbicacion ? escapeMd(notasUbicacion) : null;

    try {
      const { empleadaId, duracionPactadaHoras, metodoPago } =
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
        await ctx.reply(
          '❌ Cliente no encontrado. Por favor inicia con /start',
        );
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

      let jefe: Usuarios | null = null;
      if (empleada.jefeId) {
        const mainJefe = await this.usuariosRepository.findOne({
          where: { id: empleada.jefeId, activo: true },
        });
        if (mainJefe && mainJefe.disponible) {
          jefe = mainJefe;
        } else if (empleada.jefeSecundarioId) {
          const secJefe = await this.usuariosRepository.findOne({
            where: { id: empleada.jefeSecundarioId, activo: true },
          });
          if (secJefe && secJefe.disponible) {
            jefe = secJefe;
          }
        }
      }
      if (!jefe) {
        jefe = await this.usuariosRepository.findOne({
          where: [
            { rol: 'jefe', activo: true, disponible: true },
            { rol: 'admin', activo: true, disponible: true },
          ],
        });
        if (!jefe) {
          jefe = await this.usuariosRepository.findOne({
            where: [
              { rol: 'jefe', activo: true },
              { rol: 'admin', activo: true },
            ],
          });
        }
      }

      if (!jefe) {
        await ctx.reply(
          '❌ No hay ningún jefe o administrador activo asignado en el sistema en este momento para autorizar el servicio.',
        );
        return;
      }
      const jefeId = jefe.id;
      const isEncadenado = false;
      const servicioPrevioId: string | undefined = undefined;

      // ─── FLUJO ENCADENADO ───────────────────────────────────────────────────
      if (isEncadenado) {
        const nuevoServicioEnc: any = this.serviciosRepository.create({
          clienteId: client.id,
          empleadaId: empleada.id,
          jefeId: jefeId,
          duracionPactadaHoras: duracionPactadaHoras,
          metodoPago: metodoPago,
          ubicacionClienteLat: parseFloat(lat),
          ubicacionClienteLng: parseFloat(lng),
          precioBaseHoraPactado: empleada.precioBaseHora,
          estado: 'cancelado',
          notas: notasUbicacion,
          servicioPrevioId: servicioPrevioId || null,
          clienteTelegramId: telegramId,
          iaActiva: false,
          presetLocationId: ctx.session?.presetLocationId ?? null,
          locationNameSnapshot: ctx.session?.locationNameSnapshot ?? null,
          locationAddressSnapshot: ctx.session?.locationAddressSnapshot ?? null,
          customerTransportCharge: ctx.session?.customerTransportCharge ?? 0,
          totalTransporte: ctx.session?.customerTransportCharge ?? 0,
        } as any);
        // 1. SAVE INICIAL (INSERT)
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
            // Acumulamos en memoria
            nuevoServicioEnc.telegramThreadId =
              topic.message_thread_id.toString();

            const detailsMsg =
              `📋 *Información del Servicio (Cita Encadenada):*\n\n` +
              `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
              `• *Empleada:* ${empleada.nombreArtistico}\n` +
              `• *Duración:* ${duracionPactadaHoras} horas\n` +
              `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
              `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
              (notasUbicacionSafe
                ? `• *Ubicación/Notas:* ${notasUbicacionSafe}\n`
                : '') +
              `• *Estado:* Pendiente Encadenada`;
            await ctx.telegram.sendMessage(
              jefeUser.grupoTelegramId,
              detailsMsg,
              {
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
              },
            );
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
            // Acumulamos en memoria
            nuevoServicioEnc.horaInicioEstimada = estimada;
            horaEstimadaStr = estimada.toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit',
            });
          }
        }

        ctx.session = {};

        const msgEnc = 'Esta modalidad de reserva ya no está disponible.';

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

        // Acumulamos en memoria
        nuevoServicioEnc.telegramClienteMensajeId =
          msgEnviadoEnc.message_id.toString();

        // 2. SAVE FINAL CON TODOS LOS CAMBIOS ACUMULADOS
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
        duracionPactadaHoras: duracionPactadaHoras,
        metodoPago: metodoPago,
        ubicacionClienteLat: parseFloat(lat),
        ubicacionClienteLng: parseFloat(lng),
        precioBaseHoraPactado: empleada.precioBaseHora,
        estado: 'pendiente',
        notas: notasUbicacion,
        clienteTelegramId: telegramId,
        iaActiva: false,
        presetLocationId: ctx.session?.presetLocationId ?? null,
        locationNameSnapshot: ctx.session?.locationNameSnapshot ?? null,
        locationAddressSnapshot: ctx.session?.locationAddressSnapshot ?? null,
        customerTransportCharge: ctx.session?.customerTransportCharge ?? 0,
        totalTransporte: ctx.session?.customerTransportCharge ?? 0,
      });
      // 1. SAVE INICIAL (INSERT)
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
          // Acumulamos en memoria
          nuevoServicio.telegramThreadId = topic.message_thread_id.toString();

          const detailsMsg =
            `📋 *Información del Servicio:*\n\n` +
            `• *Cliente:* ${clientName} (ID: ${telegramId})\n` +
            `• *Empleada:* ${empleada.nombreArtistico}\n` +
            `• *Duración:* ${duracionPactadaHoras} horas\n` +
            `• *Método de Pago:* ${metodoPago.toUpperCase()}\n` +
            `• *Tarifa:* $${empleada.precioBaseHora}/hr\n` +
            (notasUbicacionSafe
              ? `• *Ubicación/Notas:* ${notasUbicacionSafe}\n`
              : '') +
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

      // Emit event to Jefes in real-time
      const serviceWithRelations = await this.serviciosRepository.findOne({
        where: { id: nuevoServicio.id },
        relations: { cliente: true, empleada: true },
      });
      if (serviceWithRelations) {
        this.realtimeEventsService.emitToBoss(serviceWithRelations.jefeId, {
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

      const msgExito = await this.aiMessageService.generate(
        'booking_received',
        { employeeName: empleada.nombreArtistico },
        'Listo, dame un momentico y miro si puedo ir contigo',
      );

      const msg = await ctx.reply(msgExito, {
        ...Markup.removeKeyboard(),
      });

      // Acumulamos en memoria
      nuevoServicio.telegramClienteMensajeId = msg.message_id.toString();
      // 2. SAVE FINAL CON TODOS LOS CAMBIOS ACUMULADOS
      await this.serviciosRepository.save(nuevoServicio);
    } catch (bookingErr) {
      // Safety net: never leave the client frozen without a response
      this.logger.error(
        'Error crítico en flujo de contratación (onLocation):',
        bookingErr,
      );
      if (ctx.session) ctx.session = {};
      try {
        await ctx.reply(
          '⚠️ Ocurrió un error al procesar tu solicitud. Por favor, intenta de nuevo desde el catálogo.',
          Markup.removeKeyboard(),
        );
      } catch (_) {
        /* ignore secondary send error */
      }
    }
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
    const nuevaDuracion = servicio.duracionPactadaHoras + horasAExtender;
    servicio.duracionPactadaHoras = nuevaDuracion;
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
    if ((ctx.session?.step as string) === 'AWAITING_DRIVER_REPORT_DESCRIPTION')
      return;
    if (ctx.session?.step === 'AWAITING_CLIENT_REPORT_DESCRIPTION') {
      const description = (
        (ctx.message as { text?: string })?.text || ''
      ).trim();
      if (description.length < 3 || description.length > 2000) {
        await ctx.reply('La descripción debe tener entre 3 y 2000 caracteres.');
        return;
      }
      ctx.session.reportDescription = description;
      await ctx.reply(
        `Confirma tu reporte:\n\nCategoría: ${this.reportCategoryLabel(ctx.session.reportCategory!)}\nDescripción: ${description}`,
        {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Enviar', 'er_client_confirm'),
              Markup.button.callback('❌ Cancelar', 'er_client_cancel'),
            ],
          ]),
        },
      );
      return;
    }
    if (ctx.session?.step === 'AWAITING_UBER_FARE') {
      const text = (ctx.message as { text?: string })?.text || '';
      const amount = parseUberFareInput(text);
      if (!amount) {
        await ctx.reply(
          '❌ Escribe una cantidad positiva con máximo dos decimales.',
        );
        return;
      }
      if (!ctx.session.uberTripId) {
        ctx.session = {};
        await ctx.reply(
          'La sesión de tarifa expiró. Pulsa nuevamente “Introducir tarifa”.',
        );
        return;
      }
      ctx.session.pendingUberFare = amount;
      await ctx.reply(`Confirma el costo del Uber: *$${amount.toFixed(2)}*`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Confirmar',
              `uber_fare_confirm:${ctx.session.uberTripId}`,
            ),
          ],
          [
            Markup.button.callback(
              '✏️ Corregir',
              `uber_fare_correct:${ctx.session.uberTripId}`,
            ),
            Markup.button.callback(
              '❌ Cancelar',
              `uber_fare_cancel:${ctx.session.uberTripId}`,
            ),
          ],
        ]),
      });
      return;
    }

    // Los demás pasos administrativos tampoco deben caer en el puente
    // general entre el jefe y el cliente.
    if (isUberAdminInputSession(ctx.session)) return;

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

          if (user.rol !== 'jefe' && user.rol !== 'admin') {
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
        const senderTelegramId = ctx.from?.id.toString();
        const actor = senderTelegramId
          ? await this.usuariosRepository.findOne({
              where: { telegramChatId: senderTelegramId },
            })
          : null;
        const service = await this.serviciosRepository.findOne({
          where: {
            telegramThreadId: threadId.toString(),
            jefe: {
              grupoTelegramId: chatId,
            },
          },
        });

        if (
          service &&
          actor &&
          (actor.rol === 'admin' ||
            (actor.rol === 'jefe' && service.jefeId === actor.id)) &&
          service.clienteTelegramId
        ) {
          await ctx.telegram.sendMessage(service.clienteTelegramId, text);
          await this.recordConversation(service, 'jefe', text);
        }
      } catch (err) {
        this.logger.error('Error en Flujo 2 (Respuesta del Jefe):', err);
      }
      return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    if (
      ctx.chat?.type === 'private' &&
      ctx.session?.step === 'AWAITING_LOCATION'
    ) {
      await this.replyWithServiceLocationOptions(
        ctx,
        'Selecciona una ubicación disponible o elige otra ubicación para compartir un pin.',
      );
      return;
    }

    // Flujo 1: Mensajes del Cliente hacia el Súpergrupo del Jefe Asignado (Webhook de Entrada)
    if (ctx.chat?.type === 'private') {
      try {
        const activeService = await this.serviciosRepository.findOne({
          where: {
            clienteTelegramId: telegramId,
            estado: In(['pendiente', 'en_curso']),
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

          await this.recordConversation(activeService, 'cliente', text);

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
            const isPendiente = activeService.estado === 'pendiente';
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

              const isPendiente = activeService.estado === 'pendiente';
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

    if (step === 'CHAT_CON_EMPLEADA') {
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

      session.duracionPactadaHoras ??= extractHireDuration(userMessage);
      session.metodoPago ??= extractHirePaymentMethod(userMessage);

      if (session.duracionPactadaHoras && session.metodoPago) {
        session.step = 'AWAITING_LOCATION';
        session.chatHistory = history;
        await this.replyWithServiceLocationOptions(ctx);
        return;
      }

      const systemPrompt = getGeneralChatSystemPrompt({
        nombreArtistico: empleada.nombreArtistico,
        precioBaseHora: empleada.precioBaseHora,
        descripcion: empleada.descripcion,
      });

      try {
        await ctx.sendChatAction('typing');
        let responseText = await this.getGroqResponse(
          systemPrompt,
          history,
          telegramId,
        );

        // Check if response contains the structured DATA block
        const dataMatch = responseText.match(/\[DATA:\s*(\{.*?\})\]/);

        if (dataMatch) {
          try {
            const parsedData = JSON.parse(dataMatch[1]);
            if (parsedData.duracion && parsedData.pago) {
              session.duracionPactadaHoras = parseFloat(parsedData.duracion);
              session.metodoPago = parsedData.pago;

              // Transition step to AWAITING_LOCATION
              session.step = 'AWAITING_LOCATION';

              // Clean the DATA block from the text response
              responseText = responseText
                .replace(/\[DATA:\s*\{.*?\}\]/g, '')
                .trim();

              // Push final response to history
              history.push({ role: 'model', parts: [{ text: responseText }] });
              session.chatHistory = history;

              await this.replyWithServiceLocationOptions(
                ctx,
                responseText || 'Selecciona la ubicación del servicio.',
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
      } catch (err: any) {
        if (err?.message === 'AI_LIMIT_REACHED') {
          await ctx.reply(
            '⚠️ *Límite de IA alcanzado:* Has agotado tus consultas gratuitas de hoy con la Inteligencia Artificial. Por favor, intenta de nuevo mañana.',
            { parse_mode: 'Markdown' },
          );
          return;
        }
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

      const sentimentPrompt = getSentimentPrompt(comments);

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
        servicioId
          ? Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '⚠️ Reportar empleada',
                  `er_client_start:${servicioId}`,
                ),
              ],
            ])
          : Markup.removeKeyboard(),
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

    if (!(await this.isAssignedEmployee(ctx, servicio))) {
      await ctx.answerCbQuery(
        'No puedes solicitar prórrogas para este servicio.',
        { show_alert: true },
      );
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

    const extension = await this.extensionsService.requestServiceExtension(
      servicio.id,
      10,
    );
    servicio.prorrogasUsadas = extension.extensionNumber;
    await ctx.answerCbQuery('Prórroga de 10 minutos concedida.');

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

  private async isAssignedEmployee(
    ctx: Context,
    service: Servicios,
  ): Promise<boolean> {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return false;

    const employee = await this.empleadasRepository.findOne({
      where: {
        id: service.empleadaId,
        usuario: { telegramChatId: telegramId, rol: 'empleada' },
      },
      relations: { usuario: true },
    });

    return Boolean(employee);
  }

  private async recordConversation(
    service: Servicios,
    sender: 'ia' | 'jefe' | 'cliente',
    message: string,
  ): Promise<void> {
    const saved = await this.conversationsRepository.save(
      this.conversationsRepository.create({
        clienteId: service.clienteId,
        servicioId: service.id,
        emisor: sender,
        mensaje: message,
        iaActiva: service.iaActiva,
      }),
    );
    this.realtimeEventsService.emitToBoss(service.jefeId, {
      type: 'chat_message',
      data: saved,
    });
  }
}
