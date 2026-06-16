import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

const allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
	app.use(new RequestIdMiddleware().use);
	app.useGlobalFilters(new AllExceptionsFilter());
	app.enableCors({
		origin: allowedOrigins,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: [
			'Content-Type',
			'Authorization',
			'X-Requested-With',
			'Accept',
		],
		credentials: true,
		optionsSuccessStatus: 204,
	});
	await app.listen(3001, '0.0.0.0');
}

bootstrap();
