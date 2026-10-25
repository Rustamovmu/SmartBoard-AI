import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const { port, host } = app.get(AppConfig).environment;
  app.enableShutdownHooks();
  await app.listen(port, host);
}
void bootstrap();
