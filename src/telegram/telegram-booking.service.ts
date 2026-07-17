import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { ExtrasServicio } from '../service-extras/entities/service-extra.entity';
import { ServicesService } from '../services/services.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AiProviderService } from '../ai/ai-provider.service';

@Injectable()
export class TelegramBookingService {
  private readonly logger = new Logger(TelegramBookingService.name);

  constructor(
    @InjectRepository(Usuarios)
    readonly usuariosRepository: Repository<Usuarios>,
    @InjectRepository(Clientes)
    readonly clientesRepository: Repository<Clientes>,
    @InjectRepository(Empleadas)
    readonly empleadasRepository: Repository<Empleadas>,
    @InjectRepository(Servicios)
    readonly serviciosRepository: Repository<Servicios>,
    @InjectRepository(ExtrasCatalogo)
    readonly extrasCatalogoRepository: Repository<ExtrasCatalogo>,
    @InjectRepository(ExtrasServicio)
    readonly extrasServicioRepository: Repository<ExtrasServicio>,
    @Inject(forwardRef(() => ServicesService))
    readonly servicesService: ServicesService,
    readonly loyaltyService: LoyaltyService,
    private readonly aiProviderService: AiProviderService,
  ) {}

  async getGroqResponse(
    systemPrompt: string,
    history: { role: 'user' | 'model'; parts: { text: string }[] }[],
  ): Promise<string> {
    const formattedHistory = history.map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.parts?.[0]?.text || '',
    }));

    return this.aiProviderService.generateChatResponse(
      systemPrompt,
      formattedHistory,
    );
  }
}
