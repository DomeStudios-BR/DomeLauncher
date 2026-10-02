import { Bold, Italic, Heading2, List, ListOrdered, Quote, Link, Undo2, Redo2, ImagePlus, Video } from 'lucide-react';
import { IconeAlinhamento } from './IconeAlinhamento';
import { htmlImagemDescricao } from './serializacaoDescricao';
import { useEffect, useRef, useState } from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { Selection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { CONFIGURACAO_SOCIAL } from '../../lib/configuracaoSocial';
import { mergeAttributes } from '@tiptap/core';
import { alinhamentoSeguro, larguraSegura, siteSeguro } from './formatacaoMidia';
import { AnexoDescricao } from './AnexoDescricao';
import { AlinhamentoDescricao, ParagrafoDescricao, TituloDescricao } from './FormatacaoDescricao';
import './EditorDescricaoModpack.css';

interface Props {
    valor: string;
    aoAlterar: (valor: string) => void;
    aoOcupado: (valor: boolean) => void;
}

const Anexo = Image.extend({
    marks: '',
    addAttributes() {
        return {
            ...this.parent?.(),
            width: { default: null, parseHTML: (elemento) => larguraSegura(elemento.getAttribute('width')) ?? null },
            align: {
                default: null,
                parseHTML: (elemento) => alinhamentoSeguro(elemento.getAttribute('align')) ?? null,
            },
            vinculo: {
                default: null,
                rendered: false,
                parseHTML: (elemento) => siteSeguro(elemento.closest('a')?.getAttribute('href')) ?? null,
            },
        };
    },
    renderHTML({ node, HTMLAttributes }) {
        const imagem: [string, Record<string, unknown>] = [
            'img',
            mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
        ];
        const href = siteSeguro(node.attrs.vinculo);
        return href ? ['a', { href, target: '_blank', rel: 'noreferrer' }, imagem] : imagem;
    },
    renderMarkdown(node, helpers, contexto) {
        if (node.attrs?.width || node.attrs?.align || node.attrs?.vinculo) {
            return htmlImagemDescricao(node.attrs);
        }
        return Image.config.renderMarkdown?.call(this, node, helpers, contexto) ?? '';
    },
    addNodeView() {
        return ReactNodeViewRenderer(AnexoDescricao);
    },
}).configure({ inline: true, allowBase64: false });

export function EditorDescricaoModpack({ valor, aoAlterar, aoOcupado }: Props) {
    const [enviando, setEnviando] = useState(false);
    const [erro, setErro] = useState('');
    const alterarRef = useRef(aoAlterar);
    alterarRef.current = aoAlterar;
    const editor = useEditor({
        extensions: [
            StarterKit.configure({ link: { openOnClick: false }, paragraph: false, heading: false }),
            ParagrafoDescricao,
            TituloDescricao,
            AlinhamentoDescricao,
            Markdown,
            Anexo,
            TableKit,
            TaskList,
            TaskItem.configure({ nested: true }),
        ],
        content: valor,
        contentType: 'markdown',
        shouldRerenderOnTransaction: true,
        onUpdate: ({ editor: atual }) => alterarRef.current(atual.getMarkdown()),
        editorProps: {
            attributes: { 'aria-label': 'Descrição completa', role: 'textbox', 'aria-multiline': 'true' },
            handleDrop: () => true,
        },
    });
    useEffect(() => {
        if (editor && valor !== editor.getMarkdown()) {
            editor.commands.setContent(valor, { contentType: 'markdown', emitUpdate: false });
        }
    }, [editor, valor]);
    useEffect(() => {
        editor?.setEditable(!enviando);
    }, [editor, enviando]);

    async function anexar(tipo: 'imagem' | 'video') {
        if (enviando || !editor) return;
        const selecao = editor.state.selection.toJSON();
        setErro('');
        setEnviando(true);
        aoOcupado(true);
        try {
            const caminho = await open({
                multiple: false,
                filters: [
                    {
                        name: tipo === 'imagem' ? 'Imagem' : 'Vídeo',
                        extensions: tipo === 'imagem' ? ['png', 'jpg', 'jpeg', 'webp', 'gif'] : ['mp4', 'webm'],
                    },
                ],
            });
            if (typeof caminho !== 'string') return;
            const midia = await invoke<{ url: string; tipo: string }>('enviar_midia_modpack_dome', {
                apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
                caminhoArquivo: caminho,
            });
            if (editor.isDestroyed) return;
            const nome = caminho.split(/[\\/]/).pop() ?? 'Anexo';
            editor.view.dispatch(editor.state.tr.setSelection(Selection.fromJSON(editor.state.doc, selecao)));
            editor.chain().focus().setImage({ src: midia.url, alt: nome }).run();
        } catch (falha) {
            setErro(falha instanceof Error ? falha.message : String(falha));
        } finally {
            setEnviando(false);
            aoOcupado(false);
        }
    }

    return (
        <div className="modpacks-editor-descricao">
            <div className="modpacks-editor-ferramentas" aria-label="Formatação">
                {editor && (
                    <>
                        <button
                            type="button"
                            aria-label="Negrito"
                            title="Negrito"
                            aria-pressed={editor.isActive('bold')}
                            onClick={() => editor.chain().focus().toggleBold().run()}
                        >
                            <Bold size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="Itálico"
                            title="Itálico"
                            aria-pressed={editor.isActive('italic')}
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                        >
                            <Italic size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="Título"
                            title="Título"
                            aria-pressed={editor.isActive('heading', { level: 2 })}
                            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        >
                            <Heading2 size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="Lista"
                            title="Lista"
                            aria-pressed={editor.isActive('bulletList')}
                            onClick={() => editor.chain().focus().toggleBulletList().run()}
                        >
                            <List size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="Lista numerada"
                            title="Lista numerada"
                            aria-pressed={editor.isActive('orderedList')}
                            onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        >
                            <ListOrdered size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="Citação"
                            title="Citação"
                            aria-pressed={editor.isActive('blockquote')}
                            onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        >
                            <Quote size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="Link"
                            title="Link"
                            aria-pressed={editor.isActive('link')}
                            onClick={() => {
                                const url = window.prompt(
                                    'Endereço do link (https://)',
                                    editor.getAttributes('link').href ?? '',
                                );
                                if (url === '') editor.chain().focus().unsetLink().run();
                                else if (url && /^https:\/\//i.test(url))
                                    editor.chain().focus().setLink({ href: url }).run();
                            }}
                        >
                            <Link size={16} aria-hidden="true" />
                        </button>
                        {(['left', 'center', 'right'] as const).map((alinhamento) => (
                            <button
                                key={alinhamento}
                                type="button"
                                aria-label={
                                    { left: 'Alinhar à esquerda', center: 'Centralizar', right: 'Alinhar à direita' }[
                                        alinhamento
                                    ]
                                }
                                title={
                                    { left: 'Alinhar à esquerda', center: 'Centralizar', right: 'Alinhar à direita' }[
                                        alinhamento
                                    ]
                                }
                                aria-pressed={editor.isActive({ alinhamento })}
                                onClick={() =>
                                    editor
                                        .chain()
                                        .focus()
                                        .updateAttributes('paragraph', { alinhamento })
                                        .updateAttributes('heading', { alinhamento })
                                        .run()
                                }
                            >
                                <IconeAlinhamento valor={alinhamento} />
                            </button>
                        ))}
                        <button
                            type="button"
                            aria-label="Desfazer"
                            title="Desfazer"
                            disabled={!editor.can().undo()}
                            onClick={() => editor.chain().focus().undo().run()}
                        >
                            <Undo2 size={16} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label="Refazer"
                            title="Refazer"
                            disabled={!editor.can().redo()}
                            onClick={() => editor.chain().focus().redo().run()}
                        >
                            <Redo2 size={16} aria-hidden="true" />
                        </button>
                    </>
                )}
                <button
                    type="button"
                    aria-label="Anexar imagem"
                    title="Anexar imagem"
                    disabled={enviando}
                    onClick={() => void anexar('imagem')}
                >
                    <ImagePlus size={16} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label="Anexar vídeo"
                    title="Anexar vídeo"
                    disabled={enviando}
                    onClick={() => void anexar('video')}
                >
                    <Video size={16} aria-hidden="true" />
                </button>
            </div>
            {enviando && <p role="status">Enviando anexo...</p>}
            {erro && <p role="alert">{erro}</p>}
            <EditorContent editor={editor} />
        </div>
    );
}
