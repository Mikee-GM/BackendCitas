import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { TypeOrmModule } from '@nestjs/typeorm';
import { session } from 'telegraf';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { AuthModule } from '../auth/auth.module';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuarios, Clientes, Empleadas, Servicios]),
    AuthModule,
    forwardRef(() => ServicesModule),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
          throw new Error(
            'TELEGRAM_BOT_TOKEN is not defined in environment variables',
          );
        }
        return {
          token,
          middlewares: [session()],
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [TelegramService, TelegramUpdate],
  exports: [TelegramService, TelegrafModule],
})
export class TelegramModule {}
