import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './telegram/telegram.module';
import { UsersModule } from './users/users.module';
import { AiModule } from './ai/ai.module';
import { DriversModule } from './drivers/drivers.module';
import { ClientsModule } from './clients/clients.module';
import { EmployeesModule } from './employees/employees.module';
import { ServicesModule } from './services/services.module';
import { ServiceExtensionsModule } from './service-extensions/service-extensions.module';
import { CatalogExtrasModule } from './catalog-extras/catalog-extras.module';
import { ServiceExtrasModule } from './service-extras/service-extras.module';
import { ExtensionsModule } from './extensions/extensions.module';
import { TripsModule } from './trips/trips.module';
import { ClientAlertsModule } from './client-alerts/client-alerts.module';
import { TelegramConversationsModule } from './telegram-conversations/telegram-conversations.module';
import { EmployeePhotosModule } from './employee-photos/employee-photos.module';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ApartmentsModule } from './apartments/apartments.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { UploadModule } from './upload/upload.module';
import { EmployeeReportsModule } from './employee-reports/employee-reports.module';
import { LiquidationsModule } from './liquidations/liquidations.module';
import { TransportOperationsModule } from './transport-operations/transport-operations.module';

@Module({
  imports: [
    AiModule,
    UploadModule,
    AuthModule,
    RealtimeModule,
    LoyaltyModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_HOST: Joi.string().required(),
        DATABASE_PORT: Joi.number().default(5432),
        DATABASE_USER: Joi.string().required(),
        DATABASE_PASSWORD: Joi.string().required(),
        DATABASE_NAME: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        TELEGRAM_BOT_TOKEN: Joi.string().required(),
        PORT: Joi.number().default(4000),
        MAX_DAILY_AI_CALLS: Joi.number().default(15),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT'),
        username: configService.get<string>('DATABASE_USER'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
        autoLoadEntities: true,
        entities: [
          __dirname + '/**/*.entity.js',
          __dirname + '/**/*.entity.ts',
        ],
        synchronize: false, // Regla Heavy DB: no sincronización automática en producción/desarrollo estructurado, usar migraciones.
        migrationsRun: true,
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    TelegramModule,
    UsersModule,
    DriversModule,
    ClientsModule,
    EmployeesModule,
    ServicesModule,
    ServiceExtensionsModule,
    CatalogExtrasModule,
    ServiceExtrasModule,
    ExtensionsModule,
    TripsModule,
    ClientAlertsModule,
    TelegramConversationsModule,
    EmployeePhotosModule,
    ApartmentsModule,
    EmployeeReportsModule,
    LiquidationsModule,
    TransportOperationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
