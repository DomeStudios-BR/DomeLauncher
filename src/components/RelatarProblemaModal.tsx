import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { AlertCircle, Check, Loader2, X } from '../iconesPixelados';
import { CONFIGURACAO_SOCIAL } from '../lib/configuracaoSocial';
import { obterLogsRelato, sanitizarDiagnostico } from '../lib/diagnosticoRelatos';
import { ModalSocial } from './social/ModalSocial';
import { AreaRolagemPersonalizada } from './scroll/AreaRolagemPersonalizada';
import { removerAnexoRelato, type AnexoRelato } from './AnexosRelato';
import { EditorRelato } from './EditorRelato';

interface PreviaRelato {
    ambiente: { versaoLauncher: string; sistemaOperacional: string; arquitetura: string };
    perfilId: string;
    nome: string;
    handle: string;
    minecraft: string;
}

interface IssueCriada {
    numero: number;
    url: string;
}

const repositorioIssues = 'https://github.com/DomeStudios-BR/DomeLauncher/issues';
const estiloCampo = 'w-full border border-white/15 bg-black/25 p-3 text-sm text-white ' +
    'outline-none focus:border-emerald-400/60 disabled:opacity-50';

export default function RelatarProblemaModal({ onFechar }: { onFechar: () => void }) {
    const [titulo, setTitulo] = useState('');
    const [descricao, setDescricao] = useState('');
    const [incluirLogs, setIncluirLogs] = useState(true);
    const [previa, setPrevia] = useState<PreviaRelato | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [enviando, setEnviando] = useState(false);
    const [iniciado, setIniciado] = useState(false);
    const [anexos, setAnexos] = useState<AnexoRelato[]>([]);
    const [anexando, setAnexando] = useState(false);
    const [erro, setErro] = useState('');
    const [issue, setIssue] = useState<IssueCriada | null>(null);
    const [logs] = useState(obterLogsRelato);
    const [envioId] = useState(() => crypto.randomUUID());
    const envioAtivo = useRef(false);
    const anexosIncluidos = anexos.filter((anexo) => descricao.includes(`{{anexo:${anexo.id}}}`));

    useEffect(() => {
        let ativo = true;
        invoke<PreviaRelato>('preparar_relato_problema').then((dados) => {
            if (ativo) setPrevia(dados);
        }).catch((falha: unknown) => {
            if (ativo) setErro(sanitizarDiagnostico(String(falha)));
        }).finally(() => { if (ativo) setCarregando(false); });
        return () => { ativo = false; };
    }, []);

    const fechar = () => {
        if (envioAtivo.current || anexando) return;
        if (!iniciado && previa) {
            void Promise.allSettled(anexos.map((anexo) => removerAnexoRelato(previa.perfilId, envioId, anexo)));
        }
        onFechar();
    };
    const abrirLink = async (url: string) => {
        try { await openUrl(url); }
        catch { setErro('Não foi possível abrir o navegador.'); }
    };
    const enviar = async (evento: FormEvent) => {
        evento.preventDefault();
        if (!previa || envioAtivo.current || anexando || issue) return;
        if (descricao.trim().length < 10 || descricao.length > 10000) {
            setErro('A descrição deve ter entre 10 e 10000 caracteres.');
            return;
        }
        envioAtivo.current = true;
        setEnviando(true);
        setIniciado(true);
        setErro('');
        try {
            if (!iniciado) {
                void Promise.allSettled(anexos.filter((anexo) => !anexosIncluidos.includes(anexo))
                    .map((anexo) => removerAnexoRelato(previa.perfilId, envioId, anexo)));
            }
            const resultado = await invoke<IssueCriada>('enviar_relato_problema', {
                apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
                dados: { envioId, perfilId: previa.perfilId, titulo, descricao, logs: incluirLogs ? logs : null,
                    anexos: anexosIncluidos.map(({ id, tipo }) => ({ id, tipo })) },
            });
            setIssue(resultado);
        } catch (falha) {
            setErro(sanitizarDiagnostico(String(falha)));
        } finally {
            envioAtivo.current = false;
            setEnviando(false);
        }
    };

    return <ModalSocial onFechar={fechar}>
        <section role="dialog" aria-modal="true" aria-labelledby="titulo-relatar-problema"
            className="flex max-h-[88vh] w-full max-w-xl flex-col border border-white/15 bg-[#141414] shadow-2xl">
            <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
                <h2 id="titulo-relatar-problema" className="flex items-center gap-2 text-lg text-white">
                    <AlertCircle size={20} className="text-emerald-300" />Reportar problema
                </h2>
                <button type="button" aria-label="Fechar relato" onClick={fechar} disabled={enviando || anexando}
                    className="p-2 text-white/60 hover:text-white disabled:opacity-30"><X size={18} /></button>
            </header>
            {issue ? <div className="space-y-4 p-5" role="status">
                <p className="flex items-center gap-2 text-emerald-300"><Check size={20} />Relato enviado.</p>
                <button type="button" onClick={fechar}
                    className="block border border-white/20 px-4 py-2 text-sm text-white">Fechar</button>
            </div> : <form onSubmit={(evento) => void enviar(evento)} className="flex min-h-0 flex-1 flex-col">
                <AreaRolagemPersonalizada className="min-h-0 flex-1" rotulo="Dados do relato">
                    <div className="space-y-4 p-5">
                        <label className="block space-y-2 text-sm text-white/80">Título
                            <input autoFocus required minLength={5} maxLength={120} value={titulo} disabled={iniciado}
                                onChange={(evento) => setTitulo(evento.target.value)} className={estiloCampo}
                                placeholder="O que deu errado?" />
                        </label>
                        <div className="space-y-2 text-sm text-white/80">
                            <p>Descrição</p>
                            <EditorRelato perfilId={previa?.perfilId} envioId={envioId} anexos={anexos}
                                bloqueado={iniciado} aoAlterar={setAnexos} aoDescricao={setDescricao}
                                aoOcupado={setAnexando} aoErro={(mensagem) => setErro(sanitizarDiagnostico(mensagem))} />
                            {descricao.length > 10000 && <p role="alert" className="text-xs text-red-300">
                                A descrição ultrapassou o limite de 10000 caracteres.
                            </p>}
                        </div>
                        {carregando ? <p role="status" className="flex items-center gap-2 text-sm text-white/60">
                            <Loader2 size={14} className="animate-spin" />Preparando diagnóstico...
                        </p> : previa && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                            <dt className="text-white/50">Usuário</dt>
                            <dd className="break-words text-white/85">{previa.nome} ({previa.handle})</dd>
                            <dt className="text-white/50">Minecraft</dt>
                            <dd className="text-white/85">{previa.minecraft}</dd>
                            <dt className="text-white/50">Launcher</dt>
                            <dd className="text-white/85">{previa.ambiente.versaoLauncher}</dd>
                            <dt className="text-white/50">Sistema</dt>
                            <dd className="text-white/85">{previa.ambiente.sistemaOperacional}</dd>
                            <dt className="text-white/50">Arquitetura</dt>
                            <dd className="text-white/85">{previa.ambiente.arquitetura}</dd>
                        </dl>}
                        <label className="flex items-center gap-2 text-sm text-white/80">
                            <input type="checkbox" checked={incluirLogs} disabled={iniciado}
                                onChange={(evento) => setIncluirLogs(evento.target.checked)}
                                className="accent-emerald-400" />Incluir logs
                        </label>
                        {incluirLogs && <details className="text-xs text-white/60">
                            <summary className="cursor-pointer py-1">Conferir logs que serão enviados</summary>
                            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all
                                border border-white/10 p-3">
                                {logs || 'Nenhum log nesta sessão.'}
                            </pre>
                        </details>}
                        {erro && <div role="alert" className="space-y-2 text-sm text-red-300">
                            <p>{erro}</p>
                            {iniciado && <button type="button" onClick={() => void abrirLink(repositorioIssues)}
                                className="text-xs text-white/70 underline">Conferir issues no GitHub</button>}
                        </div>}
                    </div>
                </AreaRolagemPersonalizada>
                <footer className="flex shrink-0 justify-end gap-3 border-t border-white/10 p-4">
                    <button type="button" onClick={fechar} disabled={enviando || anexando}
                        className="px-4 py-2 text-sm text-white/60 disabled:opacity-30">Cancelar</button>
                    <button type="submit" disabled={carregando || !previa || enviando || anexando ||
                        titulo.trim().length < 5 || descricao.trim().length < 10 || descricao.length > 10000}
                        className="flex items-center gap-2 border border-emerald-400/50 bg-emerald-500/15 px-4 py-2
                            text-sm text-emerald-300 hover:bg-emerald-500/25
                            disabled:cursor-default disabled:opacity-35">
                        {enviando && <Loader2 size={14} className="animate-spin" />}
                        {enviando ? 'Enviando...' : iniciado ? 'Tentar confirmar envio' : 'Enviar'}
                    </button>
                </footer>
            </form>}
        </section>
    </ModalSocial>;
}
