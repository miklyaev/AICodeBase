import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { editor as MonacoEditor } from 'monaco-editor';
import { api, getApiUrl } from './api';
import { ChatResponse, CodeReference, ProjectInfo, ProjectStatus, SearchFilters } from './types';

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
	const [sessionKey, setSessionKey] = useState('');
	const [showKey, setShowKey] = useState(false);
	const [projectPath, setProjectPath] = useState(''); const [project, setProject] = useState<ProjectInfo | null>(null);
	const [status, setStatus] = useState<ProjectStatus | null>(null);
	const [chatInput, setChatInput] = useState('');
	const [chat, setChat] = useState<ChatMessage[]>([]);
	const [conversationId, setConversationId] = useState<string | undefined>();
	const [searchQuery, setSearchQuery] = useState('');
	const [searchFilters, setSearchFilters] = useState({ language: '', fileExtension: '', directory: '' });
	const [searchResults, setSearchResults] = useState<CodeReference[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [activeReference, setActiveReference] = useState<CodeReference | null>(null);
	const [snippet, setSnippet] = useState<{ content: string; startLine: number; endLine: number } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<typeof Monaco | null>(null);
	const decorationIdsRef = useRef<string[]>([]);

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
		localStorage.setItem('theme', theme);
	}, [theme]);

	const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

	useEffect(() => {
		void api.getSettingsStatus().then((s) => setHasKey(s.hasOpenRouterKey));
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
	}, [snippet, activeReference]);

	const activeReferences = useMemo(() => {
		if (searchResults) return searchResults;
		for (let i = chat.length - 1; i >= 0; i -= 1) {
			const response = chat[i].response;
			if (response?.references?.length) return response.references;
		}
		return [];
	}, [chat, searchResults]);

	async function refreshStatus(projectId: string) {
		const next = await api.getProjectStatus(projectId);
		setStatus(next);
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
		setError(null);
		try {
			const selected = await api.selectProject(projectPath);
			setProject(selected);
			await refreshStatus(selected.id);
		} catch (e) {
			setError((e as Error).message);
		}
	}

	async function startIndexing() {
		if (!project) return;
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
		if (!project || !searchQuery.trim()) return;

		setSearching(true);
		setError(null);
		try {
			const filters = buildSearchFilters();
			const results = await api.search(project.id, searchQuery.trim(), filters);
			setSearchResults(results);

			if (results[0]) {
				await openReference(results[0]);
			} else {
				setActiveReference(null);
				setSnippet(null);
			}
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setSearching(false);
		}
	}

	function resetSearch() {
		setSearchResults(null);
		setSearchQuery('');
		setSearchFilters({ language: '', fileExtension: '', directory: '' });
	}

	async function sendMessage(e: FormEvent) {
		e.preventDefault();
		if (!project || !chatInput.trim()) return;

		setBusy(true);
		setError(null);
		const message = chatInput.trim();
		setChatInput('');

		setChat((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: message }]);

		try {
			const response = await api.chatMessage(project.id, message, conversationId);
			setConversationId(response.conversationId);
			setChat((prev) => [
				...prev,
				{ id: crypto.randomUUID(), role: 'assistant', content: response.answer, response },
			]);

			if (response.references[0]) {
				await openReference(response.references[0]);
			}
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function openReference(reference: CodeReference) {
		if (!project) return;
		setActiveReference(reference);
		const content = await api.snippet(project.id, reference.filePath, reference.startLine, reference.endLine);
		setSnippet({ content: content.content, startLine: content.startLine, endLine: content.endLine });
	}

	const progress = status?.totalFiles ? Math.round((status.indexedFiles / status.totalFiles) * 100) : 0;

	const handleSessionKeyChange = (val: string) => {
		setSessionKey(val);
		api.setOpenRouterKey(val);
	};

	return (
		<div className="app-root">
			<aside className="left-panel">
				<header className="card">
					<h1>AI Codebase RAG Agent</h1>
					<p className="muted">Помогает исследовать исходный код проектов</p>
				</header>
				<section className="card">
					<div className="row" style={{ justifyContent: 'space-between', marginBottom: '10px' }}>
						<h2 style={{ margin: 0 }}>Настройки API</h2>
						<button className="theme-toggle" onClick={toggleTheme} title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}>
							{theme === 'light' ? '\u263E' : '\u2600'}
						</button>
					</div>
					<div className="row" style={{ alignItems: 'flex-end' }}>
						<label style={{ flex: 1 }}>
							OpenRouter API Key (Session)
							<div style={{ position: 'relative', width: '100%' }}>
								<input
									type={showKey ? 'text' : 'password'}
									value={sessionKey}
									onChange={(e) => handleSessionKeyChange(e.target.value)}
									placeholder="sk-or-v1-..."
									style={{ paddingRight: '60px', width: '100%', boxSizing: 'border-box' }}
								/>
								<button
									type="button"
									className="ghost"
									onClick={() => setShowKey(!showKey)}
									style={{
										position: 'absolute',
										right: '5px',
										top: '50%',
										transform: 'translateY(-50%)',
										padding: '4px 8px',
										fontSize: '12px',
										height: 'auto',
										margin: 0
									}}
								>
									{showKey ? 'Hide' : 'Show'}
								</button>
							</div>
						</label>					</div>
					{!hasKey && !sessionKey && (
						<p className="error small">Ключ не установлен. Введите ключ для работы.</p>
					)}
				</section>

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
						<button onClick={startIndexing} disabled={!project || (!hasKey && !sessionKey)}>
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
							<button type="submit" disabled={!project || (!hasKey && !sessionKey) || searching || !searchQuery.trim()}>
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
										{item.response.references.slice(0, 3).map((ref, idx) => (
											<button key={`${ref.filePath}-${idx}`} className="link-btn" onClick={() => void openReference(ref)}>
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
							disabled={!project || (!hasKey && !sessionKey) || busy}
						/>
						<button
							type="submit"
							disabled={!project || (!hasKey && !sessionKey) || busy || !chatInput.trim()}
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
								className={`ref-item ${activeReference?.filePath === ref.filePath && activeReference?.startLine === ref.startLine ? 'active' : ''}`}
								key={`${ref.filePath}-${ref.startLine}-${idx}`}
								onClick={() => void openReference(ref)}
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
						value={snippet?.content ?? '// Здесь будет отображаться кодовый фрагмент'}
						onMount={(editor, monaco) => {
							editorRef.current = editor;
							monacoRef.current = monaco;
						}}
						options={{
							readOnly: true,
							minimap: { enabled: false },
							scrollBeyondLastLine: false,
							fontSize: 12,
							lineNumbers: 'on',
							wordWrap: 'off',
							padding: { top: 10, bottom: 10 },
						}}
						theme={theme === 'dark' ? 'vs-dark' : 'vs'}
					/>
				</div>
			</main>
		</div>
	);
}
