import { Inject, forwardRef, BeforeApplicationShutdown } from '@nestjs/common';
import { Update, Ctx, Action } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { Usuarios } from '../users/entities/user.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { Choferes } from '../drivers/entities/driver.entity';
import { ServicesService } from '../services/services.service';
import { TelegramService } from './telegram.service';
import { Servicios } from '../services/entities/service.entity';

interface DriverCacheEntry {
  userId: string;
  id: string;
  rol: string;
  nombre: string;
  telefono: string;
  vehiculoMarca?: string | null;
  vehiculoModelo?: string | null;
  vehiculoColor?: string | null;
  vehiculoPlaca?: string | null;
  cachedAt: number;
  error?: 'no_user_or_not_chofer' | 'no_profile';
}

@Update()
export class TelegramDriverUpdate implements BeforeApplicationShutdown {
  private readonly driverIdentityCache = new Map<string, DriverCacheEntry>();

  private readonly cacheCleanupInterval: NodeJS.Timeout;

  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    private readonly realtimeEventsService: RealtimeEventsService,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, cached] of this.driverIdentityCache.entries()) {
        if (now - cached.cachedAt > 3600000) {
          this.driverIdentityCache.delete(key);
        }
      }
    }, 300000);
  }

  beforeApplicationShutdown() {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
  }

  private async getChoferFromCache(
    telegramId: string,
  ): Promise<DriverCacheEntry> {
    const cached = this.driverIdentityCache.get(telegramId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < 600000) {
      return cached;
    }

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
      relations: { choferes: true },
    });

    if (!user || user.rol !== 'chofer') {
      const entry = {
        userId: user?.id || '',
        id: '',
        rol: user?.rol || '',
        nombre: '',
        telefono: '',
        cachedAt: now,
        error: 'no_user_or_not_chofer' as const,
      };
      this.driverIdentityCache.set(telegramId, entry);
      return entry;
    }

    if (!user.choferes) {
      const entry = {
        userId: user.id,
        id: '',
        rol: user.rol,
        nombre: '',
        telefono: '',
        cachedAt: now,
        error: 'no_profile' as const,
      };
      this.driverIdentityCache.set(telegramId, entry);
      return entry;
    }

    const entry = {
      userId: user.id,
      id: user.choferes.id,
      rol: user.rol,
      nombre: user.choferes.nombre,
      telefono: user.choferes.telefono,
      vehiculoMarca: user.choferes.vehiculoMarca,
      vehiculoModelo: user.choferes.vehiculoModelo,
      vehiculoColor: user.choferes.vehiculoColor,
      vehiculoPlaca: user.choferes.vehiculoPlaca,
      cachedAt: now,
    };

    this.driverIdentityCache.set(telegramId, entry);
    return entry;
  }

  @Action(/^aceptar_viaje:(.+)$/)
  async onAceptarViaje(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const chofer = await this.getChoferFromCache(telegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ Solo los choferes vinculados pueden tomar este viaje.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery(
        '❌ No se encontró tu perfil de chofer en el sistema.',
        { show_alert: true },
      );
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    await ctx.answerCbQuery();

    const originalText = (ctx.callbackQuery?.message as any)?.text || '';
    if (originalText.includes('⚠️ ¿Confirmas')) {
      return;
    }

    const displayName = ctx.from?.first_name || chofer.nombre;
    const warnHeader = `⚠️ *[Confirmación pendiente]*\n*${displayName}*, ¿confirmas que deseas tomar este viaje?\n\n`;

    await ctx.editMessageText(warnHeader + originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sí, tomar viaje',
            `c_ac_v:${viajeId}:${telegramId}`,
          ),
          Markup.button.callback('❌ Cancelar', `x_ac_v:${viajeId}`),
        ],
      ]),
    });
  }

  @Action(/^c_ac_v:(.+):(.+)$/)
  async onConfAceptarViaje(@Ctx() ctx: Context) {
    const clickerTelegramId = ctx.from?.id.toString();
    if (!clickerTelegramId) return;

    const match = (ctx as any).match;
    const viajeId = match[1];
    const targetTelegramId = match[2];

    if (clickerTelegramId !== targetTelegramId) {
      await ctx.answerCbQuery(
        '❌ Solo el chofer que inició la confirmación puede aceptar este viaje.',
        { show_alert: true },
      );
      return;
    }

    const chofer = await this.getChoferFromCache(clickerTelegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ Solo los choferes vinculados pueden tomar este viaje.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery(
        '❌ No se encontró tu perfil de chofer en el sistema.',
        { show_alert: true },
      );
      return;
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const updateResult = await manager
        .createQueryBuilder()
        .update(Viajes)
        .set({
          estado: 'aceptado',
          horaAceptacion: new Date(),
        })
        .where('id = :viajeId AND chofer_id = :choferId AND estado = :estado', {
          viajeId,
          choferId: chofer.id,
          estado: 'notificado',
        })
        .execute();

      if (updateResult.affected === 1) {
        await manager.update(Choferes, chofer.id, { disponible: false });
        return true;
      }
      return false;
    });

    if (result) {
      // Invalidad caché ya que chofer.disponible cambió a false
      this.driverIdentityCache.delete(clickerTelegramId);

      // Cancelar el timeout de despacho del viaje
      this.servicesService.clearDispatchTimeout(viajeId);

      await ctx.answerCbQuery('✅ ¡Viaje asignado con éxito!', {
        show_alert: true,
      });

      const driverName = chofer.nombre;
      try {
        let messageText = (ctx.callbackQuery?.message as any)?.text || '';
        // Limpiar encabezados de confirmación
        messageText = messageText.replace(
          /⚠️ \*?\[Confirmación pendiente\]\*?\n\*?.*?\*?,? ¿confirmas que deseas tomar este viaje\?\n\n/,
          '',
        );
        await ctx.editMessageText(
          messageText + `\n\n✅ *Viaje tomado por:* ${driverName}`,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        console.error('Error al actualizar mensaje de grupo:', err);
      }

      const trip = await this.dataSource.getRepository(Viajes).findOne({
        where: { id: viajeId },
        relations: { servicio: { empleada: { usuario: true }, cliente: true } },
      });

      if (trip && trip.servicio) {
        this.realtimeEventsService.emitToDriver(chofer.id, {
          type: 'new_trip',
          data: trip,
        });

        this.realtimeEventsService.emitToEmployee(trip.servicio.empleadaId, {
          type: 'trip_accepted',
          data: {
            tripId: trip.id,
            choferName: driverName,
            serviceId: trip.servicio.id,
          },
        });

        this.realtimeEventsService.emitToJefes({
          type: 'trip_accepted',
          data: {
            tripId: trip.id,
            choferName: driverName,
            serviceId: trip.servicio.id,
          },
        });

        // Notificaciones en paralelo usando Promise.allSettled
        const notifyEmployeePromise = (async () => {
          const empUser = trip.servicio.empleada?.usuario;
          if (empUser && empUser.telegramChatId) {
            const targetChatId = empUser.telegramChatId;
            const threadId = undefined;

            const vehiculoInfo = [
              chofer.vehiculoMarca
                ? `• *Marca:* ${chofer.vehiculoMarca}`
                : null,
              chofer.vehiculoModelo
                ? `• *Modelo:* ${chofer.vehiculoModelo}`
                : null,
              chofer.vehiculoColor
                ? `• *Color:* ${chofer.vehiculoColor}`
                : null,
              chofer.vehiculoPlaca
                ? `• *Placa:* ${chofer.vehiculoPlaca}`
                : null,
            ]
              .filter(Boolean)
              .join('\n');

            const employeeNotificationText =
              `🚗 *¡Tu chofer va en camino!* 💨\n\n` +
              `El chofer *${chofer.nombre}* ha aceptado tu viaje y se dirige a tu ubicación.\n\n` +
              `*Datos del Chofer:*\n` +
              `• *Nombre:* ${chofer.nombre}\n` +
              `• *Teléfono:* ${chofer.telefono}\n\n` +
              (vehiculoInfo
                ? `*Datos del Vehículo:*\n${vehiculoInfo}\n`
                : `*Datos del Vehículo:* No registrados\n`);

            try {
              const sentMsg = await ctx.telegram.sendMessage(
                targetChatId,
                employeeNotificationText,
                {
                  message_thread_id: threadId,
                  parse_mode: 'Markdown',
                },
              );
              // Guardar el ID del mensaje para poder borrarlo después
              trip.telegramEmpleadaMsgChoferCaminoId =
                sentMsg.message_id.toString();
              await this.dataSource.getRepository(Viajes).update(trip.id, {
                telegramEmpleadaMsgChoferCaminoId:
                  trip.telegramEmpleadaMsgChoferCaminoId,
              });
            } catch (sendErr) {
              console.error('Error al notificar a la empleada:', sendErr);
            }
          }
        })();

        const notifyDriverPromise = (async () => {
          if (clickerTelegramId) {
            const empLat = trip.servicio.empleada.ubicacionLat;
            const empLng = trip.servicio.empleada.ubicacionLng;
            let empLocationText = 'No registrada';
            const inlineButtons: any[][] = [];

            if (empLat && empLng) {
              empLocationText = `[Ver en Google Maps](https://www.google.com/maps/search/?api=1&query=${empLat},${empLng})`;
              inlineButtons.push([
                Markup.button.url(
                  '🗺️ Google Maps',
                  `https://www.google.com/maps/search/?api=1&query=${empLat},${empLng}`,
                ),
                Markup.button.url(
                  '🚙 Waze',
                  `https://waze.com/ul?ll=${empLat},${empLng}&navigate=yes`,
                ),
              ]);
            }

            inlineButtons.push([
              Markup.button.callback(
                '📍 He Llegado con la Empleada',
                `chofer_llegado:${trip.id}`,
              ),
            ]);

            const privateMessageText =
              `🚗 *¡Viaje Tomado con Éxito!* 🚗\n\n` +
              `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
              `• *Cliente:* ${trip.servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
              `• *Ubicación de Recogida (Empleada):* ${empLocationText}\n\n` +
              `Por favor, presiona el botón de abajo una vez hayas llegado con la empleada.`;

            try {
              await ctx.telegram.sendMessage(
                clickerTelegramId,
                privateMessageText,
                {
                  parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard(inlineButtons),
                },
              );
            } catch (sendErr) {
              console.error(
                'Error al enviar mensaje privado al chofer:',
                sendErr,
              );
            }
          }
        })();

        await Promise.allSettled([notifyEmployeePromise, notifyDriverPromise]);
      }
    } else {
      await ctx.answerCbQuery(
        '❌ Este viaje ya ha sido tomado por otro chofer o no está disponible.',
        { show_alert: true },
      );
    }
  }

  @Action(/^x_ac_v:(.+)$/)
  async onCancAceptarViaje(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Asignación cancelada.');
    const match = (ctx as any).match;
    const viajeId = match[1];

    let messageText = (ctx.callbackQuery?.message as any)?.text || '';
    // Limpiar encabezados de confirmación
    messageText = messageText.replace(
      /⚠️ \*?\[Confirmación pendiente\]\*?\n\*?.*?\*?,? ¿confirmas que deseas tomar este viaje\?\n\n/,
      '',
    );

    await ctx.editMessageText(messageText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.callback('🚗 Aceptar Viaje', `aceptar_viaje:${viajeId}`),
      ]),
    });
  }

  @Action(/^chofer_llegado:(.+)$/)
  async onChoferLlegado(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const chofer = await this.getChoferFromCache(telegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: { usuario: true } } },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'aceptado') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

    const originalText = (ctx.callbackQuery?.message as any)?.text || '';
    if (originalText.includes('⚠️ ¿Confirmas')) {
      return;
    }

    const warnHeader = `⚠️ *¿Confirmas que deseas marcar que has LLEGADO al punto de recogida?*\n\n`;

    await ctx.editMessageText(warnHeader + originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sí, marcar llegada',
            `c_ch_llegado:${viajeId}`,
          ),
          Markup.button.callback('❌ Cancelar', `x_ch_llegado:${viajeId}`),
        ],
      ]),
    });
  }

  @Action(/^c_ch_llegado:(.+)$/)
  async onConfChoferLlegado(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const chofer = await this.getChoferFromCache(telegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: { usuario: true } } },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'aceptado') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    // Actualizar el viaje a llegado
    await this.dataSource
      .getRepository(Viajes)
      .update(trip.id, { estado: 'llegado' });
    trip.estado = 'llegado';

    await ctx.answerCbQuery('📍 Has llegado con la empleada.');

    // Notificar a la empleada que el chofer ha llegado con la info de identificación
    const empUserArrived = trip.servicio?.empleada?.usuario;
    if (empUserArrived && empUserArrived.telegramChatId) {
      const targetChatId = empUserArrived.telegramChatId;
      const threadId = undefined;

      if (targetChatId) {
        const vehiculoInfo = [
          chofer.vehiculoMarca ? `• *Marca:* ${chofer.vehiculoMarca}` : null,
          chofer.vehiculoModelo ? `• *Modelo:* ${chofer.vehiculoModelo}` : null,
          chofer.vehiculoColor ? `• *Color:* ${chofer.vehiculoColor}` : null,
          chofer.vehiculoPlaca ? `• *Placa:* ${chofer.vehiculoPlaca}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        const msgText =
          `📍 *¡Tu chofer ha llegado!* 🚗\n\n` +
          `El chofer *${chofer.nombre}* ya está fuera en el punto de recogida.\n\n` +
          `*Datos de Identificación del Chofer:*\n` +
          `• *Nombre:* ${chofer.nombre}\n` +
          `• *Teléfono:* ${chofer.telefono}\n\n` +
          (vehiculoInfo
            ? `*Datos del Vehículo:*\n${vehiculoInfo}\n`
            : `*Datos del Vehículo:* No registrados\n`) +
          `Por favor, reúnete con él para iniciar el viaje.`;

        try {
          const sentMsg = await ctx.telegram.sendMessage(
            targetChatId,
            msgText,
            {
              message_thread_id: threadId,
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '⏳ Solicitar Prórroga (10 min)',
                    `pedir_prorroga:${trip.servicio.id}`,
                  ),
                ],
              ]),
            },
          );
          // Iniciar el timeout de espera de 10 minutos (600,000 ms)
          this.servicesService.startWaitTimeout(trip.servicio.id, 600000);

          // Guardar el ID del mensaje para poder borrarlo después
          trip.telegramEmpleadaMsgChoferLlegadoId =
            sentMsg.message_id.toString();
          await this.dataSource.getRepository(Viajes).update(trip.id, {
            telegramEmpleadaMsgChoferLlegadoId:
              trip.telegramEmpleadaMsgChoferLlegadoId,
          });
        } catch (telegramErr) {
          console.error(
            `Error al notificar a la empleada sobre la llegada (chatId: ${empUserArrived.telegramChatId}):`,
            telegramErr.message || telegramErr,
          );
        }
      }
    }

    // Actualizar el mensaje del chofer con el botón de "Empleada Recogida"
    const empLat = trip.servicio.empleada.ubicacionLat;
    const empLng = trip.servicio.empleada.ubicacionLng;
    let empLocationText = 'No registrada';
    const inlineButtons: any[][] = [];

    if (empLat && empLng) {
      empLocationText = `[Ver en Google Maps](https://www.google.com/maps/search/?api=1&query=${empLat},${empLng})`;
      inlineButtons.push([
        Markup.button.url(
          '🗺️ Google Maps',
          `https://www.google.com/maps/search/?api=1&query=${empLat},${empLng}`,
        ),
        Markup.button.url(
          '🚙 Waze',
          `https://waze.com/ul?ll=${empLat},${empLng}&navigate=yes`,
        ),
      ]);
    }

    inlineButtons.push([
      Markup.button.callback(
        '🙋‍♀️ Empleada Recogida',
        `chofer_recogida:${trip.id}`,
      ),
    ]);

    const messageText =
      `🚗 *¡Has llegado al punto de recogida!* 📍\n\n` +
      `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
      `• *Cliente:* ${trip.servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
      `• *Ubicación de Recogida (Empleada):* ${empLocationText}\n\n` +
      `Una vez que la empleada suba a bordo, presiona el botón de abajo para iniciar el viaje hacia el cliente.`;

    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(inlineButtons),
      });
    } catch (err) {
      console.error('Error actualizando mensaje de chofer_llegado:', err);
    }
  }

  @Action(/^x_ch_llegado:(.+)$/)
  async onCancChoferLlegado(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Cancelado.');
    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: true } },
    });

    if (!trip) {
      return;
    }

    let originalText = (ctx.callbackQuery?.message as any)?.text || '';
    originalText = originalText.replace(
      /⚠️ \*?¿Confirmas que deseas marcar que has LLEGADO al punto de recogida\?\*?\n\n/,
      '',
    );

    const empLat = trip.servicio.empleada.ubicacionLat;
    const empLng = trip.servicio.empleada.ubicacionLng;
    const inlineButtons: any[][] = [];

    if (empLat && empLng) {
      inlineButtons.push([
        Markup.button.url(
          '🗺️ Google Maps',
          `https://www.google.com/maps/search/?api=1&query=${empLat},${empLng}`,
        ),
        Markup.button.url(
          '🚙 Waze',
          `https://waze.com/ul?ll=${empLat},${empLng}&navigate=yes`,
        ),
      ]);
    }

    inlineButtons.push([
      Markup.button.callback(
        '📍 He Llegado con la Empleada',
        `chofer_llegado:${trip.id}`,
      ),
    ]);

    await ctx.editMessageText(originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(inlineButtons),
    });
  }

  @Action(/^chofer_recogida:(.+)$/)
  async onChoferRecogida(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const chofer = await this.getChoferFromCache(telegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: true } },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'llegado' && trip.estado !== 'aceptado') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

    const originalText = (ctx.callbackQuery?.message as any)?.text || '';
    if (originalText.includes('⚠️ ¿Confirmas')) {
      return;
    }

    const warnHeader = `⚠️ *¿Confirmas que la empleada ya subió al vehículo e iniciarás el viaje hacia el cliente?*\n\n`;

    await ctx.editMessageText(warnHeader + originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sí, iniciar viaje',
            `c_ch_recogida:${viajeId}`,
          ),
          Markup.button.callback('❌ Cancelar', `x_ch_recogida:${viajeId}`),
        ],
      ]),
    });
  }

  @Action(/^c_ch_recogida:(.+)$/)
  async onConfChoferRecogida(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const chofer = await this.getChoferFromCache(telegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: { usuario: true } } },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'llegado' && trip.estado !== 'aceptado') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    // Actualizar el viaje a en_curso
    const now = new Date();
    await this.dataSource.getRepository(Viajes).update(trip.id, {
      estado: 'en_curso',
      horaInicioViaje: now,
    });
    trip.estado = 'en_curso';
    trip.horaInicioViaje = now;

    // Cancelar el timeout de espera de la empleada
    this.servicesService.clearWaitTimeout(trip.servicioId);

    await ctx.answerCbQuery(
      '🟢 Pasajera a bordo. Iniciando trayecto al cliente.',
    );

    // Borrar mensajes previos del chat de la empleada ("chofer va en camino" y "chofer ha llegado")
    const empChatId = trip?.servicio?.empleada?.usuario?.telegramChatId;

    if (empChatId) {
      const msgCaminoId = trip?.telegramEmpleadaMsgChoferCaminoId;
      const msgLlegadoId = trip?.telegramEmpleadaMsgChoferLlegadoId;

      if (msgCaminoId) {
        try {
          await ctx.telegram.deleteMessage(
            empChatId,
            parseInt(msgCaminoId, 10),
          );
        } catch (err) {
          console.error(
            'Error al borrar mensaje "chofer va en camino" de la empleada:',
            err,
          );
        }
      }

      if (msgLlegadoId) {
        try {
          await ctx.telegram.deleteMessage(
            empChatId,
            parseInt(msgLlegadoId, 10),
          );
        } catch (err) {
          console.error(
            'Error al borrar mensaje "chofer ha llegado" de la empleada:',
            err,
          );
        }
      }
    }

    // Mostrar destino del cliente con botones de navegación
    const clientLat = trip.servicio.ubicacionClienteLat;
    const clientLng = trip.servicio.ubicacionClienteLng;
    let clientLocationText = 'No registrada';
    const inlineButtons: any[][] = [];

    if (clientLat && clientLng) {
      clientLocationText = `[Ver en Google Maps](https://www.google.com/maps/search/?api=1&query=${clientLat},${clientLng})`;
      inlineButtons.push([
        Markup.button.url(
          '🗺️ Google Maps',
          `https://www.google.com/maps/search/?api=1&query=${clientLat},${clientLng}`,
        ),
        Markup.button.url(
          '🚙 Waze',
          `https://waze.com/ul?ll=${clientLat},${clientLng}&navigate=yes`,
        ),
      ]);
    }

    inlineButtons.push([
      Markup.button.callback(
        '🏁 Finalizar Viaje',
        `chofer_finalizo_viaje:${trip.id}`,
      ),
    ]);

    const messageText =
      `🙋‍♀️ *¡Empleada Recogida con Éxito!* 🙋‍♀️\n\n` +
      `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
      `• *Cliente:* ${trip.servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
      `• *Ubicación del Cliente (Destino):* ${clientLocationText}\n\n` +
      `Por favor, presiona el botón de abajo una vez hayas llegado al destino final y finalizado el servicio.`;

    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(inlineButtons),
      });
    } catch (err) {
      console.error('Error actualizando mensaje de recogida:', err);
    }

    // Notificar al cliente que la empleada va en camino
    if (trip.servicio?.cliente?.telegramChatId) {
      try {
        await ctx.telegram.sendMessage(
          trip.servicio.cliente.telegramChatId,
          `🚗 *¡Tu servicio va en camino!* 💨\n\n` +
            `El chofer *${chofer.nombre}* ha recogido a *${trip.servicio.empleada.nombreArtistico}* y van rumbo a tu ubicación.`,
          { parse_mode: 'Markdown' },
        );
      } catch (telegramErr) {
        console.error(
          `Error al notificar al cliente sobre viaje en camino (chatId: ${trip.servicio.cliente.telegramChatId}):`,
          telegramErr.message || telegramErr,
        );
      }
    }
  }

  @Action(/^x_ch_recogida:(.+)$/)
  async onCancChoferRecogida(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Cancelado.');
    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: true } },
    });

    if (!trip) {
      return;
    }

    let originalText = (ctx.callbackQuery?.message as any)?.text || '';
    originalText = originalText.replace(
      /⚠️ \*?¿Confirmas que la empleada ya subió al vehículo e iniciarás el viaje hacia el cliente\?\*?\n\n/,
      '',
    );

    const empLat = trip.servicio.empleada.ubicacionLat;
    const empLng = trip.servicio.empleada.ubicacionLng;
    const inlineButtons: any[][] = [];

    if (empLat && empLng) {
      inlineButtons.push([
        Markup.button.url(
          '🗺️ Google Maps',
          `https://www.google.com/maps/search/?api=1&query=${empLat},${empLng}`,
        ),
        Markup.button.url(
          '🚙 Waze',
          `https://waze.com/ul?ll=${empLat},${empLng}&navigate=yes`,
        ),
      ]);
    }

    inlineButtons.push([
      Markup.button.callback(
        '🙋‍♀️ Empleada Recogida',
        `chofer_recogida:${trip.id}`,
      ),
    ]);

    await ctx.editMessageText(originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(inlineButtons),
    });
  }

  @Action(/^chofer_finalizo_viaje:(.+)$/)
  async onChoferFinalizoViaje(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const chofer = await this.getChoferFromCache(telegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { empleada: true, cliente: true } },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'en_curso') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery();

    const originalText = (ctx.callbackQuery?.message as any)?.text || '';
    if (originalText.includes('⚠️ ¿Confirmas')) {
      return;
    }

    const warnHeader = `⚠️ *¿Confirmas que has llegado al destino final y deseas FINALIZAR el viaje?*\n\n`;

    await ctx.editMessageText(warnHeader + originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sí, finalizar viaje',
            `c_ch_fin:${viajeId}`,
          ),
          Markup.button.callback('❌ Cancelar', `x_ch_fin:${viajeId}`),
        ],
      ]),
    });
  }

  @Action(/^c_ch_fin:(.+)$/)
  async onConfChoferFinalizoViaje(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const chofer = await this.getChoferFromCache(telegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: {
        servicio: {
          empleada: { usuario: true, jefe: true },
          cliente: true,
          jefe: true,
        },
      },
    });

    if (!trip) {
      await ctx.answerCbQuery('❌ Viaje no encontrado.', { show_alert: true });
      return;
    }

    if (trip.choferId !== chofer.id) {
      await ctx.answerCbQuery('❌ Este viaje está asignado a otro chofer.', {
        show_alert: true,
      });
      return;
    }

    if (trip.estado !== 'en_curso') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    // Actualizar el viaje a finalizado en memoria
    const horaFin = new Date();
    trip.estado = 'finalizado';
    trip.horaFinViaje = horaFin;

    // Preparar promesas de escritura paralela
    const promises: Promise<any>[] = [];

    // Promesa 1: Viaje update dirigido
    promises.push(
      this.dataSource.getRepository(Viajes).update(trip.id, {
        estado: 'finalizado',
        horaFinViaje: horaFin,
      }),
    );

    // Promesa 2: Chofer update dirigido
    promises.push(
      this.dataSource.getRepository(Choferes).update(chofer.id, {
        disponible: true,
      }),
    );

    // Promesa 3: Servicio update dirigido y borrado de forum topic si aplica
    if (trip.servicio) {
      const serviceUpdateData: any = {};
      if (trip.tipo === 'ida') {
        const horaInicio = new Date();
        trip.servicio.horaInicioServicio = horaInicio;
        serviceUpdateData.horaInicioServicio = horaInicio;
      } else {
        const horaLlegada = new Date();
        trip.servicio.horaLlegadaCasa = horaLlegada;
        serviceUpdateData.horaLlegadaCasa = horaLlegada;

        // Eliminar el tema (hilo) del grupo de Telegram si es viaje de regreso (final del servicio completo)
        const jefeGrupoId =
          trip.servicio.jefe?.grupoTelegramId ||
          trip.servicio.empleada?.jefe?.grupoTelegramId;
        if (trip.servicio.telegramThreadId && jefeGrupoId) {
          promises.push(
            ctx.telegram
              .deleteForumTopic(
                jefeGrupoId,
                parseInt(trip.servicio.telegramThreadId, 10),
              )
              .then(() => {
                console.log(
                  `[onConfChoferFinalizoViaje] Forum topic ${trip.servicio.telegramThreadId} eliminado con éxito.`,
                );
              })
              .catch((err) => {
                console.error(
                  'Error al eliminar forum topic al finalizar viaje de regreso:',
                  err,
                );
              }),
          );
        }
      }
      promises.push(
        this.dataSource
          .getRepository(Servicios)
          .update(trip.servicio.id, serviceUpdateData),
      );
    }

    // Ejecutar todas las promesas en paralelo
    await Promise.all(promises);

    // Invalidad caché del chofer ya que chofer.disponible cambió a true
    this.driverIdentityCache.delete(telegramId);

    await ctx.answerCbQuery('🏁 Viaje finalizado con éxito.');

    const messageText =
      `✅ *¡Viaje Finalizado!* 🏁\n\n` +
      `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
      `• *Tipo de Viaje:* ${trip.tipo === 'ida' ? 'Ida' : 'Regreso'}\n` +
      `• *Hora Fin:* ${trip.horaFinViaje.toLocaleTimeString()}\n\n` +
      `¡Buen trabajo! El trayecto ha sido registrado en el sistema.`;

    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Error actualizando mensaje de finalización:', err);
    }

    // Notificar al cliente que la empleada ha llegado (únicamente para viajes de ida)
    if (trip.tipo === 'ida' && trip.servicio?.cliente?.telegramChatId) {
      try {
        await ctx.telegram.sendMessage(
          trip.servicio.cliente.telegramChatId,
          `📍 *¡Tu empleada ha llegado!* 🙋‍♀️\n\n` +
            `*${trip.servicio.empleada.nombreArtistico}* ha llegado a tu ubicación para iniciar el servicio.`,
          { parse_mode: 'Markdown' },
        );
      } catch (telegramErr) {
        console.error(
          `Error al notificar al cliente sobre llegada (chatId: ${trip.servicio.cliente.telegramChatId}):`,
          telegramErr.message || telegramErr,
        );
      }
    }
  }

  @Action(/^x_ch_fin:(.+)$/)
  async onCancChoferFinalizoViaje(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Cancelado.');
    const match = (ctx as any).match;
    const viajeId = match[1];

    const trip = await this.dataSource.getRepository(Viajes).findOne({
      where: { id: viajeId },
      relations: { servicio: { cliente: true, empleada: true } },
    });

    if (!trip) {
      return;
    }

    let originalText = (ctx.callbackQuery?.message as any)?.text || '';
    originalText = originalText.replace(
      /⚠️ \*?¿Confirmas que has llegado al destino final y deseas FINALIZAR el viaje\?\*?\n\n/,
      '',
    );

    const clientLat = trip.servicio.ubicacionClienteLat;
    const clientLng = trip.servicio.ubicacionClienteLng;
    const inlineButtons: any[][] = [];

    if (clientLat && clientLng) {
      inlineButtons.push([
        Markup.button.url(
          '🗺️ Google Maps',
          `https://www.google.com/maps/search/?api=1&query=${clientLat},${clientLng}`,
        ),
        Markup.button.url(
          '🚙 Waze',
          `https://waze.com/ul?ll=${clientLat},${clientLng}&navigate=yes`,
        ),
      ]);
    }

    inlineButtons.push([
      Markup.button.callback(
        '🏁 Finalizar Viaje',
        `chofer_finalizo_viaje:${trip.id}`,
      ),
    ]);

    await ctx.editMessageText(originalText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(inlineButtons),
    });
  }

  @Action(/^r_v_o:(.+)$/)
  async onRechazarViajeOferta(@Ctx() ctx: Context) {
    const clickerTelegramId = ctx.from?.id.toString();
    if (!clickerTelegramId) return;

    const match = (ctx as any).match;
    const viajeId = match[1];

    const chofer = await this.getChoferFromCache(clickerTelegramId);

    if (!chofer || chofer.error === 'no_user_or_not_chofer') {
      await ctx.answerCbQuery('❌ Acción no permitida.', { show_alert: true });
      return;
    }

    if (chofer.error === 'no_profile') {
      await ctx.answerCbQuery('❌ No se encontró tu perfil de chofer.', {
        show_alert: true,
      });
      return;
    }

    await ctx.answerCbQuery('Oferta rechazada.');
    await this.servicesService.rechazarOfertaManual(viajeId, chofer.id);
  }
}
