import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DataSource,
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => {
        // ✅ 1) Si existe DATABASE_URL, úsala (lo más estable en Render)
        const databaseUrl = cfg.get<string>('DATABASE_URL');

        const sslEnabledRaw =
          cfg.get<string>('DB_SSL') || cfg.get<string>('PGSSLMODE'); // ej: "true" o "require"

        const sslEnabled =
          sslEnabledRaw === 'true' ||
          sslEnabledRaw === '1' ||
          sslEnabledRaw === 'require';

        const ds = new DataSource(
          databaseUrl
            ? {
                type: 'postgres',
                url: databaseUrl,
                ssl: sslEnabled ? { rejectUnauthorized: false } : false,
              }
            : {
                type: 'postgres',
                host: cfg.get<string>('DB_HOST'),
                port: parseInt(cfg.get<string>('DB_PORT', '5432'), 10),
                username: cfg.get<string>('DB_USER'),
                password: cfg.get<string>('DB_PASS'),
                database: cfg.get<string>('DB_NAME'),
                ssl: sslEnabled ? { rejectUnauthorized: false } : false,
              },
        );

        if (!ds.isInitialized) {
          await ds.initialize();
        }

        return ds;
      },
    },
  ],
  exports: [DataSource],
})
export class DatabaseModule {}