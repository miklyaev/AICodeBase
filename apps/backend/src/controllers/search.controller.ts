import { Controller, Get, Query, Headers } from '@nestjs/common';
import { SearchQueryDto } from '../dto/search.dto';
import { SearchService } from '../services/search.service';

@Controller('/api/search')
export class SearchController {
	constructor(private readonly searchService: SearchService) { }

	@Get()
	search(
		@Query() query: SearchQueryDto,
		@Headers('x-openrouter-key') apiKey?: string
	) {
		const filters = {
			language: query.language,
			fileExtension: query.fileExtension,
			directory: query.directory,
		};
		const hasFilters = filters.language || filters.fileExtension || filters.directory;
		return this.searchService.search(query.projectId, query.query, query.topK ?? 8, apiKey, hasFilters ? filters : undefined);
	}
}
