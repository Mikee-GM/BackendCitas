import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { Servicios } from './entities/service.entity';
import { Viajes } from '../trips/entities/trip.entity';
import { Choferes } from '../drivers/entities/driver.entity';
import { Usuarios } from '../users/entities/user.entity';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Servicios, Viajes, Choferes, Usuarios]),
    forwardRef(() => TelegramModule),
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
