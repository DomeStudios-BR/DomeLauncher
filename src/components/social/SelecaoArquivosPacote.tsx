import { useMemo, useState } from 'react';
import { ChevronRight } from '../../iconesPixelados';
import type { PreviaPacoteSocial } from './TransferenciasSociais';

interface ItemPacote {
    nome: string;
    caminho: string;
    pasta: boolean;
    filhos: ItemPacote[];
    caminhosArquivos: string[];
}

function ordenarItensPacote(itens: ItemPacote[]) {
    itens.sort((primeiro, segundo) => {
        if (primeiro.pasta !== segundo.pasta) return primeiro.pasta ? -1 : 1;
        return primeiro.nome.localeCompare(segundo.nome);
    });
    itens.forEach((item) => ordenarItensPacote(item.filhos));
    return itens;
}

function criarArvorePacote(arquivos: PreviaPacoteSocial['arquivos']) {
    const raiz: ItemPacote[] = [];
    arquivos.forEach((arquivo) => {
        const partes = arquivo.caminho.split('/');
        let nivel = raiz;
        partes.forEach((nome, indice) => {
            const caminho = partes.slice(0, indice + 1).join('/');
            let item = nivel.find((existente) => existente.nome === nome);
            if (!item) {
                item = { nome, caminho, pasta: indice < partes.length - 1, filhos: [], caminhosArquivos: [] };
                nivel.push(item);
            }
            item.caminhosArquivos.push(arquivo.caminho);
            nivel = item.filhos;
        });
    });
    return ordenarItensPacote(raiz);
}

function CaixaSelecaoItemPacote({
    item,
    selecionados,
    onAlternar,
    podeSelecionar,
}: {
    item: ItemPacote;
    selecionados: Set<string>;
    podeSelecionar: (caminho: string) => boolean;
    onAlternar: (item: ItemPacote, marcado: boolean) => void;
}) {
    const disponiveis = item.caminhosArquivos.filter(podeSelecionar);
    const quantidadeSelecionada = disponiveis.filter((caminho) => selecionados.has(caminho)).length;
    const marcado = disponiveis.length > 0 && quantidadeSelecionada === disponiveis.length;
    const parcial = quantidadeSelecionada > 0 && !marcado;

    return (
        <input
            ref={(elemento) => {
                if (elemento) elemento.indeterminate = parcial;
            }}
            type="checkbox"
            disabled={!disponiveis.length}
            title={!disponiveis.length ? 'Este conteúdo não é aceito em modpacks públicos.' : undefined}
            checked={marcado}
            aria-label={`Incluir ${item.pasta ? 'pasta' : 'arquivo'} ${item.caminho}`}
            className="size-4 shrink-0 cursor-pointer accent-emerald-500 transition active:scale-90"
            onChange={(evento) => onAlternar(item, evento.target.checked)}
        />
    );
}

function ItemArvorePacote({
    item,
    nivel,
    selecionados,
    pastasAbertas,
    onAlternar,
    podeSelecionar,
    onAlternarPasta,
}: {
    item: ItemPacote;
    nivel: number;
    selecionados: Set<string>;
    podeSelecionar: (caminho: string) => boolean;
    pastasAbertas: Set<string>;
    onAlternar: (item: ItemPacote, marcado: boolean) => void;
    onAlternarPasta: (caminho: string) => void;
}) {
    const aberta = item.pasta && pastasAbertas.has(item.caminho);
    const selecionado = item.caminhosArquivos.every((caminho) => selecionados.has(caminho));
    const parcialmenteSelecionado = !selecionado && item.caminhosArquivos.some((caminho) => selecionados.has(caminho));
    return (
        <li>
            <div
                className={`flex min-h-9 items-center gap-1 rounded px-1.5 text-xs transition-colors ${
                    selecionado
                        ? 'bg-emerald-500/10 text-white'
                        : parcialmenteSelecionado
                          ? 'bg-emerald-500/5 text-white/90'
                          : 'text-white/70 hover:bg-white/[0.045]'
                }`}
                style={{ paddingLeft: `${nivel * 18 + 6}px` }}
            >
                {item.pasta ? (
                    <button
                        type="button"
                        aria-label={`${aberta ? 'Recolher' : 'Expandir'} pasta ${item.caminho}`}
                        aria-expanded={aberta}
                        className="grid size-7 shrink-0 place-items-center rounded text-white/50 transition hover:bg-white/10 hover:text-white active:scale-90"
                        onClick={() => onAlternarPasta(item.caminho)}
                    >
                        <ChevronRight size={12} className={`transition-transform ${aberta ? 'rotate-90' : ''}`} />
                    </button>
                ) : (
                    <span className="block size-7 shrink-0" />
                )}
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 active:opacity-70">
                    <CaixaSelecaoItemPacote
                        item={item}
                        selecionados={selecionados}
                        onAlternar={onAlternar}
                        podeSelecionar={podeSelecionar}
                    />
                    <span className={`min-w-0 truncate ${item.pasta ? 'font-semibold' : ''}`} title={item.caminho}>
                        {item.nome}
                    </span>
                </label>
            </div>
            {aberta && (
                <ul>
                    {item.filhos.map((filho) => (
                        <ItemArvorePacote
                            key={filho.caminho}
                            item={filho}
                            nivel={nivel + 1}
                            selecionados={selecionados}
                            pastasAbertas={pastasAbertas}
                            onAlternar={onAlternar}
                            podeSelecionar={podeSelecionar}
                            onAlternarPasta={onAlternarPasta}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

const permitirTodos = () => true;

export function SelecaoArquivosPacote({
    arquivos,
    selecionados,
    onAlterar,
    podeSelecionar = permitirTodos,
}: {
    arquivos: PreviaPacoteSocial['arquivos'];
    selecionados: Set<string>;
    podeSelecionar?: (caminho: string) => boolean;
    onAlterar: (arquivos: Set<string>) => void;
}) {
    const [pastasAbertas, setPastasAbertas] = useState(() => new Set<string>());
    const arvorePacote = useMemo(() => criarArvorePacote(arquivos), [arquivos]);
    const alternarItem = (item: ItemPacote, marcado: boolean) => {
        const novos = new Set(selecionados);
        item.caminhosArquivos
            .filter(podeSelecionar)
            .forEach((caminho) => (marcado ? novos.add(caminho) : novos.delete(caminho)));
        onAlterar(novos);
    };
    const alternarPasta = (caminho: string) =>
        setPastasAbertas((anteriores) => {
            const novas = new Set(anteriores);
            if (novas.has(caminho)) novas.delete(caminho);
            else novas.add(caminho);
            return novas;
        });
    return (
        <>
            {!arquivos.length && <p className="p-2 text-sm text-white/40">Nenhum conteúdo disponível.</p>}
            {!!arquivos.length && (
                <ul>
                    {arvorePacote.map((item) => (
                        <ItemArvorePacote
                            key={item.caminho}
                            item={item}
                            nivel={0}
                            selecionados={selecionados}
                            pastasAbertas={pastasAbertas}
                            onAlternar={alternarItem}
                            podeSelecionar={podeSelecionar}
                            onAlternarPasta={alternarPasta}
                        />
                    ))}
                </ul>
            )}
        </>
    );
}
