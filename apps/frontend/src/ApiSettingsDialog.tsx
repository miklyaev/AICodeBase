import { FormEvent, useEffect, useRef, useState } from 'react';
import { AdminSession, api, ApiError, IndexesStatus } from './api';

interface Props {
	onClose: () => void;
	onSaved: () => void;
	onIndexesReset: () => void;
}

export function ApiSettingsDialog({ onClose, onSaved, onIndexesReset }: Props) {
	const [login, setLogin] = useState('');
	const [password, setPassword] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [session, setSession] = useState<AdminSession | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [indexes, setIndexes] = useState<IndexesStatus | null>(null);
	const [indexesLoading, setIndexesLoading] = useState(false);
	const [indexesError, setIndexesError] = useState<string | null>(null);
	const [confirmReset, setConfirmReset] = useState(false);
	const [resetting, setResetting] = useState(false);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const loginRef = useRef<HTMLInputElement>(null);
	const keyRef = useRef<HTMLInputElement>(null);
	const active = useRef(false);
	const submitting = useRef(false);
	const generation = useRef(0);

	useEffect(() => {
		active.current = true;
		const previousFocus = document.activeElement;
		const dialog = dialogRef.current;
		dialog?.showModal();
		loginRef.current?.focus();
		return () => {
			active.current = false;
			generation.current += 1;
			dialog?.close();
			if (previousFocus instanceof HTMLElement) previousFocus.focus();
		};
	}, []);

	useEffect(() => {
		setIndexes(null);
		setIndexesError(null);
		setConfirmReset(false);
		setResetting(false);
		setIndexesLoading(false);
		if (!session) {
			loginRef.current?.focus();
			return;
		}
		keyRef.current?.focus();
		void loadIndexes(session);
		const timer = window.setTimeout(() => {
			generation.current += 1;
			submitting.current = false;
			setBusy(false);
			setSession(null);
			setApiKey('');
			setPassword('');
			setNotice(null);
			setError('Сессия администратора истекла. Войдите снова.');
		}, Math.max(0, session.expiresAt - Date.now()));
		return () => {
			window.clearTimeout(timer);
			void api.adminLogout(session.token).catch(() => undefined);
		};
	}, [session]);

	function close() {
		generation.current += 1;
		setSession(null);
		setPassword('');
		setApiKey('');
		onClose();
	}

	async function signIn(event: FormEvent) {
		event.preventDefault();
		if (submitting.current || !login.trim() || !password) return;
		submitting.current = true;
		setBusy(true);
		setError(null);
		setNotice(null);
		const requestGeneration = generation.current;
		try {
			const result = await api.adminLogin(login.trim(), password);
			if (!active.current || generation.current !== requestGeneration) {
				void api.adminLogout(result.token).catch(() => undefined);
				return;
			}
			setPassword('');
			if (!result.token || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) {
				void api.adminLogout(result.token).catch(() => undefined);
				setError('Сессия администратора истекла. Войдите снова.');
				return;
			}
			setSession(result);
		} catch (err) {
			if (!active.current || generation.current !== requestGeneration) return;
			setError(err instanceof ApiError && (err.status === 401 || err.status === 403)
				? 'Неверный логин или пароль администратора.'
				: 'Не удалось войти. Проверьте соединение и повторите попытку.');
		} finally {
			if (active.current && generation.current === requestGeneration) {
				submitting.current = false;
				setBusy(false);
			}
		}
	}

	function signOut() {
		generation.current += 1;
		submitting.current = false;
		setBusy(false);
		setSession(null);
		setPassword('');
		setApiKey('');
		setError(null);
		setNotice('Вы вышли из административной сессии.');
	}

	function sessionError(err: unknown): boolean {
		if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) return false;
		signOut();
		setNotice(null);
		setError('Сессия администратора истекла или доступ отозван. Войдите снова.');
		return true;
	}

	async function loadIndexes(admin: AdminSession) {
		const requestGeneration = generation.current;
		setIndexesLoading(true);
		setIndexesError(null);
		try {
			const result = await api.getIndexesStatus(admin.token);
			if (!active.current || generation.current !== requestGeneration) return;
			setIndexes(result);
		} catch (err) {
			if (!active.current || generation.current !== requestGeneration) return;
			if (!sessionError(err)) setIndexesError('Не удалось загрузить состояние индексов. Повторите попытку.');
		} finally {
			if (active.current && generation.current === requestGeneration) setIndexesLoading(false);
		}
	}

	async function resetIndexes() {
		if (submitting.current || !session || !confirmReset || !indexes || indexesLoading) return;
		if (session.expiresAt <= Date.now()) {
			signOut();
			setNotice(null);
			setError('Сессия администратора истекла. Войдите снова.');
			return;
		}
		submitting.current = true;
		setBusy(true);
		setResetting(true);
		setError(null);
		setNotice(null);
		const requestGeneration = generation.current;
		try {
			await api.resetIndexes(session.token);
			onIndexesReset();
			if (!active.current || generation.current !== requestGeneration) return;
			setConfirmReset(false);
			setNotice('Индексы всех проектов удалены. Запустите полную переиндексацию нужных проектов.');
			await loadIndexes(session);
		} catch (err) {
			if (!active.current || generation.current !== requestGeneration) return;
			if (!sessionError(err)) {
				setError(err instanceof ApiError && err.status === 409
					? 'Идёт индексация. Дождитесь её завершения и повторите сброс.'
					: 'Не удалось сбросить индексы. Проверьте соединение и повторите попытку.');
			}
		} finally {
			if (active.current && generation.current === requestGeneration) {
				submitting.current = false;
				setBusy(false);
				setResetting(false);
			}
		}
	}

	async function save(event: FormEvent) {
		event.preventDefault();
		if (submitting.current || !session || !apiKey.trim()) return;
		if (session.expiresAt <= Date.now()) {
			signOut();
			setNotice(null);
			setError('Сессия администратора истекла. Войдите снова.');
			return;
		}
		submitting.current = true;
		setBusy(true);
		setError(null);
		setNotice(null);
		const requestGeneration = generation.current;
		try {
			await api.saveApiKey(apiKey.trim(), session.token);
			if (!active.current || generation.current !== requestGeneration) return;
			setApiKey('');
			setNotice('API ключ сохранён.');
			onSaved();
		} catch (err) {
			if (!active.current || generation.current !== requestGeneration) return;
			if (!sessionError(err)) {
				setError('Не удалось сохранить API ключ. Проверьте соединение и повторите попытку.');
			}
		} finally {
			if (active.current && generation.current === requestGeneration) {
				submitting.current = false;
				setBusy(false);
			}
		}
	}

	return (
		<dialog ref={dialogRef} className="api-settings-dialog" aria-labelledby="api-settings-title"
			aria-describedby="api-settings-description" onCancel={(event) => { event.preventDefault(); close(); }}>
			<div className="row dialog-header">
				<h2 id="api-settings-title">Настройка API</h2>
				<button type="button" className="ghost" onClick={close} aria-label="Закрыть настройку API">Закрыть</button>
			</div>
			<p id="api-settings-description" className="muted">Только администратор может изменить API ключ. Текущий ключ не отображается.</p>
			{!session ? (
				<form className="admin-login-form" onSubmit={signIn} aria-busy={busy}>
					<label>Логин администратора
						<input ref={loginRef} name="login" autoComplete="username" required value={login}
							onChange={(event) => setLogin(event.target.value)} disabled={busy} />
					</label>
					<label>Пароль администратора
						<input type="password" name="password" autoComplete="off" required value={password}
							onChange={(event) => setPassword(event.target.value)} disabled={busy} />
					</label>
					<button type="submit" disabled={busy || !login.trim() || !password}>{busy ? 'Вход...' : 'Войти'}</button>
				</form>
			) : (
				<>
				<form onSubmit={save} aria-busy={busy}>
					<label>Новый API ключ
						<input ref={keyRef} type="password" name="apiKey" autoComplete="off" required value={apiKey}
							onChange={(event) => setApiKey(event.target.value)} disabled={busy} />
					</label>
					<div className="row">
						<button type="submit" disabled={busy || !apiKey.trim()}>{busy && !resetting ? 'Сохранение...' : 'Сохранить ключ'}</button>
						<button type="button" className="ghost" onClick={signOut} disabled={busy}>Выйти</button>
					</div>
				</form>
				<section className="indexes-settings" aria-labelledby="indexes-title" aria-busy={indexesLoading || resetting}>
					<h2 id="indexes-title">Индексы</h2>
					{indexesLoading && <p className="muted" role="status">Загрузка состояния индексов...</p>}
					{indexesError && <p className="error" role="alert">{indexesError}</p>}
					{indexesError && <button type="button" className="ghost" disabled={busy || indexesLoading}
						onClick={() => void loadIndexes(session)}>Повторить загрузку</button>}
					{indexes && <>
						<p>Текущая embedding model: <strong>{indexes.embeddingModel}</strong></p>
						<p className="muted">Модель сохранённых индексов: {indexes.storedEmbeddingModel ?? 'неизвестна (или индексы пусты)'}</p>
						<p className="muted">Проектов с индексом: {indexes.indexedProjects} · Чанков: {indexes.indexedChunks}</p>
						{indexes.requiresReset
							? <p className="warn" role="alert">Индексы устарели или требуют восстановления. Сбросьте индексы и выполните полную переиндексацию с текущей embedding model.</p>
							: <p className="muted">{indexes.storedEmbeddingModel ? 'Индексы соответствуют текущей модели.' : 'Версия индексов не определена. Непустые старые индексы можно сбросить вручную.'}</p>}
						<p className="muted">Сброс удаляет файлы и чанки из общих индексов ВСЕХ проектов. Проекты, чаты и история сохранятся. Затем потребуется полная переиндексация с текущей моделью.</p>
						{!confirmReset ? <button type="button" disabled={busy || indexesLoading || !!indexesError || (!indexes.requiresReset && indexes.indexedProjects === 0 && indexes.indexedChunks === 0)}
							onClick={() => { setConfirmReset(true); setNotice(null); }}>
							{indexes.requiresReset ? 'Удалить старые индексы' : 'Сбросить индексы'}
						</button> : <div className="indexes-confirm" role="group" aria-label="Подтверждение сброса индексов">
							<p className="warn">Подтвердите удаление индексов ВСЕХ проектов. Это действие нельзя отменить.</p>
							<div className="row">
								<button type="button" disabled={busy || indexesLoading} onClick={() => void resetIndexes()}>
									{resetting ? 'Удаление индексов...' : 'Подтвердить сброс всех индексов'}
								</button>
								<button type="button" className="ghost" disabled={busy} onClick={() => setConfirmReset(false)}>Отмена</button>
							</div>
						</div>}
					</>}
				</section>
				</>
			)}
			{error && <p className="error" role="alert">{error}</p>}
			{notice && <p className="ok" role="status">{notice}</p>}
		</dialog>
	);
}
