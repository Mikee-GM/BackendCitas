import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
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

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
    @InjectRepository(Viajes)
    private readonly viajesRepository: Repository<Viajes>,
    private readonly realtimeEventsService: RealtimeEventsService,
    @InjectBot() private readonly bot: Telegraf<Context>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  async create(createServiceDto: any): Promise<Servicios> {
    // Si es independiente y no tiene jefeId especificado, asignamos su propio usuarioId
    if (createServiceDto.empleadaId && !createServiceDto.jefeId) {
      try {
        const empleadasRepository =
          this.serviciosRepository.manager.getRepository(Empleadas);
        const emp = await empleadasRepository.findOne({
          where: { id: createServiceDto.empleadaId },
        });
        if (emp && emp.tipo === 'independiente') {
          createServiceDto.jefeId = emp.usuarioId;
        }
      } catch (err) {
        console.error(
          'Error auto-assigning jefeId for independent employee:',
          err,
        );
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

  async aceptar(id: string, jefeId: string): Promise<Servicios> {
    const servicio = await this.serviciosRepository.findOne({
      where: { id },
      relations: { cliente: true, empleada: true },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (servicio.estado !== 'pendiente') {
      throw new ConflictException(
        'El servicio ya no está pendiente de aprobación',
      );
    }

    // Validar que el usuario sea jefe, admin o la propia empleada independiente
    const user = await this.serviciosRepository.manager
      .getRepository(Usuarios)
      .findOne({
        where: { id: jefeId },
      });
    const isIndependentEmployee =
      servicio.empleada &&
      servicio.empleada.tipo === 'independiente' &&
      servicio.empleada.usuarioId === jefeId;

    if (
      !user ||
      (user.rol !== 'jefe' && user.rol !== 'admin' && !isIndependentEmployee)
    ) {
      throw new ConflictException(
        'No tienes permisos para autorizar este servicio',
      );
    }

    // 1. Actualizar estado del servicio a 'en_curso'
    servicio.estado = 'en_curso';
    servicio.jefeId = jefeId;
    await this.serviciosRepository.save(servicio);

    // 2. Crear viaje (viaje de ida para la empleada) sin chofer asignado inicialmente
    const nuevoViaje = this.viajesRepository.create({
      servicioId: servicio.id,
      choferId: null,
      tipo: 'ida',
      zona: 'domicilio',
      tarifa: '50.00', // Tarifa por defecto
      estado: 'notificado',
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

    // 5. Enviar mensaje al grupo de choferes en Telegram
    const driversGroupId = process.env.TELEGRAM_DRIVERS_GROUP_ID;
    if (driversGroupId) {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${servicio.ubicacionClienteLat},${servicio.ubicacionClienteLng}`;
      const messageText =
        `📢 *¡Nuevo Viaje Disponible!* 🚗\n\n` +
        `• *Empleada:* ${servicio.empleada.nombreArtistico}\n` +
        `• *Destino (Cliente):* [Ver en Mapa](${mapsUrl})\n` +
        `• *Duración:* ${servicio.duracionPactadaHoras} horas\n` +
        `• *Notas/Ubicación:* ${servicio.notas || 'Sin notas adicionales'}\n\n` +
        `Presiona el botón de abajo para tomar este viaje de forma inmediata.`;

      try {
        await this.bot.telegram.sendMessage(driversGroupId, messageText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            Markup.button.callback(
              '🚗 Aceptar Viaje',
              `aceptar_viaje:${viajeGuardado.id}`,
            ),
          ]),
        });
      } catch (err) {
        console.error('Error al enviar mensaje al grupo de choferes:', err);
      }
    }

    return servicio;
  }

  async rechazar(id: string, jefeId: string): Promise<Servicios> {
    const servicio = await this.serviciosRepository.findOne({
      where: { id },
      relations: { empleada: true },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }

    if (servicio.estado !== 'pendiente') {
      throw new ConflictException(
        'El servicio ya no está pendiente de aprobación',
      );
    }

    // Validar que el usuario sea jefe, admin o la propia empleada independiente
    const user = await this.serviciosRepository.manager
      .getRepository(Usuarios)
      .findOne({
        where: { id: jefeId },
      });
    const isIndependentEmployee =
      servicio.empleada &&
      servicio.empleada.tipo === 'independiente' &&
      servicio.empleada.usuarioId === jefeId;

    if (
      !user ||
      (user.rol !== 'jefe' && user.rol !== 'admin' && !isIndependentEmployee)
    ) {
      throw new ConflictException(
        'No tienes permisos para autorizar este servicio',
      );
    }

    // 1. Actualizar estado del servicio a 'cancelado'
    servicio.estado = 'cancelado';
    servicio.jefeId = jefeId;
    await this.serviciosRepository.save(servicio);

    // 2. Notificar a Jefes via SSE
    this.realtimeEventsService.emitToJefes({
      type: 'service_rejected',
      data: { id: servicio.id },
    });

    return servicio;
  }
}
