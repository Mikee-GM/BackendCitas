import { Inject, forwardRef } from '@nestjs/common';
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

@Update()
export class TelegramDriverUpdate {
  constructor(
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    private readonly realtimeEventsService: RealtimeEventsService,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  @Action(/^aceptar_viaje:(.+)$/)
  async onAceptarViaje(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user || user.rol !== 'chofer') {
      await ctx.answerCbQuery(
        '❌ Solo los choferes vinculados pueden tomar este viaje.',
        { show_alert: true },
      );
      return;
    }

    const chofer = await this.dataSource.getRepository(Choferes).findOne({
      where: { usuarioId: user.id },
    });

    if (!chofer) {
      await ctx.answerCbQuery(
        '❌ No se encontró tu perfil de chofer en el sistema.',
        { show_alert: true },
      );
      return;
    }

    const match = (ctx as any).match;
    const viajeId = match[1];

    const result = await this.dataSource.transaction(async (manager) => {
      const updateResult = await manager
        .createQueryBuilder()
        .update(Viajes)
        .set({
          choferId: chofer.id,
          estado: 'aceptado',
          horaAceptacion: new Date(),
        })
        .where('id = :viajeId AND "chofer_id" IS NULL', { viajeId })
        .execute();

      return updateResult.affected === 1;
    });

    if (result) {
      await ctx.answerCbQuery('✅ ¡Viaje asignado con éxito!', {
        show_alert: true,
      });

      const driverName = chofer.nombre;
      try {
        const messageText = (ctx.callbackQuery?.message as any)?.text || '';
        await ctx.editMessageText(
          messageText + `\n\n✅ *Viaje tomado por:* ${driverName}`,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        console.error('Error al actualizar mensaje de grupo:', err);
      }

      const trip = await this.dataSource.getRepository(Viajes).findOne({
        where: { id: viajeId },
        relations: { servicio: { empleada: true, cliente: true } },
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

        // Enviar información del viaje por privado al chofer
        if (user.telegramChatId) {
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

          const privateMessageText =
            `🚗 *¡Viaje Tomado con Éxito!* 🚗\n\n` +
            `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
            `• *Cliente:* ${trip.servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
            `• *Ubicación de Recogida (Empleada):* ${empLocationText}\n\n` +
            `Por favor, presiona el botón de abajo una vez hayas recogido a la empleada.`;

          try {
            await ctx.telegram.sendMessage(
              user.telegramChatId,
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
      }
    } else {
      await ctx.answerCbQuery(
        '❌ Este viaje ya ha sido tomado por otro chofer.',
        { show_alert: true },
      );
    }
  }

  @Action(/^chofer_recogida:(.+)$/)
  async onChoferRecogida(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user || user.rol !== 'chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    const chofer = await this.dataSource.getRepository(Choferes).findOne({
      where: { usuarioId: user.id },
    });

    if (!chofer) {
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

    if (trip.estado !== 'aceptado') {
      await ctx.answerCbQuery(`❌ El viaje está en estado: ${trip.estado}`, {
        show_alert: true,
      });
      return;
    }

    // Actualizar el viaje a en_curso
    trip.estado = 'en_curso';
    trip.horaInicioViaje = new Date();
    await this.dataSource.getRepository(Viajes).save(trip);

    await ctx.answerCbQuery(
      '🟢 Pasajera a bordo. Iniciando trayecto al cliente.',
    );

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

  @Action(/^chofer_finalizo_viaje:(.+)$/)
  async onChoferFinalizoViaje(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const user = await this.usuariosRepository.findOne({
      where: { telegramChatId: telegramId },
    });

    if (!user || user.rol !== 'chofer') {
      await ctx.answerCbQuery(
        '❌ No tienes permisos para realizar esta acción.',
        { show_alert: true },
      );
      return;
    }

    const chofer = await this.dataSource.getRepository(Choferes).findOne({
      where: { usuarioId: user.id },
    });

    if (!chofer) {
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

    // Actualizar el viaje a finalizado
    trip.estado = 'finalizado';
    trip.horaFinViaje = new Date();
    await this.dataSource.getRepository(Viajes).save(trip);

    // Actualizar horaInicioServicio del servicio
    if (trip.servicio) {
      trip.servicio.horaInicioServicio = new Date();
      await this.dataSource.getRepository(Servicios).save(trip.servicio);
    }

    await ctx.answerCbQuery('🏁 Viaje finalizado con éxito.');

    const messageText =
      `✅ *¡Viaje Finalizado!* 🏁\n\n` +
      `• *Empleada:* ${trip.servicio.empleada.nombreArtistico}\n` +
      `• *Hora Fin:* ${trip.horaFinViaje.toLocaleTimeString()}\n\n` +
      `¡Buen trabajo! El trayecto ha sido registrado en el sistema.`;

    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Error actualizando mensaje de finalización:', err);
    }

    // Notificar al cliente que la empleada ha llegado
    if (trip.servicio?.cliente?.telegramChatId) {
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
}
