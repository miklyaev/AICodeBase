import { Controller, Get, Query } from '@nestjs/common';
import { SearchQueryDto } from '../dto/search.dto';
import { SearchService } from '../services/search.service';

@Controller('/api/search')
export class SearchController {
	constructor(private readonly searchService: SearchService) { }

	@Get()
	search(@Query() query: SearchQueryDto) {
		return this.searchService.search(query.projectId, query.query, query.topK ?? 8);
	}
}
