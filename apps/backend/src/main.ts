import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
	app.use(new RequestIdMiddleware().use);
	app.useGlobalFilters(new AllExceptionsFilter());
	app.enableCors({
		origin: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
		optionsSuccessStatus: 204,
	});
	await app.listen(3001, '127.0.0.1');
}

bootstrap();
