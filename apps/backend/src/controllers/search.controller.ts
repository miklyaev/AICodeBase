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
		return this.searchService.search(query.projectId, query.query, query.topK ?? 8, apiKey);
	}
}
