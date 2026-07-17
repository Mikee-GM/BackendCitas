import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { Empleadas } from './entities/employee.entity';
import { Usuarios } from '../users/entities/user.entity';
import { EmpleadaFotos } from '../employee-photos/entities/employee-photo.entity';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(EmpleadaFotos)
    private readonly empleadaFotosRepository: Repository<EmpleadaFotos>,
    private readonly dataSource: DataSource,
    private readonly uploadService: UploadService,
  ) {}

  async create(createEmployeeDto: CreateEmployeeDto): Promise<Empleadas> {
    const {
      email,
      password,
      telegramChatId,
      nombreReal,
      nombreArtistico,
      slugCatalogo,
      fotoPerfilUrl,
      descripcion,
      precioBaseHora,
      disponible,
      catalogoActivo,
      ubicacionLat,
      ubicacionLng,
      fotosExtra,
      jefeId,
      jefeSecundarioId,
      apartmentId,
      linkX,
      contactLabel,
      extras,
    } = createEmployeeDto;

    // 1. Validar que el email no esté registrado
    const usuarioExistente = await this.usuariosRepository.findOne({
      where: { email },
    });
    if (usuarioExistente) {
      throw new ConflictException(
        `El correo electrónico ${email} ya está registrado`,
      );
    }

    // 2. Validar que el slug no esté registrado
    const slugExistente = await this.empleadasRepository.findOne({
      where: { slugCatalogo },
    });
    if (slugExistente) {
      throw new ConflictException(
        `El slug de catálogo "${slugCatalogo}" ya está registrado`,
      );
    }

    // 3. Ejecutar transacción para creación atómica
    const result = await this.dataSource.transaction(async (manager) => {
      // A. Hashear la contraseña
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      // B. Crear el usuario
      const nuevoUsuario = manager.create(Usuarios, {
        email,
        passwordHash,
        rol: 'empleada',
        telegramChatId: telegramChatId || null,
      });
      const usuarioGuardado = await manager.save(Usuarios, nuevoUsuario);

      // C. Crear la empleada vinculada
      const nuevaEmpleada = manager.create(Empleadas, {
        usuarioId: usuarioGuardado.id,
        nombreReal,
        nombreArtistico,
        slugCatalogo,
        fotoPerfilUrl: fotoPerfilUrl || null,
        descripcion: descripcion || null,
        linkX: linkX || null,
        contactLabel: contactLabel || null,
        precioBaseHora: Number(precioBaseHora),
        disponible: disponible ?? false,
        catalogoActivo: catalogoActivo ?? true,
        ubicacionLat: ubicacionLat ? Number(ubicacionLat) : null,
        ubicacionLng: ubicacionLng ? Number(ubicacionLng) : null,
        jefeId: jefeId || null,
        jefeSecundarioId: jefeSecundarioId || null,
        apartmentId: apartmentId || null,
      });
      const empleadaGuardada = await manager.save(Empleadas, nuevaEmpleada);

      // D. Crear fotos extras de ser necesario
      const fotosGuardadas: EmpleadaFotos[] = [];
      if (fotosExtra && fotosExtra.length > 0) {
        for (let i = 0; i < fotosExtra.length; i++) {
          const nuevaFoto = manager.create(EmpleadaFotos, {
            empleadaId: empleadaGuardada.id,
            url: fotosExtra[i],
            orden: i,
          });
          const fotoGuardada = await manager.save(EmpleadaFotos, nuevaFoto);
          fotosGuardadas.push(fotoGuardada);
        }
      }

      // E. Crear extras del catálogo de ser necesario
      const extrasGuardados: ExtrasCatalogo[] = [];
      if (extras && extras.length > 0) {
        for (const ext of extras) {
          const nuevoExtra = manager.create(ExtrasCatalogo, {
            empleadaId: empleadaGuardada.id,
            nombre: ext.nombre,
            precio: Number(ext.precio),
            activo: true,
          });
          const extraGuardado = await manager.save(ExtrasCatalogo, nuevoExtra);
          extrasGuardados.push(extraGuardado);
        }
      }

      empleadaGuardada.usuario = usuarioGuardado;
      empleadaGuardada.empleadaFotos = fotosGuardadas;
      empleadaGuardada.extrasCatalogos = extrasGuardados;
      return empleadaGuardada;
    });

    // Omitir passwordHash de la respuesta
    if (result.usuario) {
      const { passwordHash: _, ...usuarioSinPassword } = result.usuario;
      result.usuario = usuarioSinPassword as Usuarios;
    }

    return result;
  }

  async findAll(): Promise<Empleadas[]> {
    return await this.empleadasRepository.find({
      relations: {
        usuario: true,
        empleadaFotos: true,
        extrasCatalogos: true,
        jefe: true,
        jefeSecundario: true,
      },
    });
  }

  async findAllActive(): Promise<Empleadas[]> {
    return await this.empleadasRepository.find({
      where: { catalogoActivo: true },
      relations: {
        usuario: true,
        empleadaFotos: true,
        extrasCatalogos: true,
        jefe: true,
        jefeSecundario: true,
      },
    });
  }

  async findOne(id: string): Promise<Empleadas> {
    const empleada = await this.empleadasRepository.findOne({
      where: { id },
      relations: {
        usuario: true,
        empleadaFotos: true,
        extrasCatalogos: true,
        jefe: true,
        jefeSecundario: true,
      },
    });

    if (!empleada) {
      throw new NotFoundException(`Empleada con ID ${id} no encontrado`);
    }

    return empleada;
  }

  async update(
    id: string,
    updateEmployeeDto: UpdateEmployeeDto,
  ): Promise<Empleadas> {
    const empleada = await this.findOne(id);

    // Si se actualiza el slug, verificar que sea único
    if (
      updateEmployeeDto.slugCatalogo &&
      updateEmployeeDto.slugCatalogo !== empleada.slugCatalogo
    ) {
      const slugExistente = await this.empleadasRepository.findOne({
        where: { slugCatalogo: updateEmployeeDto.slugCatalogo, id: Not(id) },
      });
      if (slugExistente) {
        throw new ConflictException(
          `El slug de catálogo "${updateEmployeeDto.slugCatalogo}" ya está registrado por otra empleada`,
        );
      }
    }

    // Ejecutar transacción si hay fotos extras o servicios extras a actualizar
    const { fotosExtra, extras, ...camposAActualizar } = updateEmployeeDto;

    // A. Si cambia la foto de perfil, eliminar la anterior de R2
    if (
      camposAActualizar.fotoPerfilUrl !== undefined &&
      camposAActualizar.fotoPerfilUrl !== empleada.fotoPerfilUrl
    ) {
      if (empleada.fotoPerfilUrl) {
        try {
          await this.uploadService.deleteFile(empleada.fotoPerfilUrl);
        } catch (err) {
          console.error('Error al eliminar fotoPerfilUrl antigua de R2:', err);
        }
      }
    }

    // B. Si se envían fotos extras, identificar cuáles fueron removidas y borrarlas de R2
    if (fotosExtra !== undefined) {
      const oldUrls = empleada.empleadaFotos
        ? empleada.empleadaFotos.map((f) => f.url)
        : [];
      const urlsToDelete = oldUrls.filter((url) => !fotosExtra.includes(url));

      for (const url of urlsToDelete) {
        if (url) {
          try {
            await this.uploadService.deleteFile(url);
          } catch (err) {
            console.error('Error al eliminar foto extra obsoleta de R2:', err);
          }
        }
      }
    }

    await this.dataSource.transaction(async (manager) => {
      // 1. Actualizar campos del perfil principal
      const updateData: any = { ...camposAActualizar };
      if (camposAActualizar.precioBaseHora !== undefined) {
        updateData.precioBaseHora = Number(camposAActualizar.precioBaseHora);
      }
      if (camposAActualizar.ubicacionLat !== undefined) {
        updateData.ubicacionLat =
          camposAActualizar.ubicacionLat !== null
            ? Number(camposAActualizar.ubicacionLat)
            : null;
      }
      if (camposAActualizar.ubicacionLng !== undefined) {
        updateData.ubicacionLng =
          camposAActualizar.ubicacionLng !== null
            ? Number(camposAActualizar.ubicacionLng)
            : null;
      }
      await manager.update(Empleadas, id, updateData);

      // 2. Actualizar fotos extras si se especifican
      if (fotosExtra !== undefined) {
        // Borrar fotos anteriores de la base de datos
        await manager.delete(EmpleadaFotos, { empleadaId: id });

        // Insertar nuevas fotos
        for (let i = 0; i < fotosExtra.length; i++) {
          const nuevaFoto = manager.create(EmpleadaFotos, {
            empleadaId: id,
            url: fotosExtra[i],
            orden: i,
          });
          await manager.save(EmpleadaFotos, nuevaFoto);
        }
      }

      // 3. Actualizar extras si se especifican
      if (extras !== undefined) {
        // Obtener los extras actuales
        const currentExtras = await manager.find(ExtrasCatalogo, {
          where: { empleadaId: id },
        });

        // Identificar los extras recibidos por nombre para actualizar o crear
        const extrasNombresRecibidos = extras.map((e) =>
          e.nombre.toLowerCase().trim(),
        );

        // A. Desactivar/Eliminar los que no se enviaron
        for (const current of currentExtras) {
          if (
            !extrasNombresRecibidos.includes(
              current.nombre.toLowerCase().trim(),
            )
          ) {
            try {
              await manager.delete(ExtrasCatalogo, { id: current.id });
            } catch (e) {
              await manager.update(ExtrasCatalogo, current.id, {
                activo: false,
              });
            }
          }
        }

        // B. Crear o actualizar los que sí se enviaron
        for (const ext of extras) {
          const matched = currentExtras.find(
            (c) =>
              c.nombre.toLowerCase().trim() === ext.nombre.toLowerCase().trim(),
          );

          if (matched) {
            await manager.update(ExtrasCatalogo, matched.id, {
              precio: Number(ext.precio),
              activo: true,
            });
          } else {
            const nuevoExtra = manager.create(ExtrasCatalogo, {
              empleadaId: id,
              nombre: ext.nombre,
              precio: Number(ext.precio),
              activo: true,
            });
            await manager.save(ExtrasCatalogo, nuevoExtra);
          }
        }
      }
    });

    return await this.findOne(id);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const empleada = await this.findOne(id);

    // 1. Eliminar foto principal de R2
    if (empleada.fotoPerfilUrl) {
      try {
        await this.uploadService.deleteFile(empleada.fotoPerfilUrl);
      } catch (err) {
        console.error('Error al eliminar fotoPerfilUrl de R2 en borrado:', err);
      }
    }

    // 2. Eliminar fotos extras de R2
    if (empleada.empleadaFotos && empleada.empleadaFotos.length > 0) {
      for (const foto of empleada.empleadaFotos) {
        if (foto.url) {
          try {
            await this.uploadService.deleteFile(foto.url);
          } catch (err) {
            console.error(
              'Error al eliminar foto extra de R2 en borrado:',
              err,
            );
          }
        }
      }
    }

    // Eliminar el usuario, lo cual cascada y borra el perfil y fotos en la base de datos
    await this.usuariosRepository.delete(empleada.usuarioId);
    return { deleted: true };
  }
}
