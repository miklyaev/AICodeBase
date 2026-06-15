import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';

export interface RequestWithId extends Request {
	requestId: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
	use(req: RequestWithId, res: Response, next: NextFunction) {
		const requestId = crypto.randomUUID();
		req.requestId = requestId;
		res.setHeader('x-request-id', requestId);
		next();
	}
}
