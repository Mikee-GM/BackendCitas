import { Inject, forwardRef, Logger } from '@nestjs/common';
import { Update, Ctx, Action, Command } from 'nestjs-telegraf';
import { Context, Markup } from 'telegraf';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';

@Update()
export class TelegramCatalogUpdate {
  private readonly logger = new Logger(TelegramCatalogUpdate.name);

  constructor(
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Servicios)
    private readonly serviciosRepository: Repository<Servicios>,
  ) {}

  async listEmpleadas(ctx: Context) {
    const list = await this.empleadasRepository.find({
      where: { catalogoActivo: true },
    });

    if (list.length === 0) {
      await ctx.reply(
        'No hay empleadas activas en el catálogo en este momento.',
      );
      return;
    }

    await ctx.reply('Catálogo de Empleadas:');

    for (const e of list) {
      let status = '🔴 Ocupada';
      if (!e.disponible) {
        const activeService = await this.serviciosRepository.findOne({
          where: { empleadaId: e.id, estado: 'en_curso' },
        });
        if (activeService && activeService.horaInicioServicio) {
          const durationMs =
            Number(activeService.duracionPactadaHoras) * 60 * 60 * 1000;
          const graceMs = 15 * 60 * 1000; // 15 minutes grace as requested
          const endTime =
            activeService.horaInicioServicio.getTime() + durationMs + graceMs;
          const remainingMs = endTime - Date.now();
          if (remainingMs > 0) {
            const remainingMin = Math.ceil(remainingMs / (60 * 1000));
            const hours = Math.floor(remainingMin / 60);
            const minutes = remainingMin % 60;
            const timeStr =
              hours > 0 ? `~${hours}h ${minutes}m` : `~${minutes}m`;
            status = `🔴 Ocupada (disp. en ${timeStr})`;
          } else {
            status = `🔴 Ocupada (disp. pronto)`;
          }
        }
      } else {
        status = '🟢 Disponible';
      }
      const caption = `*${e.nombreArtistico}* (${status})\n💰 *Tarifa:* $${e.precioBaseHora}/hr`;
      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback(
          '🔍 Ver Perfil Completo',
          `ver_empleada:${e.id}`,
        ),
      ]);

      const hasValidPhoto =
        e.fotoPerfilUrl &&
        (e.fotoPerfilUrl.startsWith('http://') ||
          e.fotoPerfilUrl.startsWith('https://'));

      if (hasValidPhoto) {
        try {
          await ctx.replyWithPhoto(e.fotoPerfilUrl!, {
            caption,
            parse_mode: 'Markdown',
            ...keyboard,
          });
        } catch (error) {
          // Fallback si falla la descarga de la imagen por Telegram
          await ctx.reply(caption, {
            parse_mode: 'Markdown',
            ...keyboard,
          });
        }
      } else {
        await ctx.reply(caption, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    }
  }

  @Command('empleadas')
  async onCommandEmpleadas(@Ctx() ctx: Context) {
    await this.listEmpleadas(ctx);
  }

  @Action('ver_empleadas')
  async onActionVerEmpleadas(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.listEmpleadas(ctx);
  }

  @Action(/^ver_empleada:(.+)$/)
  async onVerEmpleado(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const match = (ctx as any).match;
    if (!match) return;
    const id = match[1];

    const empleada = await this.empleadasRepository.findOne({
      where: { id },
      relations: { empleadaFotos: true },
    });

    if (!empleada) {
      await ctx.reply('La empleada seleccionada ya no está disponible.');
      return;
    }

    let status = '🔴 Ocupada';
    if (!empleada.disponible) {
      const activeService = await this.serviciosRepository.findOne({
        where: { empleadaId: empleada.id, estado: 'en_curso' },
      });
      if (activeService && activeService.horaInicioServicio) {
        const durationMs =
          Number(activeService.duracionPactadaHoras) * 60 * 60 * 1000;
        const graceMs = 15 * 60 * 1000;
        const endTime =
          activeService.horaInicioServicio.getTime() + durationMs + graceMs;
        const remainingMs = endTime - Date.now();
        if (remainingMs > 0) {
          const remainingMin = Math.ceil(remainingMs / (60 * 1000));
          const hours = Math.floor(remainingMin / 60);
          const minutes = remainingMin % 60;
          const timeStr = hours > 0 ? `~${hours}h ${minutes}m` : `~${minutes}m`;
          status = `🔴 Ocupada (disp. en ${timeStr})`;
        } else {
          status = `🔴 Ocupada (disp. pronto)`;
        }
      }
    } else {
      status = '🟢 Disponible';
    }
    const caption =
      `*${empleada.nombreArtistico}*\n` +
      `Estado: ${status}\n` +
      `💰 *Tarifa:* $${empleada.precioBaseHora}/hr\n\n` +
      `_${empleada.descripcion || 'Sin descripción'}_`;

    const photos: string[] = [];
    if (
      empleada.fotoPerfilUrl &&
      (empleada.fotoPerfilUrl.startsWith('http://') ||
        empleada.fotoPerfilUrl.startsWith('https://'))
    ) {
      photos.push(empleada.fotoPerfilUrl);
    }
    if (empleada.empleadaFotos && empleada.empleadaFotos.length > 0) {
      empleada.empleadaFotos.forEach((f) => {
        if (
          f.url &&
          (f.url.startsWith('http://') || f.url.startsWith('https://'))
        ) {
          photos.push(f.url);
        }
      });
    }

    const hireKeyboard = empleada.disponible
      ? Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🤝 Contratar',
              `contratar_empleada:${empleada.id}`,
            ),
          ],
        ])
      : Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '📅 Reservar Siguiente Turno',
              `reservar_siguiente:${empleada.id}`,
            ),
          ],
          [Markup.button.callback('🔙 Volver al Catálogo', 'ver_empleadas')],
        ]);

    if (photos.length > 0) {
      try {
        const mediaGroup = photos.map((url, index) => ({
          type: 'photo' as const,
          media: url,
          caption: index === 0 ? caption : undefined,
          parse_mode: 'Markdown' as const,
        }));

        await ctx.replyWithMediaGroup(mediaGroup);
        await ctx.reply('¿Deseas contratar a esta empleada?', hireKeyboard);
      } catch (error) {
        // Fallback si Telegram no puede descargar las imágenes (por ej. si apuntan a localhost)
        await ctx.reply(
          caption + '\n\n_(Nota: Las fotos no se pudieron cargar en Telegram)_',
          { parse_mode: 'Markdown', ...hireKeyboard },
        );
      }
    } else {
      await ctx.reply(caption, { parse_mode: 'Markdown', ...hireKeyboard });
    }
  }
}
