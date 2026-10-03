import { useState } from 'react';
import { SelecaoArquivosPacote } from './SelecaoArquivosPacote';
import { AreaRolagemPersonalizada } from '../scroll/AreaRolagemPersonalizada';
import { ModalSocial } from './ModalSocial';

export interface TransferenciaSocial {
    pedidoId: string;
    friendProfileId?: string;
    direcao?: 'envio' | 'recebimento';
    status: string;
    instanciaId?: string | null;
    instanciaNome?: string | null;
    expiraEm?: string;
    tokenUpload?: string;
    tokenDownload?: string;
    mensagem?: string;
}

export interface PreviaPacoteSocial {
    nome: string;
    versaoMinecraft: string;
    loader?: string;
    tamanhoBytes: number;
    arquivos: Array<{ caminho: string; tamanhoBytes: number; configuracao: boolean; sha256: string; sha512: string; referencia?: { versaoId: string; url: string } }>;
}

const rotulos: Record<string, string> = {
    pendente: 'Aguardando aceite', aguardando_upload: 'Preparando envio', pronto_download: 'Pronta para receber',
    concluido: 'Concluída', cancelado: 'Cancelada', recusado: 'Recusada', expirado: 'Expirada',
    processando: 'Transferindo', erro: 'Falha na transferência',
};

const PASTAS_SELECIONADAS_INICIALMENTE = new Set(['config', 'mods', 'resourcepacks']);

export function TransferenciasSociais({ pedidos, onRetomar, onCancelar }: {
    pedidos: TransferenciaSocial[];
    onRetomar: (pedido: TransferenciaSocial) => void;
    onCancelar: (pedido: TransferenciaSocial) => void;
}) {
    if (!pedidos.length) return null;
    return <details className="mx-3 my-2 rounded-lg border border-white/10 bg-black/20 text-xs" open>
        <summary className="cursor-pointer px-3 py-2 text-white/70">Transferências · {pedidos.length}</summary>
        <div className="max-h-56 overflow-y-auto px-3 pb-2">
            {pedidos.map((pedido) => <div key={pedido.pedidoId} className="border-t border-white/10 py-2">
                <div className="truncate text-white">{pedido.instanciaNome || 'Instância compartilhada'}</div>
                <p className="mt-1 text-white/50" role="status">{pedido.mensagem || rotulos[pedido.status] || pedido.status}</p>
                <div className="mt-2 flex gap-3">
                    {['pronto_download', 'erro'].includes(pedido.status) && (pedido.tokenDownload || pedido.tokenUpload && pedido.status === 'erro') &&
                        <button className="text-emerald-400 hover:text-emerald-300" onClick={() => onRetomar(pedido)}>
                            {pedido.status === 'erro' ? 'Tentar novamente' : 'Receber instância'}
                        </button>}
                    {['pendente', 'aguardando_upload', 'pronto_download', 'processando', 'erro'].includes(pedido.status) &&
                        <button className="text-white/60 hover:text-white" onClick={() => onCancelar(pedido)}>Cancelar</button>}
                </div>
            </div>)}
        </div>
    </details>;
}

export function RevisaoPacoteSocial({ previa, onConfirmar, onFechar, arquivosAnteriores, publicando = false }: {
    previa: PreviaPacoteSocial;
    onConfirmar: (arquivos: string[]) => void;
    onFechar: () => void;
    arquivosAnteriores?: PreviaPacoteSocial['arquivos'];
    publicando?: boolean;
}) {
    const [selecionados, setSelecionados] = useState(() => new Set(
        arquivosAnteriores?.map((arquivo) => arquivo.caminho)
            ?? previa.arquivos.filter((arquivo) => PASTAS_SELECIONADAS_INICIALMENTE.has(arquivo.caminho.split('/')[0]))
                .map((arquivo) => arquivo.caminho)));
    const tamanho = previa.arquivos.filter((a) => selecionados.has(a.caminho) && !a.referencia)
        .reduce((total, a) => total + a.tamanhoBytes, 0);
    const incluidos = previa.arquivos.filter((a) => selecionados.has(a.caminho));
    const diferencas = [
        ...incluidos.map((arquivo) => {
            const anterior = arquivosAnteriores?.find((a) => a.caminho === arquivo.caminho);
            const alterado = anterior && (arquivo.sha256
                ? anterior.sha256 !== arquivo.sha256
                : anterior.tamanhoBytes !== arquivo.tamanhoBytes);
            return { caminho: arquivo.caminho, estado: !anterior ? 'Adicionar' : alterado ? 'Alterar' : 'Manter' };
        }),
        ...(arquivosAnteriores ?? []).filter((a) => !incluidos.some((i) => i.caminho === a.caminho))
            .map((a) => ({ caminho: a.caminho, estado: 'Remover' })),
    ];
    return <ModalSocial onFechar={onFechar}>
        <section role="dialog" aria-modal="true" aria-labelledby="revisao-social-titulo"
            className="flex h-[calc(100vh-2.5rem)] max-h-[46rem] w-full max-w-xl flex-col rounded-xl border border-white/10 bg-[#17191c] p-5 shadow-2xl">
            <h2 id="revisao-social-titulo" className="shrink-0 text-lg text-white">{publicando ? 'Publicar' : 'Enviar'} {previa.nome}</h2>
            <p className="mt-1 shrink-0 text-sm text-white/50">Minecraft {previa.versaoMinecraft} · {previa.loader || 'Vanilla'} ·
                {' '}{(tamanho / 1024 / 1024).toFixed(1)} MiB para empacotar</p>
            <details className="my-3 shrink-0 text-xs text-white/60">
                <summary className="cursor-pointer">{incluidos.length} arquivos · {incluidos.filter((a) => a.referencia).length} disponíveis no Modrinth</summary>
                <ul className="mt-2 max-h-32 overflow-y-auto">{diferencas.map((a) => <li key={a.caminho}>
                    {arquivosAnteriores && <span className={a.estado === 'Remover' ? 'text-red-400' : 'text-emerald-400'}>{a.estado} · </span>}{a.caminho}
                </li>)}</ul>
            </details>
            <p className="mb-2 shrink-0 text-sm text-white/70">Selecione arquivos e pastas para incluir no pacote:</p>
            <AreaRolagemPersonalizada className="min-h-0 flex-1 rounded-lg border border-white/10 p-1"
                classNameConteudo="py-1" rotulo="Arquivos e pastas para incluir no pacote">
                <SelecaoArquivosPacote arquivos={previa.arquivos} selecionados={selecionados} onAlterar={setSelecionados} />
            </AreaRolagemPersonalizada>
            <div className="mt-5 flex shrink-0 items-center gap-3 border-t border-white/10 pt-4">
                <span aria-live="polite" className="mr-auto text-xs font-medium text-white/50">
                    {selecionados.size} {selecionados.size === 1 ? 'arquivo selecionado' : 'arquivos selecionados'}
                </span>
                <button autoFocus className="rounded px-4 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white active:scale-95"
                    onClick={onFechar}>Voltar</button>
                <button disabled={!selecionados.size || tamanho > 2 * 1024 ** 3}
                    className="rounded bg-emerald-500 px-4 py-2 text-sm text-black transition hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => onConfirmar([...selecionados])}>{publicando ? 'Publicar versão' : 'Aceitar e enviar'}</button>
            </div>
        </section>
    </ModalSocial>;
}
