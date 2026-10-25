import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApplication } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApplication(app);
  const { port, host } = app.get(AppConfig).environment;
  app.enableShutdownHooks();
  await app.listen(port, host);
}
void bootstrap();
