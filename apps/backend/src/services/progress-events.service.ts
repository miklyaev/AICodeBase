import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface ProgressEventPayload {
	event:
	| 'indexing.started'
	| 'indexing.progress'
	| 'indexing.fileSkipped'
	| 'indexing.completed'
	| 'indexing.failed'
	| 'chat.completed'
	| 'chat.failed';
	data: Record<string, unknown>;
}

@Injectable()
export class ProgressEventsService {
	private readonly subjects = new Map<string, Subject<ProgressEventPayload>>();

	stream(projectId: string): Observable<ProgressEventPayload> {
		if (!this.subjects.has(projectId)) {
			this.subjects.set(projectId, new Subject<ProgressEventPayload>());
		}

		return this.subjects.get(projectId)!.asObservable();
	}

	emit(projectId: string, payload: ProgressEventPayload) {
		if (!this.subjects.has(projectId)) {
			this.subjects.set(projectId, new Subject<ProgressEventPayload>());
		}

		this.subjects.get(projectId)!.next(payload);
	}
}
