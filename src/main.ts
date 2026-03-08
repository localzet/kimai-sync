import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    const logger = new Logger('Bootstrap');

    const port = configService.get<number>('app.port', 3000);
    const env = configService.get<string>('app.nodeEnv', 'development');

    await app.listen(port);

    logger.log(`
╔═══════════════════════════════════════════════════╗
║          🎉 Kimai Sync Service Started            ║
╠═══════════════════════════════════════════════════╣
║ Environment: ${env.padEnd(37)}║
║ Port: ${port.toString().padEnd(44)}║
║ API: http://localhost:${port}                       ${' '.repeat(5 - port.toString().length)}║
║ Health: http://localhost:${port}/health             ${' '.repeat(5 - port.toString().length)}║
║ Sync: http://localhost:${port}/sync/full            ${' '.repeat(5 - port.toString().length)}║
╚═══════════════════════════════════════════════════╝
  `);
}

bootstrap().catch((error) => {
    const logger = new Logger('Bootstrap');
    logger.error('Failed to bootstrap application', error);
    process.exit(1);
});
