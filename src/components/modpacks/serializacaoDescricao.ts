import type { JSONContent } from '@tiptap/core';
import { alinhamentoSeguro, larguraSegura, siteSeguro } from './formatacaoMidia';

function escaparHtml(valor: unknown): string {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function htmlImagemDescricao(atributos: Record<string, unknown> = {}): string {
    const largura = larguraSegura(atributos.width);
    const align = alinhamentoSeguro(atributos.align);
    const imagem =
        `<img src="${escaparHtml(siteSeguro(atributos.src))}" alt="${escaparHtml(atributos.alt)}"` +
        `${largura ? ` width="${largura}"` : ''}${align ? ` align="${align}"` : ''}>`;
    const href = siteSeguro(atributos.vinculo);
    return href ? `<a href="${escaparHtml(href)}">${imagem}</a>` : imagem;
}

export function htmlConteudoDescricao(conteudo: JSONContent[] = []): string {
    return conteudo
        .map((node) => {
            if (node.type === 'image') return htmlImagemDescricao(node.attrs);
            if (node.type === 'hardBreak') return '<br>';
            let texto = escaparHtml(node.text);
            for (const marca of node.marks ?? []) {
                const tag = { bold: 'strong', italic: 'em', strike: 's', code: 'code', underline: 'u' }[marca.type];
                if (tag) texto = `<${tag}>${texto}</${tag}>`;
                if (marca.type === 'link') {
                    const href = siteSeguro(marca.attrs?.href);
                    if (href) texto = `<a href="${escaparHtml(href)}">${texto}</a>`;
                }
            }
            return texto;
        })
        .join('');
}
