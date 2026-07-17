import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { session } from 'telegraf';
import { Repository } from 'typeorm';
import { TelegramService } from './telegram.service';
import { TelegramAuthUpdate } from './telegram-auth.update';
import { TelegramBookingUpdate } from './telegram-booking.update';
import { TelegramDriverUpdate } from './telegram-driver.update';
import { TelegramAdminUpdate } from './telegram-admin.update';
import { TelegramBookingService } from './telegram-booking.service';
import { Usuarios } from '../users/entities/user.entity';
import { Clientes } from '../clients/entities/client.entity';
import { Empleadas } from '../employees/entities/employee.entity';
import { Servicios } from '../services/entities/service.entity';
import { AuthModule } from '../auth/auth.module';
import { ServicesModule } from '../services/services.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { TelegramSession } from './entities/telegram-session.entity';

import { ExtrasCatalogo } from '../catalog-extras/entities/catalog-extra.entity';
import { ExtrasServicio } from '../service-extras/entities/service-extra.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Usuarios,
      Clientes,
      Empleadas,
      Servicios,
      ExtrasCatalogo,
      ExtrasServicio,
      TelegramSession,
    ]),
    AuthModule,
    LoyaltyModule,
    forwardRef(() => ServicesModule),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule, TypeOrmModule.forFeature([TelegramSession])],
      useFactory: (
        configService: ConfigService,
        sessionRepository: Repository<TelegramSession>,
      ) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
          throw new Error(
            'TELEGRAM_BOT_TOKEN is not defined in environment variables',
          );
        }
        return {
          token,
          middlewares: [
            session({
              store: {
                get: async (key) => {
                  const sess = await sessionRepository.findOne({
                    where: { key },
                  });
                  return sess ? sess.data : undefined;
                },
                set: async (key, data) => {
                  await sessionRepository.save({ key, data });
                },
                delete: async (key) => {
                  await sessionRepository.delete(key);
                },
              },
            }),
          ],
        };
      },
      inject: [ConfigService, getRepositoryToken(TelegramSession)],
    }),
  ],
  providers: [
    TelegramService,
    TelegramAuthUpdate,
    TelegramBookingUpdate,
    TelegramDriverUpdate,
    TelegramAdminUpdate,
    TelegramBookingService,
  ],
  exports: [TelegramService, TelegrafModule, TelegramBookingService],
})
export class TelegramModule {}
