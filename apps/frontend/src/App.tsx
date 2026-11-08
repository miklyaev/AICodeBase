import { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { editor as MonacoEditor } from 'monaco-editor';
import { api, getApiUrl } from './api';
import { ApiSettingsDialog } from './ApiSettingsDialog';
import { ChatResponse, CodeReference, ProjectInfo, ProjectStatus, SearchFilters } from './types';
import { initialReferenceState, latestChatReferences, referenceReducer, sameReference, snippetLineNumber } from './code-references';

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	response?: ChatResponse;
}

const KNOWN_LANGUAGES = [
	'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'yaml', 'yml', 'md', 'py',
	'java', 'kt', 'go', 'rs', 'php', 'rb', 'cs', 'cpp', 'c', 'h', 'hpp', 'css',
	'scss', 'html', 'vue', 'svelte', 'sql',
];

const toMonacoLanguage = (lang?: string) => {
	switch ((lang ?? '').toLowerCase()) {
		case 'ts':
		case 'tsx':
			return 'typescript';
		case 'js':
		case 'jsx':
			return 'javascript';
		case 'py':
			return 'python';
		case 'rs':
			return 'rust';
		case 'go':
			return 'go';
		case 'cs':
			return 'csharp';
		case 'cpp':
		case 'c':
		case 'h':
		case 'hpp':
			return 'cpp';
		case 'md':
			return 'markdown';
		case 'yaml':
		case 'yml':
			return 'yaml';
		default:
			return 'plaintext';
	}
};

function getInitialTheme(): 'light' | 'dark' {
	const stored = localStorage.getItem('theme');
	if (stored === 'dark' || stored === 'light') return stored;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
	const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
	const [hasKey, setHasKey] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsLoading, setSettingsLoading] = useState(true);
	const [settingsError, setSettingsError] = useState(false);
	const [projectPath, setProjectPath] = useState(''); const [project, setProject] = useState<ProjectInfo | null>(null);
	const [status, setStatus] = useState<ProjectStatus | null>(null);
	const [chatInput, setChatInput] = useState('');
	const [chat, setChat] = useState<ChatMessage[]>([]);
	const [conversationId, setConversationId] = useState<string | undefined>();
	const [searchQuery, setSearchQuery] = useState('');
	const [searchFilters, setSearchFilters] = useState({ language: '', fileExtension: '', directory: '' });
	const [searchResults, setSearchResults] = useState<CodeReference[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [{ references: activeReferences, activeReference, snippet, loading: snippetLoading }, dispatchReferences] =
		useReducer(referenceReducer, initialReferenceState);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [editorReady, setEditorReady] = useState(false);

	const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<typeof Monaco | null>(null);
	const decorationIdsRef = useRef<string[]>([]);
	const indexesGeneration = useRef(0);
	const statusRequest = useRef(0);
	const projectSelectionRequest = useRef(0);
	const snippetRequest = useRef(0);
	const resultsRequest = useRef(0);
	const selectedProjectId = useRef(project?.id);
	selectedProjectId.current = project?.id;

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
		localStorage.setItem('theme', theme);
	}, [theme]);

	const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

	useEffect(() => {
		void refreshSettingsStatus();
	}, []);

	useEffect(() => {
		if (!project?.id) return;

		const source = new EventSource(getApiUrl(`/api/projects/events?projectId=${encodeURIComponent(project.id)}`));
		source.onmessage = () => {
			void refreshStatus(project.id);
		};
		source.onerror = () => source.close();

		const timer = window.setInterval(() => {
			void refreshStatus(project.id);
		}, 1500);

		void refreshStatus(project.id);

		return () => {
			source.close();
			window.clearInterval(timer);
		};
	}, [project?.id]);

	useEffect(() => {
		if (!editorRef.current || !monacoRef.current) return;
		if (!snippet || !activeReference) {
			decorationIdsRef.current = editorRef.current.deltaDecorations(decorationIdsRef.current, []);
			return;
		}

		const start = Math.max(1, activeReference.startLine - snippet.startLine + 1);
		const end = Math.max(start, activeReference.endLine - snippet.startLine + 1);

		decorationIdsRef.current = editorRef.current.deltaDecorations(decorationIdsRef.current, [
			{
				range: new monacoRef.current.Range(start, 1, end, 1),
				options: {
					isWholeLine: true,
					className: 'monaco-highlight-range',
					linesDecorationsClassName: 'monaco-highlight-gutter',
				},
			},
		]);

		editorRef.current.revealLineInCenter(start);
	}, [snippet, activeReference, editorReady]);

	async function refreshSettingsStatus() {
		setSettingsLoading(true);
		setSettingsError(false);
		try {
			const result = await api.getSettingsStatus();
			setHasKey(result.hasApiKey);
		} catch {
			setHasKey(false);
			setSettingsError(true);
		} finally {
			setSettingsLoading(false);
		}
	}

	async function refreshStatus(projectId: string) {
		const request = ++statusRequest.current;
		const next = await api.getProjectStatus(projectId);
		if (statusRequest.current === request && selectedProjectId.current === projectId) setStatus(next);
	}

	function onIndexesReset() {
		indexesGeneration.current += 1;
		statusRequest.current += 1;
		resultsRequest.current += 1;
		dispatchReferences({ type: 'select', references: [], reference: null, request: ++snippetRequest.current });
		setSearchResults(null);
		setSearching(false);
		setBusy(false);
		setError(null);
		// Keep the conversation and its text, but never expose stale code references.
		setChat((previous) => previous.map((message) => message.response
			? { ...message, response: { ...message.response, references: [] } }
			: message));
		setProject((previous) => previous ? { ...previous, status: 'idle', filesCount: 0, chunksCount: 0 } : null);
		const projectId = selectedProjectId.current;
		setStatus(projectId ? {
			projectId, status: 'idle', filesCount: 0, chunksCount: 0, indexedFiles: 0, totalFiles: 0,
			message: 'Индексы сброшены. Запустите полную переиндексацию.',
		} : null);
		if (projectId) void refreshStatus(projectId).catch(() => {
			setError('Индексы сброшены, но не удалось обновить статус проекта. Повторите проверку.');
		});
	}

	async function pickProjectFolder() {
		setError(null);
		try {
			const result = await api.pickProjectFolder();
			if (result.path) {
				setProjectPath(result.path);
			}
		} catch (e) {
			setError((e as Error).message);
		}
	}

	async function selectProject() {
		const request = ++projectSelectionRequest.current;
		setError(null);
		try {
			const selected = await api.selectProject(projectPath);
			if (projectSelectionRequest.current !== request) return;
			if (selected.id !== selectedProjectId.current) {
				indexesGeneration.current += 1;
				resultsRequest.current += 1;
				dispatchReferences({ type: 'select', references: [], reference: null, request: ++snippetRequest.current });
				setSearchResults(null);
				setChat([]);
				setConversationId(undefined);
				setSearching(false);
				setBusy(false);
				setStatus(null);
			}
			selectedProjectId.current = selected.id;
			setProject(selected);
			await refreshStatus(selected.id);
		} catch (e) {
			if (projectSelectionRequest.current === request) setError((e as Error).message);
		}
	}

	async function startIndexing() {
		if (!project || !hasKey) return;
		setError(null);
		try {
			await api.startIndexing(project.id);
			await refreshStatus(project.id);
		} catch (e) {
			setError((e as Error).message);
		}
	}

	async function clearIndex() {
		if (!project) return;
		setError(null);
		try {
			await api.clearIndex(project.id);
			if (selectedProjectId.current === project.id) onIndexesReset();
			await refreshStatus(project.id);
		} catch (e) {
			setError((e as Error).message);
		}
	}

	function emptyFilters(filters: typeof searchFilters) {
		return !filters.language && !filters.fileExtension && !filters.directory;
	}

	function buildSearchFilters(): SearchFilters | undefined {
		const filters: SearchFilters = {};
		if (searchFilters.language) filters.language = searchFilters.language;
		if (searchFilters.fileExtension) {
			const ext = searchFilters.fileExtension.trim().replace(/^\./, '');
			if (ext) filters.fileExtension = ext;
		}
		if (searchFilters.directory) filters.directory = searchFilters.directory.trim().replace(/^\/+|\/+$/g, '');
		return emptyFilters(searchFilters) ? undefined : filters;
	}

	async function runSearch(e?: FormEvent) {
		e?.preventDefault();
		if (!project || !hasKey || searching || !searchQuery.trim()) return;

		const requestGeneration = indexesGeneration.current;
		const request = ++resultsRequest.current;
		setSearching(true);
		setError(null);
		try {
			const filters = buildSearchFilters();
			const results = await api.search(project.id, searchQuery.trim(), filters);
			if (indexesGeneration.current !== requestGeneration || resultsRequest.current !== request) return;
			setSearchResults(results);
			await openReference(results[0] ?? null, results);
		} catch (err) {
			if (indexesGeneration.current === requestGeneration && resultsRequest.current === request) setError((err as Error).message);
		} finally {
			if (indexesGeneration.current === requestGeneration) setSearching(false);
		}
	}

	function resetSearch() {
		resultsRequest.current += 1;
		setSearchResults(null);
		setSearchQuery('');
		setSearchFilters({ language: '', fileExtension: '', directory: '' });
		const references = latestChatReferences(chat);
		void openReference(references[0] ?? null, references);
	}

	async function sendMessage(e: FormEvent) {
		e.preventDefault();
		if (!project || !hasKey || !chatReady || busy || !chatInput.trim()) return;

		const requestGeneration = indexesGeneration.current;
		const request = ++resultsRequest.current;
		setBusy(true);
		setError(null);
		const message = chatInput.trim();
		setChatInput('');

		setChat((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: message }]);

		try {
			const response = await api.chatMessage(project.id, message, conversationId);
			if (indexesGeneration.current !== requestGeneration) return;
			setConversationId(response.conversationId);
			setChat((prev) => [
				...prev,
				{ id: crypto.randomUUID(), role: 'assistant', content: response.answer, response },
			]);

			if (resultsRequest.current === request) {
				setSearchResults(null);
				await openReference(response.references[0] ?? null, response.references);
			}
		} catch (err) {
			if (indexesGeneration.current === requestGeneration) setError((err as Error).message);
		} finally {
			if (indexesGeneration.current === requestGeneration) setBusy(false);
		}
	}

	async function openReference(reference: CodeReference | null, references = activeReferences) {
		if (!project) return;
		const request = ++snippetRequest.current;
		setError(null);
		dispatchReferences({ type: 'select', references, reference, request });
		if (!reference) return;
		try {
			const content = await api.snippet(project.id, reference.filePath, reference.startLine, reference.endLine);
			dispatchReferences({ type: 'loaded', snippet: content, request });
		} catch (err) {
			if (snippetRequest.current !== request) return;
			dispatchReferences({ type: 'failed', request });
			setError((err as Error).message);
		}
	}

	const progress = status?.totalFiles ? Math.round((status.indexedFiles / status.totalFiles) * 100) : 0;
	const chatReady = (status?.status ?? project?.status) === 'ready';

	return (
		<div className="app-root">
			<aside className="left-panel">
				<header className="card">
					<h1>AI Codebase RAG Agent</h1>
					<p className="muted">Помогает исследовать исходный код проектов</p>
					<nav className="row" aria-label="Настройки приложения">
						<button type="button" className="ghost" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
							Настройка API
						</button>
						<button type="button" className="theme-toggle" onClick={toggleTheme}
							title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
							aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}>
							{theme === 'light' ? '\u263E' : '\u2600'}
						</button>
					</nav>
					{settingsLoading ? <p className="muted" role="status">Проверка настройки API...</p> : settingsError ? (
						<div className="error" role="alert">
							Не удалось проверить настройку API.
							<button type="button" className="ghost" onClick={() => void refreshSettingsStatus()}>Повторить</button>
						</div>
					) : !hasKey ? <p className="warn" role="status">API не настроен. Обратитесь к администратору</p> : null}
				</header>

				<section className="card">
					<h2>Проект</h2>
					<label>
						Путь к папке проекта (выбрать через диалог для Windows)
						<input value={projectPath} onChange={(e) => setProjectPath(e.target.value)} placeholder="D:\\Projects\\my-app" />
					</label>					<div className="row">
						<button type="button" className="ghost" onClick={pickProjectFolder}>
							Выбрать через диалог
						</button>
						<button onClick={selectProject} disabled={!projectPath.trim()}>
							Выбрать папку проекта
						</button>
						<button onClick={startIndexing} disabled={!project || !hasKey}>
							Индексировать
						</button>						<button className="ghost" onClick={clearIndex} disabled={!project}>
							Очистить индекс
						</button>
					</div>
					{project && (
						<div className="meta">
							<div>{project.name}</div>
							<div className="muted">{project.path}</div>
							<div className="muted">
								Статус: {status?.status ?? project.status} · Файлов: {status?.filesCount ?? project.filesCount} · Чанков:{' '}
								{status?.chunksCount ?? project.chunksCount}
							</div>
						</div>
					)}
					<div className="progress-wrap" aria-label="Прогресс индексации">
						<div className="progress" style={{ width: `${progress}%` }} />
					</div>
					<div className="muted small">{status?.message ?? 'Ожидание индексации'}</div>
				</section>

				<section className="card">
					<h2>Поиск по коду</h2>
					<form onSubmit={runSearch}>
						<label>
							Запрос
							<input
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Например: обработка ошибок"
							/>
						</label>
						<label>
							Язык
							<select
								value={searchFilters.language}
								onChange={(e) => setSearchFilters((f) => ({ ...f, language: e.target.value }))}
							>
								<option value="">Все языки</option>
								{KNOWN_LANGUAGES.map((lang) => (
									<option key={lang} value={lang}>{lang}</option>
								))}
							</select>
						</label>
						<div className="row" style={{ gap: '8px' }}>
							<label style={{ flex: 1 }}>
								Расширение
								<input
									value={searchFilters.fileExtension}
									onChange={(e) => setSearchFilters((f) => ({ ...f, fileExtension: e.target.value }))}
									placeholder=".ts"
								/>
							</label>
							<label style={{ flex: 1 }}>
								Директория
								<input
									value={searchFilters.directory}
									onChange={(e) => setSearchFilters((f) => ({ ...f, directory: e.target.value }))}
									placeholder="src/components"
								/>
							</label>
						</div>
						<div className="row">
							<button type="submit" disabled={!project || !hasKey || searching || !searchQuery.trim()}>
								{searching ? 'Поиск...' : 'Найти'}
							</button>
							<button type="button" className="ghost" onClick={resetSearch} disabled={!searchResults}>
								Сбросить
							</button>
						</div>
					</form>
				</section>

				<section className="card chat-card">
					<h2>Чат</h2>
					<div className="chat-list">
						{chat.map((item) => (
							<div key={item.id} className={`msg ${item.role}`}>
								<div>{item.content}</div>
								{item.response?.references?.length ? (
									<div className="refs-inline">
										{item.response.references.map((ref, idx) => (
											<button key={`${ref.filePath}-${idx}`} className="link-btn" onClick={() => {
												resultsRequest.current += 1;
												setSearchResults(null);
												void openReference(ref, item.response!.references);
											}}>
												{ref.filePath}:{ref.startLine}-{ref.endLine}
											</button>
										))}
									</div>
								) : null}
							</div>
						))}
					</div>

					<form className="chat-form" onSubmit={sendMessage}>
						<input
							value={chatInput}
							onChange={(e) => setChatInput(e.target.value)}
							placeholder="Например: Где реализована авторизация пользователя?"
							disabled={!project || !hasKey || !chatReady || busy}
						/>
						<button
							type="submit"
							disabled={!project || !hasKey || !chatReady || busy || !chatInput.trim()}
							style={{
								padding: '4px 12px',
								minWidth: 'auto',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}}
							title="Отправить"
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<line x1="22" y1="2" x2="11" y2="13"></line>
								<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
							</svg>
						</button>
					</form>				</section>

				{error ? <div className="error">{error}</div> : null}
			</aside>

			<main className="right-panel">
				<div className="card result-head">
					<h2>Найденные места в коде</h2>
					{activeReference ? (
						<div className="muted">
							{activeReference.filePath} · строки {activeReference.startLine}-{activeReference.endLine}
						</div>
					) : (
						<div className="muted">
							{searchResults ? 'Ничего не найдено. Измените запрос или фильтры.' : 'Выберите проект и задайте вопрос о коде'}
						</div>
					)}
				</div>

				<div className="card refs-list">
					{activeReferences.length ? (
						activeReferences.map((ref, idx) => (
							<button
								className={`ref-item ${sameReference(activeReference, ref) ? 'active' : ''}`}
								key={`${ref.filePath}-${ref.startLine}-${idx}`}
								onClick={() => {
									resultsRequest.current += 1;
									void openReference(ref);
								}}
							>
								<div className="ref-title">
									{ref.filePath}:{ref.startLine}-{ref.endLine}
								</div>
								<div className="muted">{ref.reason}</div>
								<div className="muted small">релевантность: {ref.relevance}</div>
							</button>
						))
					) : (
						<div className="muted">
							{searchResults ? 'По заданным фильтрам ничего не найдено.' : 'Пока нет результатов поиска.'}
						</div>
					)}
				</div>

				<div className="card code-view">
					<Editor
						height="100%"
						language={toMonacoLanguage(activeReference?.language)}
						value={snippet?.content ?? (snippetLoading ? '// Загрузка фрагмента…' : '// Здесь будет отображаться кодовый фрагмент')}
						onMount={(editor, monaco) => {
							editorRef.current = editor;
							monacoRef.current = monaco;
							setEditorReady(true);
						}}
						options={{
							readOnly: true,
							minimap: { enabled: false },
							scrollBeyondLastLine: false,
							fontSize: 12,
							lineNumbers: (line) => snippetLineNumber(line, snippet),
							wordWrap: 'off',
							padding: { top: 10, bottom: 10 },
						}}
						theme={theme === 'dark' ? 'vs-dark' : 'vs'}
					/>
				</div>
			</main>
			{settingsOpen && <ApiSettingsDialog onIndexesReset={onIndexesReset} onClose={() => setSettingsOpen(false)} onSaved={() => {
				setHasKey(true);
				setSettingsError(false);
			}} />}
		</div>
	);
}
