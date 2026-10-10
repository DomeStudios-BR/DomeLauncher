import { useEffect, useRef } from 'react';
import { Node } from '@tiptap/core';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { closeHistory } from '@tiptap/pm/history';
import { X } from '../iconesPixelados';
import { AnexosRelato, type AnexoRelato } from './AnexosRelato';

function MidiaRelato({ node, deleteNode, editor, selected }: NodeViewProps) {
    return <NodeViewWrapper as="span" contentEditable={false}
        className={`relative mx-1 inline-block max-w-full align-middle ${selected ? 'ring-1 ring-emerald-300' : ''}`}>
        {node.attrs.tipo.startsWith('image/') ? <img src={node.attrs.url} alt={node.attrs.nome}
            className="inline-block max-h-48 max-w-full object-contain" /> :
            <video src={node.attrs.url} controls preload="metadata" aria-label={node.attrs.nome}
                className="inline-block max-h-48 max-w-full object-contain" />}
        <button type="button" aria-label={`Remover anexo ${node.attrs.nome}`} disabled={!editor.isEditable}
            onMouseDown={(evento) => evento.preventDefault()} onClick={() => {
                editor.view.dispatch(closeHistory(editor.state.tr));
                deleteNode();
                editor.commands.focus();
            }}
            className="absolute right-1 top-1 border border-white/20 bg-[#141414] p-1 text-white/80">
            <X size={13} />
        </button>
    </NodeViewWrapper>;
}

const Midia = Node.create({
    name: 'midiaRelato', group: 'inline', inline: true, atom: true,
    addAttributes: () => ({ id: { default: '' }, tipo: { default: '' }, url: { default: '' }, nome: { default: '' } }),
    renderHTML: () => ['span', { 'data-midia-relato': '' }],
    addNodeView: () => ReactNodeViewRenderer(MidiaRelato),
});

interface Props {
    perfilId?: string;
    envioId: string;
    anexos: AnexoRelato[];
    bloqueado: boolean;
    aoAlterar: (anexos: AnexoRelato[]) => void;
    aoDescricao: (descricao: string) => void;
    aoOcupado: (ocupado: boolean) => void;
    aoErro: (erro: string) => void;
}

export function EditorRelato({ aoDescricao, ...props }: Props) {
    const descricaoRef = useRef(aoDescricao);
    descricaoRef.current = aoDescricao;
    const editor = useEditor({
        shouldRerenderOnTransaction: true,
        extensions: [StarterKit.configure({
            blockquote: false, bold: false, bulletList: false, code: false, codeBlock: false,
            heading: false, horizontalRule: false, italic: false, link: false, listItem: false, listKeymap: false,
            orderedList: false, strike: false, underline: false,
        }), Midia],
        onUpdate: ({ editor: atual }) => descricaoRef.current(atual.state.doc.textBetween(
            0, atual.state.doc.content.size, '\n\n',
            (no) => no.type.name === 'midiaRelato' ? `{{anexo:${no.attrs.id}}}` : '\n',
        )),
        editorProps: {
            attributes: {
                'aria-label': 'Descrição', 'aria-multiline': 'true', role: 'textbox',
                class: 'min-h-28 p-3 outline-none text-sm text-white whitespace-pre-wrap break-words',
            },
            handleDrop: () => true,
            transformPastedHTML: () => '',
        },
    });
    useEffect(() => { editor?.setEditable(!props.bloqueado); }, [editor, props.bloqueado]);
    const selecao = useRef({ from: 1, to: 1 });
    let quantidade = 0;
    editor?.state.doc.descendants((no) => { if (no.type.name === 'midiaRelato') quantidade += 1; });
    return <div className="border border-white/15 bg-black/25 focus-within:border-emerald-400/60">
        <div className="relative">
            {editor?.isEmpty && <span className="pointer-events-none absolute left-3 top-3 text-sm text-white/40">
                Como aconteceu e o que você esperava?
            </span>}
            <EditorContent editor={editor} />
        </div>
        <div className="border-t border-white/10 px-3 py-2">
            <AnexosRelato {...props} perfilId={props.perfilId ?? ''} quantidade={quantidade}
                aoOcupado={(ocupado) => {
                    if (ocupado && editor) selecao.current = { from: editor.state.selection.from,
                        to: editor.state.selection.to };
                    editor?.setEditable(!props.bloqueado && !ocupado);
                    props.aoOcupado(ocupado);
                    if (!ocupado) editor?.commands.focus();
                }}
                aoInserir={(anexo) => {
                    if (editor) editor.view.dispatch(closeHistory(editor.state.tr));
                    editor?.chain().setTextSelection(selecao.current)
                        .insertContent({ type: 'midiaRelato', attrs: anexo }).run();
                }} />
        </div>
    </div>;
}
