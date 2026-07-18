import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context, Markup } from 'telegraf';
import { Servicios } from './entities/service.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { RealtimeEventsService } from '../realtime/realtime.service';
import { TelegramService } from '../telegram/telegram.service';
import { Empleadas } from '../employees/entities/employee.entity';
import { Usuarios } from '../users/entities/user.entity';
import { Choferes } from '../drivers/entities/driver.entity';

@Injectable()
export class ServicesService implements OnModuleInit {
  private waitTimeouts = new Map<string, NodeJS.Timeout>();
  private dispatchTimeouts = new Map<string, NodeJS.Timeout>();

  clearDispatchTimeout(viajeId: string) {
    const existing = this.dispatchTimeouts.get(viajeId);
    console.log(
      `[clearDispatchTimeout] Viaje: ${viajeId}, Existe timeout: ${!!existing}`,
    );
    if (existing) {
      clearTimeout(existing);
      this.dispatchTimeouts.delete(viajeId);
    }
  }

  constructor(
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    @InjectRepository(Viajes)
    private readonly viajesRepository: Repository<Viajes>,
    @InjectRepository(Choferes)
    private readonly choferesRepository: Repository<Choferes>,
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    private readonly realtimeEventsService: RealtimeEventsService,
    @InjectBot() private readonly bot: Telegraf<Context>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  async create(createServiceDto: any): Promise<Servicios> {
    // Si no tiene jefeId especificado, asignamos el jefe correspondiente a la empleada
    if (createServiceDto.empleadaId && !createServiceDto.jefeId) {
      try {
        const empleadasRepository =
          this.serviciosRepository.manager.getRepository(Empleadas);
        const emp = await empleadasRepository.findOne({
          where: { id: createServiceDto.empleadaId },
        });
        if (emp) {
          let assignedJefeId = emp.jefeId;
          if (emp.jefeId) {
            const mainJefe = await this.usuariosRepository.findOne({
              where: { id: emp.jefeId, activo: true },
            });
            if (!mainJefe || !mainJefe.disponible) {
              if (emp.jefeSecundarioId) {
                const secJefe = await this.usuariosRepository.findOne({
                  where: { id: emp.jefeSecundarioId, activo: true },
                });
                if (secJefe && secJefe.disponible) {
                  assignedJefeId = emp.jefeSecundarioId;
                }
              }
            }
          }
          if (assignedJefeId) {
            createServiceDto.jefeId = assignedJefeId;
          }
        }
      } catch (err) {
        console.error('Error auto-assigning jefeId for employee:', err);
      }
    }

    const nuevoServicio = this.serviciosRepository.create(
      createServiceDto,
    ) as any as Servicios;
    const servicioGuardado = await this.serviciosRepository.save(nuevoServicio);

    // Emit event to Jefes in real-time via SSE
    try {
      const serviceWithRelations = await this.serviciosRepository.findOne({
        where: { id: servicioGuardado.id },
        relations: { cliente: true, empleada: true },
      });
      if (serviceWithRelations) {
        this.realtimeEventsService.emitToJefes({
          type: 'service_requested',
          data: serviceWithRelations,
        });
      }
    } catch (sseErr) {
      console.error('Error emitting SSE event for new service:', sseErr);
    }

    // Send Telegram notification to Jefes & Admins
    try {
      await this.telegramService.notifyJefesNewService(servicioGuardado.id);
    } catch (telegramErr) {
      console.error(
        'Error notifying jefes via Telegram for new service:',
        telegramErr,
      );
    }

    return servicioGuardado;
  }

  async getPending(): Promise<Servicios[]> {
    return await this.serviciosRepository.find({
      where: { estado: 'pendiente' },
      relations: { cliente: true, empleada: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<Servicios[]> {
    return await this.serviciosRepository.find({
      relations: { cliente: true, empleada: true },
    });
  }

  async findOne(id: string): Promise<Servicios> {
    const servicio = await this.serviciosRepository.findOne({
      where: { id },
      relations: { cliente: true, empleada: true },
    });
    if (!servicio) {
      throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
    }
    return servicio;
  }

  async update(id: string, updateData: any): Promise<Servicios> {
    await this.serviciosRepository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const servicio = await this.findOne(id);
    await this.serviciosRepository.remove(servicio);
    return { deleted: true };
  }

  async aceptar(
    id: string,
    jefeId: string,
    tipoTransporte: 'chofer' | 'uber' = 'chofer',
  ): Promise<Servicios & { uberLink?: string }> {
    const servicio = await this.serviciosRepository.findOne({
      where: { id },
      relations: { cliente: true, empleada: { usuario: true } },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (servicio.estado !== 'pendiente') {
      throw new ConflictException(
        servicio.estado === 'pendiente_encadenado'
          ? 'Este servicio está en lista de espera encadenada y no puede aprobarse directamente. Se activará automáticamente cuando el servicio previo de la empleada finalice.'
          : 'El servicio ya no está pendiente de aprobación',
      );
    }

    // Validar que el usuario sea jefe o admin
    const user = await this.serviciosRepository.manager
      .getRepository(Usuarios)
      .findOne({
        where: { id: jefeId },
      });

    if (!user || (user.rol !== 'jefe' && user.rol !== 'admin')) {
      throw new ConflictException(
        'No tienes permisos para autorizar este servicio',
      );
    }

    // 1. Actualizar estado del servicio a 'en_curso'
    servicio.estado = 'en_curso';
    servicio.jefeId = jefeId;
    if (!servicio.horaInicioServicio) {
      servicio.horaInicioServicio = new Date();
    }
    await this.serviciosRepository.save(servicio);

    // Actualizar disponibilidad de la empleada a false (ocupada)
    if (servicio.empleadaId) {
      await this.serviciosRepository.manager
        .getRepository(Empleadas)
        .update(servicio.empleadaId, { disponible: false });
    }

    // 2. Crear viaje (viaje de ida para la empleada) sin chofer asignado inicialmente
    const nuevoViaje = this.viajesRepository.create({
      servicioId: servicio.id,
      choferId: null,
      tipo: 'ida',
      zona: 'domicilio',
      tarifa: 50.0, // Tarifa por defecto
      estado: tipoTransporte === 'uber' ? 'aceptado' : 'notificado',
      proveedorTransporte: tipoTransporte,
    });
    const viajeGuardado = await this.viajesRepository.save(nuevoViaje);

    // 3. Notificar a Jefes via SSE
    this.realtimeEventsService.emitToJefes({
      type: 'service_accepted',
      data: { id: servicio.id, viajeId: viajeGuardado.id },
    });

    // 4. Notificar a Empleada via SSE
    this.realtimeEventsService.emitToEmployee(servicio.empleadaId, {
      type: 'new_service',
      data: servicio,
    });

    // Notificar a la empleada por Telegram si tiene telegramChatId
    const empUser = servicio.empleada?.usuario;
    if (
      empUser &&
      empUser.telegramChatId &&
      empUser.telegramChatId !== '111111111'
    ) {
      try {
        const targetChatId = empUser.telegramChatId;
        const threadId = undefined;

        if (targetChatId) {
          const inlineButtons: any[] = [
            [
              Markup.button.callback(
                '🏁 Finalizar Servicio',
                `finalizar_servicio:${servicio.id}`,
              ),
            ],
          ];

          inlineButtons.push([
            Markup.button.callback(
              '➕ Agregar Extra',
              `agregar_extra_list:${servicio.id}`,
            ),
          ]);

          const empMsg = await this.bot.telegram.sendMessage(
            targetChatId,
            `💼 *¡Servicio en Curso!* 🟢\n\n` +
              `• *Cliente:* ${servicio.cliente?.nombreTelegram || 'Desconocido'}\n` +
              `• *Duración:* ${servicio.duracionPactadaHoras} horas\n` +
              `• *Método de Pago:* ${servicio.metodoPago.toUpperCase()}\n\n` +
              `Cuando hayas terminado el servicio, presiona el botón de abajo para finalizarlo:`,
            {
              message_thread_id: threadId,
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard(inlineButtons),
            },
          );
          servicio.telegramEmpleadaMensajeId = empMsg.message_id.toString();
          await this.serviciosRepository.save(servicio);
        }
      } catch (telegramErr) {
        console.error(
          `Error al enviar notificación de Telegram a la empleada (chatId: ${empUser.telegramChatId}):`,
          telegramErr.message || telegramErr,
        );
      }
    }

    // Notificar al cliente por Telegram si tiene telegramChatId
    if (servicio.cliente?.telegramChatId) {
      try {
        await this.bot.telegram.sendMessage(
          servicio.cliente.telegramChatId,
          `🔔 *¡Tu servicio ha sido aceptado!* 🟢\n\n` +
            `Tu servicio con la empleada *${servicio.empleada.nombreArtistico}* ha sido aprobado y el transporte ya se está coordinando.`,
          { parse_mode: 'Markdown' },
        );
      } catch (telegramErr) {
        console.error(
          `Error al enviar notificación de aceptación al cliente (chatId: ${servicio.cliente.telegramChatId}):`,
          telegramErr.message || telegramErr,
        );
      }
    }

    // 5. Iniciar despacho de choferes por proximidad
    let uberLink: string | undefined;
    if (tipoTransporte === 'uber') {
      const latEmp = servicio.empleada?.ubicacionLat;
      const lngEmp = servicio.empleada?.ubicacionLng;
      const latCli = servicio.ubicacionClienteLat;
      const lngCli = servicio.ubicacionClienteLng;

      // m.uber.com/ul/ es el Universal Link oficial: abre la app si está instalada
      // y hace fallback a la web móvil si no lo está.
      // dropoff[nickname] es obligatorio para que el pin de destino aparezca en la app.
      let uberBase = `https://m.uber.com/ul/?action=setPickup`;
      uberBase += `&dropoff[latitude]=${latCli}&dropoff[longitude]=${lngCli}&dropoff[nickname]=Destino`;
      if (latEmp && lngEmp) {
        uberBase += `&pickup[latitude]=${latEmp}&pickup[longitude]=${lngEmp}&pickup[nickname]=Recoger%20Empleada`;
      } else {
        // Sin ubicación de empleada, Uber usará la ubicación actual del usuario
        uberBase += `&pickup=my_location`;
      }
      uberLink = uberBase;
    } else {
      try {
        await this.dispatchViaje(viajeGuardado.id);
      } catch (dispatchErr) {
        console.error(
          'Error al iniciar despacho de choferes por proximidad:',
          dispatchErr,
        );
      }
    }

    return {
      ...servicio,
      uberLink,
    } as any;
  }

  async rechazar(id: string, jefeId: string): Promise<Servicios> {
    const servicio = await this.serviciosRepository.findOne({
      where: { id },
      relations: { empleada: true, jefe: true, cliente: true },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (servicio.estado !== 'pendiente') {
      throw new ConflictException(
        'El servicio ya no está pendiente de aprobación',
      );
    }

    // Validar que el usuario sea jefe o admin
    const user = await this.serviciosRepository.manager
      .getRepository(Usuarios)
      .findOne({
        where: { id: jefeId },
      });

    if (!user || (user.rol !== 'jefe' && user.rol !== 'admin')) {
      throw new ConflictException(
        'No tienes permisos para autorizar este servicio',
      );
    }

    // 1. Actualizar estado del servicio a 'cancelado'
    servicio.estado = 'cancelado';
    servicio.jefeId = jefeId;
    await this.serviciosRepository.save(servicio);

    // Actualizar disponibilidad de la empleada a true (disponible)
    if (servicio.empleadaId) {
      await this.serviciosRepository.manager
        .getRepository(Empleadas)
        .update(servicio.empleadaId, { disponible: true });
    }

    // 2. Notificar a Jefes via SSE
    this.realtimeEventsService.emitToJefes({
      type: 'service_rejected',
      data: { id: servicio.id },
    });

    // 3. Eliminar el tema (hilo) del grupo de Telegram si existe
    if (servicio.telegramThreadId && servicio.jefe?.grupoTelegramId) {
      try {
        await this.bot.telegram.deleteForumTopic(
          servicio.jefe.grupoTelegramId,
          parseInt(servicio.telegramThreadId, 10),
        );
      } catch (err) {
        console.error('Error deleting forum topic on reject:', err);
      }
    }

    // 4. Notificar al cliente via Telegram con opciones de reinicio
    if (servicio.clienteTelegramId) {
      try {
        await this.bot.telegram.sendMessage(
          servicio.clienteTelegramId,
          `❌ *Tu solicitud de servicio ha sido rechazada.* \n\n` +
            `Lamentamos el inconveniente. Para iniciar un nuevo servicio, por favor utiliza un enlace de contratación desde nuestra web.`,
          {
            parse_mode: 'Markdown',
          },
        );
      } catch (err) {
        console.error('Error notifying client of rejected service:', err);
      }
    }

    return servicio;
  }

  onModuleInit() {
    // Check every 60 seconds
    setInterval(() => {
      this.checkActiveServicesForExtension().catch((err) =>
        console.error('Error checking active services for extension:', err),
      );
    }, 60000);
  }

  /**
   * Devuelve el servicio actualmente en_curso de una empleada, si existe.
   */
  async findServicioActivoDeEmpleada(
    empleadaId: string,
  ): Promise<Servicios | null> {
    return this.serviciosRepository.findOne({
      where: { empleadaId, estado: 'en_curso' },
      order: { horaInicioServicio: 'DESC' },
    });
  }

  /**
   * Cancela un servicio en estado pendiente_encadenado.
   * Solo el cliente propietario puede cancelarlo y solo mientras no haya iniciado.
   */
  async cancelarServicioEncadenado(
    servicioId: string,
    clienteId: string,
  ): Promise<{ cancelled: boolean }> {
    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio encadenado no encontrado');
    }

    if (servicio.clienteId !== clienteId) {
      throw new ConflictException(
        'No tienes permiso para cancelar este servicio',
      );
    }

    if (servicio.estado !== 'pendiente_encadenado') {
      throw new ConflictException(
        `El servicio no puede cancelarse porque ya está en estado '${servicio.estado}'`,
      );
    }

    servicio.estado = 'cancelado';
    servicio.servicioPrevioId = null;
    await this.serviciosRepository.save(servicio);

    return { cancelled: true };
  }

  async checkActiveServicesForExtension() {
    const activeServices = await this.serviciosRepository.find({
      where: {
        estado: 'en_curso',
        notificacionExtensionEnviada: false,
      },
      relations: { empleada: { usuario: true } },
    });

    const now = Date.now();
    for (const service of activeServices) {
      // Solo notificar si el metodo de pago es tarjeta o transferencia
      if (
        service.metodoPago !== 'tarjeta' &&
        service.metodoPago !== 'transferencia'
      ) {
        continue;
      }
      if (
        !service.horaInicioServicio ||
        !service.empleada?.usuario?.telegramChatId
      ) {
        continue;
      }

      const durationMs = Number(service.duracionPactadaHoras) * 60 * 60 * 1000;
      const endTime = service.horaInicioServicio.getTime() + durationMs;
      const notificationTime = endTime - 15 * 60 * 1000; // 15 minutes before scheduled end

      if (now >= notificationTime) {
        // Mark as sent to prevent multiple triggers
        service.notificacionExtensionEnviada = true;
        await this.serviciosRepository.save(service);

        try {
          const targetChatId = service.empleada.usuario.telegramChatId;
          const threadId = undefined;

          if (targetChatId) {
            await this.bot.telegram.sendMessage(
              targetChatId,
              `⏳ *Aviso de Finalización* ⏳\n\n` +
                `Tu servicio está programado para finalizar en aproximadamente 15 minutos.\n\n` +
                `¿Deseas extender el tiempo del servicio?`,
              {
                message_thread_id: threadId,
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback(
                      '➕ 1 Hora',
                      `extender_servicio:${service.id}:1`,
                    ),
                    Markup.button.callback(
                      '➕ 2 Horas',
                      `extender_servicio:${service.id}:2`,
                    ),
                  ],
                  [
                    Markup.button.callback(
                      '➕ 3 Horas',
                      `extender_servicio:${service.id}:3`,
                    ),
                    Markup.button.callback(
                      '❌ No extender',
                      `no_extender_servicio:${service.id}`,
                    ),
                  ],
                ]),
              },
            );
          }
        } catch (err) {
          console.error(
            `Error sending extension prompt to employee (chatId: ${service.empleada.usuario.telegramChatId}):`,
            err,
          );
        }
      }
    }
  }

  async dispatchViaje(viajeId: string): Promise<void> {
    this.clearDispatchTimeout(viajeId);

    const viaje = await this.viajesRepository.findOne({
      where: { id: viajeId },
      relations: {
        servicio: {
          empleada: { usuario: true },
          cliente: true,
        },
      },
    });

    if (!viaje) {
      console.error(`[dispatchViaje] Viaje ${viajeId} no encontrado.`);
      return;
    }

    // Si el viaje ya no está en estado "notificado", detenemos el despacho
    if (viaje.estado !== 'notificado') {
      return;
    }

    let searchLat: number;
    let searchLng: number;

    if (viaje.tipo === 'ida') {
      if (
        !viaje.servicio?.empleada?.ubicacionLat ||
        !viaje.servicio?.empleada?.ubicacionLng
      ) {
        console.error(
          `[dispatchViaje] Ubicación de empleada faltante para viaje ${viajeId}.`,
        );
        return;
      }
      searchLat = viaje.servicio.empleada.ubicacionLat;
      searchLng = viaje.servicio.empleada.ubicacionLng;
    } else {
      if (
        !viaje.servicio?.ubicacionClienteLat ||
        !viaje.servicio?.ubicacionClienteLng
      ) {
        console.error(
          `[dispatchViaje] Ubicación de cliente faltante para viaje de regreso ${viajeId}.`,
        );
        return;
      }
      searchLat = viaje.servicio.ubicacionClienteLat;
      searchLng = viaje.servicio.ubicacionClienteLng;
    }

    // Obtener lista de IDs de choferes ya notificados en este viaje
    const notificadosIds: string[] = Array.isArray(viaje.choferesNotificados)
      ? viaje.choferesNotificados
      : [];

    // Buscar el chofer disponible más cercano que no haya sido notificado
    const query = this.choferesRepository
      .createQueryBuilder('chofer')
      .innerJoinAndSelect('chofer.usuario', 'usuario')
      .where('chofer.disponible = :disponible', { disponible: true })
      .andWhere('usuario.telegramChatId IS NOT NULL')
      .andWhere('chofer.ubicacionLat IS NOT NULL')
      .andWhere('chofer.ubicacionLng IS NOT NULL');

    if (notificadosIds.length > 0) {
      query.andWhere('chofer.id NOT IN (:...notificadosIds)', {
        notificadosIds,
      });
    }

    const result = await query
      .select([
        'chofer.id',
        'chofer.nombre',
        'chofer.telefono',
        'chofer.ubicacionLat',
        'chofer.ubicacionLng',
        'usuario.telegramChatId',
      ])
      .addSelect(
        'calcular_distancia_haversine(:lat, :lng, CAST(chofer.ubicacion_lat AS double precision), CAST(chofer.ubicacion_lng AS double precision))',
        'distancia',
      )
      .setParameter('lat', searchLat)
      .setParameter('lng', searchLng)
      .orderBy('distancia', 'ASC')
      .getRawAndEntities();

    if (result.entities.length === 0) {
      console.log(
        `[dispatchViaje] No hay choferes disponibles para el viaje ${viajeId}.`,
      );
      return;
    }

    const nearestDriver = result.entities[0];
    const nearestRaw = result.raw[0];
    const distancia = parseFloat(nearestRaw.distancia);

    // Actualizar viaje con el chofer asignado temporalmente, agregar a la lista de notificados
    viaje.choferId = nearestDriver.id;
    viaje.choferesNotificados = [...notificadosIds, nearestDriver.id];
    viaje.horaNotificacion = new Date();
    await this.viajesRepository.save(viaje);

    // Enviar mensaje al chofer por privado
    const driverChatId = nearestDriver.usuario.telegramChatId;
    if (driverChatId) {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${searchLat},${searchLng}`;
      let messageText = '';

      if (viaje.tipo === 'ida') {
        messageText =
          `📢 *¡Oferta de Viaje Disponible (Ida)!* 🚗\n\n` +
          `• *Pasajera (Empleada):* ${viaje.servicio.empleada.nombreArtistico}\n` +
          `• *Punto de Recogida:* [Ver en Mapa](${mapsUrl})\n` +
          `• *Distancia a ti:* ${distancia.toFixed(2)} km\n` +
          `• *Duración del Servicio:* ${viaje.servicio.duracionPactadaHoras} horas\n\n` +
          `⚠️ Tienes *2 minutos* para aceptar esta oferta antes de que pase al siguiente chofer más cercano.`;
      } else {
        const empDestName = viaje.servicio.empleada.nombreArtistico;
        messageText =
          `📢 *¡Oferta de Viaje Disponible (Regreso)!* 🚗\n\n` +
          `• *Pasajera (Empleada):* ${empDestName}\n` +
          `• *Punto de Recogida (Cliente):* [Ver en Mapa](${mapsUrl})\n` +
          `• *Distancia a ti:* ${distancia.toFixed(2)} km\n\n` +
          `⚠️ Tienes *2 minutos* para aceptar esta oferta antes de que pase al siguiente chofer más cercano.`;
      }

      try {
        const sentMsg = await this.bot.telegram.sendMessage(
          driverChatId,
          messageText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '🚗 Aceptar Viaje',
                  `c_ac_v:${viaje.id}:${driverChatId}`,
                ),
                Markup.button.callback(
                  '❌ Rechazar Oferta',
                  `r_v_o:${viaje.id}`,
                ),
              ],
            ]),
          },
        );
        viaje.telegramChoferMsgOfertaId = sentMsg.message_id.toString();
        await this.viajesRepository.save(viaje);
      } catch (err) {
        console.error(
          `[dispatchViaje] Error enviando mensaje a Telegram de chofer ${nearestDriver.id}:`,
          err,
        );
        await this.rechazarOfertaManual(viaje.id, nearestDriver.id);
        return;
      }
    }

    // Configurar Timeout de 2 minutos (120000 ms) para expirar la oferta si no responde
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const checkViaje = await this.viajesRepository.findOne({
            where: { id: viajeId },
          });
          if (
            checkViaje &&
            checkViaje.estado === 'notificado' &&
            checkViaje.choferId === nearestDriver.id
          ) {
            console.log(
              `[dispatchViaje] Oferta expirada por timeout para viaje ${viajeId}, chofer ${nearestDriver.id}`,
            );
            await this.expirarOfertaYContinuar(viajeId, nearestDriver.id);
          }
        } catch (timeoutErr) {
          console.error(
            `[dispatchViaje] Error en timeout de viaje ${viajeId}:`,
            timeoutErr,
          );
        }
      })();
    }, 120000);
    this.dispatchTimeouts.set(viajeId, timeout);
    console.log(`[dispatchViaje] Timeout establecido para viaje ${viajeId}`);
  }

  async expirarOfertaYContinuar(
    viajeId: string,
    choferId: string,
  ): Promise<void> {
    this.clearDispatchTimeout(viajeId);

    const viaje = await this.viajesRepository.findOne({
      where: { id: viajeId },
      relations: { chofer: { usuario: true } },
    });

    if (viaje && viaje.estado === 'notificado' && viaje.choferId === choferId) {
      const driverChatId = viaje.chofer?.usuario?.telegramChatId;
      if (driverChatId && viaje.telegramChoferMsgOfertaId) {
        try {
          await this.bot.telegram.editMessageText(
            driverChatId,
            parseInt(viaje.telegramChoferMsgOfertaId, 10),
            undefined,
            `⏰ *Oferta expirada.*\nNo respondiste a tiempo y el viaje ha sido ofrecido al siguiente chofer disponible.`,
          );
        } catch (editErr) {
          console.error(`Error al editar mensaje de oferta expirada:`, editErr);
        }
      }

      viaje.choferId = null;
      viaje.telegramChoferMsgOfertaId = null;
      await this.viajesRepository.save(viaje);

      await this.dispatchViaje(viajeId);
    }
  }

  async rechazarOfertaManual(viajeId: string, choferId: string): Promise<void> {
    this.clearDispatchTimeout(viajeId);

    const viaje = await this.viajesRepository.findOne({
      where: { id: viajeId },
      relations: { chofer: { usuario: true } },
    });

    if (viaje && viaje.estado === 'notificado' && viaje.choferId === choferId) {
      const driverChatId = viaje.chofer?.usuario?.telegramChatId;
      if (driverChatId && viaje.telegramChoferMsgOfertaId) {
        try {
          await this.bot.telegram.editMessageText(
            driverChatId,
            parseInt(viaje.telegramChoferMsgOfertaId, 10),
            undefined,
            `❌ *Has rechazado esta oferta de viaje.*`,
          );
        } catch (editErr) {
          console.error(
            `Error al editar mensaje de oferta rechazada:`,
            editErr,
          );
        }
      }

      viaje.choferId = null;
      viaje.telegramChoferMsgOfertaId = null;
      await this.viajesRepository.save(viaje);

      await this.dispatchViaje(viajeId);
    }
  }

  startWaitTimeout(servicioId: string, durationMs: number = 600000) {
    this.clearWaitTimeout(servicioId);

    const timeout = setTimeout(() => {
      void this.handleWaitTimeoutExpired(servicioId).catch((err) => {
        console.error(
          `Error handling wait timeout for service ${servicioId}:`,
          err,
        );
      });
    }, durationMs);

    this.waitTimeouts.set(servicioId, timeout);
  }

  clearWaitTimeout(servicioId: string) {
    const existing = this.waitTimeouts.get(servicioId);
    if (existing) {
      clearTimeout(existing);
      this.waitTimeouts.delete(servicioId);
    }
  }

  async handleWaitTimeoutExpired(servicioId: string): Promise<void> {
    this.waitTimeouts.delete(servicioId);

    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        empleada: { usuario: true },
        cliente: true,
        viajes: true,
      },
    });

    if (!servicio || servicio.estado !== 'en_curso') {
      return;
    }

    const viajeIda = servicio.viajes.find((v) => v.tipo === 'ida');
    if (
      !viajeIda ||
      viajeIda.estado === 'en_curso' ||
      viajeIda.estado === 'finalizado'
    ) {
      return;
    }

    console.log(
      `[handleWaitTimeoutExpired] Expiró tiempo de espera para servicio ${servicioId}. Prórrogas usadas: ${servicio.prorrogasUsadas}`,
    );

    await this.cancelarServicioPorDemora(servicioId);
  }

  async cancelarServicioPorDemora(servicioId: string): Promise<void> {
    const servicio = await this.serviciosRepository.findOne({
      where: { id: servicioId },
      relations: {
        empleada: { usuario: true },
        cliente: true,
        viajes: true,
      },
    });

    if (!servicio || servicio.estado !== 'en_curso') return;

    servicio.estado = 'cancelado';
    await this.serviciosRepository.save(servicio);

    const viajeIda = servicio.viajes.find((v) => v.tipo === 'ida');
    if (viajeIda) {
      viajeIda.estado = 'cancelado';
      await this.viajesRepository.save(viajeIda);

      if (viajeIda.choferId) {
        const chofer = await this.choferesRepository.findOne({
          where: { id: viajeIda.choferId },
          relations: { usuario: true },
        });
        if (chofer && chofer.usuario?.telegramChatId) {
          try {
            await this.bot.telegram.sendMessage(
              chofer.usuario.telegramChatId,
              `❌ *Servicio Cancelado:*\nEl viaje ha sido cancelado automáticamente debido a la demora de la empleada. Estás libre para tomar otros viajes.`,
              { parse_mode: 'Markdown' },
            );
          } catch (err) {
            console.error('Error al notificar al chofer de cancelación:', err);
          }
        }
      }
    }

    await this.serviciosRepository.manager
      .getRepository(Empleadas)
      .update(servicio.empleadaId, { disponible: true });

    const empUser = servicio.empleada?.usuario;
    if (empUser) {
      const targetChatId = empUser.telegramChatId;
      const threadId = undefined;

      if (targetChatId) {
        try {
          await this.bot.telegram.sendMessage(
            targetChatId,
            `❌ *Servicio Cancelado por Tardanza:*\nSe agotó el tiempo de espera límite y no abordaste el vehículo. El servicio con el cliente ha sido cancelado.`,
            { message_thread_id: threadId, parse_mode: 'Markdown' },
          );
        } catch (err) {
          console.error('Error al notificar a empleada de cancelación:', err);
        }
      }
    }

    if (servicio.cliente?.telegramChatId) {
      try {
        await this.bot.telegram.sendMessage(
          servicio.cliente.telegramChatId,
          `❌ *Servicio Cancelado:*\nLamentamos informarte que la empleada *${servicio.empleada.nombreArtistico}* no pudo estar disponible a tiempo y el servicio ha sido cancelado.\n\n` +
            `Te recomendamos ver otras opciones de empleadas disponibles ahora mismo:`,
          { parse_mode: 'Markdown' },
        );

        const disponibles = await this.serviciosRepository.manager
          .getRepository(Empleadas)
          .find({
            where: { disponible: true, catalogoActivo: true },
            take: 3,
          });

        if (disponibles.length > 0) {
          for (const emp of disponibles) {
            await this.bot.telegram.sendMessage(
              servicio.cliente.telegramChatId,
              `👩‍🍳 *${emp.nombreArtistico}*\n` +
                `• Tarifa: $${emp.precioBaseHora}/hr\n` +
                `• Descripción: ${emp.descripcion || 'Sin descripción'}`,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback(
                      '🤝 Contratar a ella',
                      `contratar_empleada:${emp.id}`,
                    ),
                  ],
                ]),
              },
            );
          }
        } else {
          await this.bot.telegram.sendMessage(
            servicio.cliente.telegramChatId,
            `Lo sentimos, no hay otras empleadas disponibles en este momento. Por favor, intenta de nuevo más tarde.`,
          );
        }
      } catch (err) {
        console.error('Error al notificar al cliente de cancelación:', err);
      }
    }
  }
}
