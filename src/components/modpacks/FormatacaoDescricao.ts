import { htmlConteudoDescricao } from './serializacaoDescricao';
import { Extension } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';

import { alinhamentoSeguro } from './formatacaoMidia';

export const AlinhamentoDescricao = Extension.create({
    name: 'alinhamentoDescricao',
    addGlobalAttributes() {
        return [
            {
                types: ['paragraph', 'heading'],
                attributes: {
                    alinhamento: {
                        default: null,
                        parseHTML: (elemento) => alinhamentoSeguro(elemento.getAttribute('align')) ?? null,
                        renderHTML: (atributos) => {
                            const align = alinhamentoSeguro(atributos.alinhamento);
                            return align ? { align } : {};
                        },
                    },
                },
            },
        ];
    },
});

export const ParagrafoDescricao = Paragraph.extend({
    renderMarkdown(node, helpers, contexto) {
        if (node.attrs?.alinhamento || node.content?.some((item) => item.type === 'image')) {
            const align = alinhamentoSeguro(node.attrs?.alinhamento);
            return `<p${align ? ` align="${align}"` : ''}>${htmlConteudoDescricao(node.content)}</p>`;
        }
        return Paragraph.config.renderMarkdown?.call(this, node, helpers, contexto) ?? '';
    },
});

export const TituloDescricao = Heading.extend({
    renderMarkdown(node, helpers, contexto) {
        if (node.attrs?.alinhamento || node.content?.some((item) => item.type === 'image')) {
            const align = alinhamentoSeguro(node.attrs?.alinhamento);
            const tag = `h${node.attrs?.level ?? 2}`;
            return `<${tag}${align ? ` align="${align}"` : ''}>${htmlConteudoDescricao(node.content)}</${tag}>`;
        }
        return Heading.config.renderMarkdown?.call(this, node, helpers, contexto) ?? '';
    },
});
