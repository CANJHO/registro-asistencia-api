import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ✅ CORS controlado (evita el bloqueo en el login)
  const allowlist = [
    process.env.FRONTEND_URL,        // Render frontend
    'http://localhost:4200',         // Local Angular
    'http://127.0.0.1:4200',
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: (origin, callback) => {
      // Permite llamadas sin origin (Postman, curl)
      if (!origin) return callback(null, true);

      if (allowlist.includes(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });

  // ✅ Archivos estáticos
  app.useStaticAssets(join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'), {
    prefix: '/files/',
  });

  // ✅ Render usa PORT (no API_PORT)
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`API running on port ${port}`);
}

bootstrap();