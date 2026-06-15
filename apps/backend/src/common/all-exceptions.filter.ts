import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost) {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<Response>();
		const request = ctx.getRequest<Request & { requestId?: string }>();

		const requestId = request.requestId ?? 'unknown';

		if (exception instanceof HttpException) {
			const status = exception.getStatus();
			const exceptionResponse = exception.getResponse() as any;
			const code = exceptionResponse?.code ?? 'HTTP_EXCEPTION';
			const message = exceptionResponse?.message ?? exception.message;
			const details = exceptionResponse?.details;
			response.status(status).json({ code, message, details, requestId });
			return;
		}

		response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
			code: 'INTERNAL_ERROR',
			message: 'Внутренняя ошибка сервера',
			requestId,
		});
	}
}
