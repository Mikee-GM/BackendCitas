import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './telegram/telegram.module';
import { UsersModule } from './users/users.module';
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

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    LoyaltyModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      username: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_NAME || 'chamba_pasteles',
      autoLoadEntities: true,
      entities: [__dirname + '/**/*.entity.js', __dirname + '/**/*.entity.ts'],
      synchronize: true, // Regla Heavy DB: no sincronización automática en producción/desarrollo estructurado, usar migraciones.
      migrationsRun: false,
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
    }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
