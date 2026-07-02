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
        precioBaseHora: precioBaseHora.toString(),
        disponible: disponible ?? false,
        catalogoActivo: catalogoActivo ?? true,
        ubicacionLat: ubicacionLat || null,
        ubicacionLng: ubicacionLng || null,
        tipo,
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

      empleadaGuardada.usuario = usuarioGuardado;
      empleadaGuardada.empleadaFotos = fotosGuardadas;
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
      relations: { usuario: true, empleadaFotos: true },
    });
  }

  async findOne(id: string): Promise<Empleadas> {
    const empleada = await this.empleadasRepository.findOne({
      where: { id },
      relations: { usuario: true, empleadaFotos: true },
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

    // Ejecutar transacción si hay fotos extras a actualizar
    const { fotosExtra, ...camposAActualizar } = updateEmployeeDto;

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
