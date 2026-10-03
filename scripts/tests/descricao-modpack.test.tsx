import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DescricaoProjetoMarkdown } from '../../src/components/modpacks/DescricaoProjetoMarkdown';

const imagem = 'https://api.domestudios.com.br/api/launcher/modpacks/midias/imagem.jpg';

describe('descrição pública do editor de modpacks', () => {
    test('mantém imagem redimensionada em linha com o texto, inclusive em conteúdo já publicado', () => {
        for (const conteudo of [
            `<img src="${imagem}" width="84"> Texto ao lado`,
            `<p><img src="${imagem}" width="84"> Texto ao lado</p>`,
        ]) {
            const html = renderToStaticMarkup(<DescricaoProjetoMarkdown conteudo={conteudo} formatoEditor />);
            expect(html).toContain('display:inline-flex');
            expect(html).toContain('vertical-align:middle');
            expect(html).toContain('width:84px');
            expect(html).toContain('</span> Texto ao lado</p>');
            expect(html).not.toContain('mx-auto');
            expect(html).not.toContain('rounded-xl');
        }
    });

    test('preserva alinhamento, negrito, itálico e link ao lado da imagem', () => {
        const conteudo = `<p align="right"><a href="https://example.com"><img src="${imagem}" width="120"></a>`
            + ' <strong>Negrito</strong> e <em>itálico</em></p>';
        const html = renderToStaticMarkup(<DescricaoProjetoMarkdown conteudo={conteudo} formatoEditor />);
        expect(html).toContain('text-align:right');
        expect(html).toContain('width:120px');
        expect(html).toContain('href="https://example.com/"');
        expect(html).toContain('<strong>Negrito</strong>');
        expect(html).toContain('<em>itálico</em>');
    });

    test('preserva alinhamento explícito da mídia e limita a largura ao conteúdo', () => {
        const html = renderToStaticMarkup(<DescricaoProjetoMarkdown
            conteudo={`<p><img src="${imagem}" align="center" width="240"></p>`}
            formatoEditor
        />);
        expect(html).toContain('display:flex');
        expect(html).toContain('justify-content:center');
        expect(html).toContain('max-width:100%');
        expect(html).toContain('width:240px');
    });

    test('mantém sanitização de HTML e bloqueia URLs de execução', () => {
        const html = renderToStaticMarkup(<DescricaoProjetoMarkdown
            conteudo={'<script>alert(1)</script><p onclick="alert(1)" style="position:fixed">Seguro'
                + '<a href="javascript:alert(1)">Link</a><img src="javascript:alert(1)" onerror="alert(1)"></p>'}
            formatoEditor
        />);
        expect(html).not.toContain('<script');
        expect(html).not.toContain('onclick');
        expect(html).not.toContain('onerror');
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('position:fixed');
    });

    test('preserva apresentação existente dos projetos externos', () => {
        const html = renderToStaticMarkup(<DescricaoProjetoMarkdown conteudo={`![Imagem](${imagem})`} />);
        expect(html).toContain('mx-auto');
        expect(html).not.toContain('modpacks-descricao-publicada');
    });
});
