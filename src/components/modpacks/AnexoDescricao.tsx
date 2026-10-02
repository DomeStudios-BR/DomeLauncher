import { Link, Unlink, MoveDiagonal, Ruler, X } from 'lucide-react';
import { IconeAlinhamento } from './IconeAlinhamento';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ImagemMidiaMarkdown } from './LinkMidiaMarkdown';
import { alinhamentoSeguro, larguraSegura, siteSeguro } from './formatacaoMidia';

export function AnexoDescricao({ node, deleteNode, selected, editor, updateAttributes, getPos }: NodeViewProps) {
    const [editando, setEditando] = useState(false);
    const [larguraPrevia, setLarguraPrevia] = useState<number>();
    const redimensionamento = useRef<{ x: number; largura: number; maximo: number; atual: number } | undefined>(
        undefined,
    );
    const imagemRef = useRef<HTMLSpanElement>(null);
    const align = alinhamentoSeguro(node.attrs.align);
    const largura = larguraPrevia ?? larguraSegura(node.attrs.width);
    const vinculo =
        siteSeguro(node.attrs.vinculo) ??
        siteSeguro(node.marks.find((marca) => marca.type.name === 'link')?.attrs.href);
    function alterarVinculo(site?: string) {
        const posicao = getPos();
        if (typeof posicao !== 'number') return;
        editor.view.dispatch(
            editor.state.tr.setNodeMarkup(
                posicao,
                undefined,
                { ...node.attrs, vinculo: site ?? null },
                node.marks.filter((marca) => marca.type.name !== 'link'),
            ),
        );
    }
    useEffect(() => {
        if (!editando) return;
        const fechar = (evento: PointerEvent) => {
            if (!imagemRef.current?.parentElement?.contains(evento.target as Node)) setEditando(false);
        };
        document.addEventListener('pointerdown', fechar);
        return () => document.removeEventListener('pointerdown', fechar);
    }, [editando]);

    return (
        <NodeViewWrapper
            as="span"
            className={`modpacks-anexo${selected ? ' selecionado' : ''}`}
            contentEditable={false}
            onClick={(evento: MouseEvent) => {
                if ((evento.target as HTMLElement).closest('button, input, label')) return;
                setEditando(true);
                const posicao = getPos();
                if (typeof posicao === 'number') editor.chain().focus().setNodeSelection(posicao).run();
            }}
            style={
                align
                    ? {
                          display: 'flex',
                          justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[align],
                      }
                    : undefined
            }
        >
            <span ref={imagemRef} className="modpacks-anexo-imagem" style={{ width: largura, maxWidth: '100%' }}>
                <ImagemMidiaMarkdown src={node.attrs.src} alt={node.attrs.alt} width={largura} />
                <button
                    type="button"
                    className="modpacks-remover-anexo"
                    aria-label={`Remover anexo ${node.attrs.alt ?? ''}`}
                    title="Remover anexo"
                    disabled={!editor.isEditable}
                    onMouseDown={(evento) => evento.preventDefault()}
                    onClick={(evento) => {
                        evento.stopPropagation();
                        deleteNode();
                        editor.commands.focus();
                    }}
                >
                    <X size={16} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="modpacks-redimensionar-anexo"
                    aria-label="Redimensionar imagem"
                    title="Redimensionar imagem"
                    disabled={!editor.isEditable}
                    onPointerDown={(evento) => {
                        evento.preventDefault();
                        const atual = imagemRef.current?.getBoundingClientRect().width ?? 256;
                        redimensionamento.current = {
                            x: evento.clientX,
                            largura: atual,
                            atual,
                            maximo: Math.min(1600, editor.view.dom.clientWidth - 40),
                        };
                        evento.currentTarget.setPointerCapture(evento.pointerId);
                    }}
                    onPointerMove={(evento) => {
                        const inicio = redimensionamento.current;
                        if (!inicio) return;
                        inicio.atual = Math.round(
                            Math.max(32, Math.min(inicio.maximo, inicio.largura + evento.clientX - inicio.x)),
                        );
                        setLarguraPrevia(inicio.atual);
                    }}
                    onPointerUp={(evento) => {
                        if (!redimensionamento.current) return;
                        updateAttributes({ width: redimensionamento.current.atual });
                        redimensionamento.current = undefined;
                        setLarguraPrevia(undefined);
                        evento.currentTarget.releasePointerCapture(evento.pointerId);
                    }}
                    onPointerCancel={() => {
                        redimensionamento.current = undefined;
                        setLarguraPrevia(undefined);
                    }}
                >
                    <MoveDiagonal size={14} aria-hidden="true" />
                </button>
            </span>
            {(selected || editando) && (
                <span className="modpacks-anexo-controles" onMouseDown={(evento) => evento.stopPropagation()}>
                    <label title="Largura da imagem">
                        <Ruler size={16} aria-hidden="true" />
                        <input
                            aria-label="Largura da imagem"
                            type="number"
                            min={32}
                            max={1600}
                            key={largura ?? 'automatica'}
                            defaultValue={largura ?? ''}
                            placeholder="Automática"
                            disabled={!editor.isEditable}
                            onChange={(evento) =>
                                updateAttributes({ width: larguraSegura(evento.target.value) ?? null })
                            }
                        />{' '}
                        px
                    </label>
                    {(['left', 'center', 'right'] as const).map((valor) => (
                        <button
                            key={valor}
                            type="button"
                            aria-label={`Alinhar imagem ${{ left: 'à esquerda', center: 'ao centro', right: 'à direita' }[valor]}`}
                            title={
                                {
                                    left: 'Alinhar imagem à esquerda',
                                    center: 'Centralizar imagem',
                                    right: 'Alinhar imagem à direita',
                                }[valor]
                            }
                            aria-pressed={align === valor}
                            disabled={!editor.isEditable}
                            onClick={() => updateAttributes({ align: valor })}
                        >
                            <IconeAlinhamento valor={valor} />
                        </button>
                    ))}
                    <label title="Site da imagem">
                        <Link size={16} aria-hidden="true" />
                        <input
                            aria-label="Site da imagem"
                            type="url"
                            placeholder="https://..."
                            key={vinculo ?? ''}
                            defaultValue={vinculo ?? ''}
                            disabled={!editor.isEditable}
                            onBlur={(evento) => {
                                const site = siteSeguro(evento.target.value);
                                if (evento.target.value && !site) {
                                    evento.target.setCustomValidity('Informe um endereço HTTPS válido.');
                                    evento.target.reportValidity();
                                    return;
                                }
                                evento.target.setCustomValidity('');
                                alterarVinculo(site);
                            }}
                            onInput={(evento) => evento.currentTarget.setCustomValidity('')}
                        />
                    </label>
                    {vinculo && (
                        <button
                            type="button"
                            aria-label="Remover link"
                            title="Remover link"
                            disabled={!editor.isEditable}
                            onClick={() => alterarVinculo()}
                        >
                            <Unlink size={16} aria-hidden="true" />
                        </button>
                    )}
                </span>
            )}
        </NodeViewWrapper>
    );
}
