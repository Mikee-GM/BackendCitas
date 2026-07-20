import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, Not } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { Empleadas } from './entities/employee.entity';
import { Usuarios } from '../users/entities/user.entity';
import { EmpleadaFotos } from '../employee-photos/entities/employee-photo.entity';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { EmployeeOnboarding } from '../employee-onboarding/entities/employee-onboarding.entity';
import { EmployeeRating } from './entities/employee-rating.entity';
import { Servicios } from '../services/entities/service.entity';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Empleadas)
    private readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Usuarios)
    private readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(EmpleadaFotos)
    private readonly empleadaFotosRepository: Repository<EmpleadaFotos>,
    @InjectRepository(EmployeeRating)
    private readonly employeeRatingsRepository: Repository<EmployeeRating>,
    private readonly dataSource: DataSource,
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
      tipo,
      jefeId,
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
        precioBaseHora: precioBaseHora.toString(),
        disponible: disponible ?? false,
        catalogoActivo: catalogoActivo ?? true,
        ubicacionLat: ubicacionLat || null,
        ubicacionLng: ubicacionLng || null,
        tipo,
        jefeId: jefeId || null,
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
            precio: ext.precio.toString(),
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
    const employees = await this.empleadasRepository.find({
      relations: { usuario: true, empleadaFotos: true, extrasCatalogos: true },
    });
    return this.attachScores(employees);
  }

  async findAllActive(): Promise<Empleadas[]> {
    const employees = await this.empleadasRepository.find({
      where: { catalogoActivo: true },
      relations: { usuario: true, empleadaFotos: true, extrasCatalogos: true },
    });
    return this.attachScores(employees);
  }

  async findOne(id: string): Promise<Empleadas> {
    const empleada = await this.empleadasRepository.findOne({
      where: { id },
      relations: { usuario: true, empleadaFotos: true, extrasCatalogos: true },
    });

    if (!empleada) {
      throw new NotFoundException(`Empleada con ID ${id} no encontrado`);
    }

    const [employeeWithTrustScore] = await this.attachScores([empleada]);
    return employeeWithTrustScore;
  }

  private async attachScores(employees: Empleadas[]): Promise<Empleadas[]> {
    if (employees.length === 0) return employees;

    const [onboardings, clientRatings, staffRatings] = await Promise.all([
      this.dataSource
      .getRepository(EmployeeOnboarding)
      .find({
        where: {
          employeeId: In(employees.map((employee) => employee.id)),
          active: true,
        },
        select: {
          employeeId: true,
          attemptCount: true,
          trustScore: true,
        },
      }),
      this.dataSource.getRepository(Servicios)
        .createQueryBuilder('service')
        .select('service.empleada_id', 'employeeId')
        .addSelect('AVG(service.calificacion)', 'average')
        .addSelect('COUNT(service.calificacion)', 'count')
        .where('service.empleada_id IN (:...ids)', { ids: employees.map((employee) => employee.id) })
        .andWhere('service.calificacion IS NOT NULL')
        .groupBy('service.empleada_id')
        .getRawMany(),
      this.employeeRatingsRepository
        .createQueryBuilder('rating')
        .select('rating.employee_id', 'employeeId')
        .addSelect('rating.source', 'source')
        .addSelect('AVG(rating.rating)', 'average')
        .addSelect('COUNT(rating.rating)', 'count')
        .where('rating.employee_id IN (:...ids)', { ids: employees.map((employee) => employee.id) })
        .groupBy('rating.employee_id, rating.source')
        .getRawMany(),
    ]);
    const onboardingByEmployee = new Map(
      onboardings.map((onboarding) => [onboarding.employeeId, onboarding]),
    );
    const clientByEmployee = new Map(clientRatings.map((row) => [row.employeeId, Number(row.average)]));
    const staffByEmployee = new Map<string, number[]>();
    for (const row of staffRatings) {
      const values = staffByEmployee.get(row.employeeId) || [];
      values.push(Number(row.average));
      staffByEmployee.set(row.employeeId, values);
    }

    return employees.map((employee) => {
      const onboarding = onboardingByEmployee.get(employee.id);
      const exam = onboarding && onboarding.attemptCount > 0 ? onboarding.trustScore : null;
      const clientRating = clientByEmployee.get(employee.id) ?? null;
      const staff = staffByEmployee.get(employee.id) || [];
      const internalSources = [exam, clientRating, ...staff].filter((value): value is number => value !== null);
      return Object.assign(employee, {
        trustScore: internalSources.length ? Number((internalSources.reduce((a, b) => a + b, 0) / internalSources.length).toFixed(2)) : null,
        clientRating: clientRating === null ? null : Number(clientRating.toFixed(2)),
      });
    });
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

    await this.dataSource.transaction(async (manager) => {
      // 1. Actualizar campos del perfil principal
      if (Object.keys(camposAActualizar).length > 0) {
        const updateData: any = { ...camposAActualizar };
        if (camposAActualizar.precioBaseHora !== undefined) {
          updateData.precioBaseHora =
            camposAActualizar.precioBaseHora.toString();
        }
        await manager.update(Empleadas, id, updateData);
      }

      // 2. Actualizar fotos extras si se especifican
      if (fotosExtra !== undefined) {
        // Borrar fotos anteriores
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
              precio: ext.precio.toString(),
              activo: true,
            });
          } else {
            const nuevoExtra = manager.create(ExtrasCatalogo, {
              empleadaId: id,
              nombre: ext.nombre,
              precio: ext.precio.toString(),
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
    // Eliminar el usuario, lo cual cascada y borra el perfil y fotos
    await this.usuariosRepository.delete(empleada.usuarioId);
    return { deleted: true };
  }
}
