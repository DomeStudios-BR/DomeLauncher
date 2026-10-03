import { alinhamentoSeguro, larguraSegura } from './formatacaoMidia';
import type { ComponentProps } from 'react';

export function ImagemMidiaMarkdown({
    src,
    alt,
    className,
    width,
    alinhamento,
    emLinha = false,
}: ComponentProps<'img'> & { alinhamento?: unknown; emLinha?: boolean }) {
    const seguro = typeof src === 'string' && /^https:\/\//i.test(src) ? src : undefined;
    const largura = larguraSegura(width);
    const align = alinhamentoSeguro(alinhamento);
    const estilo = {
        maxWidth: '100%',
        maxHeight: 480,
        width: largura,
        height: 'auto',
        display: emLinha ? 'block' : align ? 'inline-block' : undefined,
        marginLeft: align ? 0 : undefined,
        marginRight: align ? 0 : undefined,
    };
    const midia =
        seguro && /\/api\/launcher\/modpacks\/midias\/[a-f0-9-]+\.(mp4|webm)$/.test(seguro) ? (
            <video src={seguro} controls preload="metadata" style={estilo} />
        ) : (
            <img className={className} src={seguro} alt={alt ?? ''} loading="lazy" style={estilo} />
        );
    if (emLinha) {
        return (
            <span style={{
                display: align ? 'flex' : 'inline-flex',
                justifyContent: align ? { left: 'flex-start', center: 'center', right: 'flex-end' }[align] : undefined,
                verticalAlign: 'middle',
                maxWidth: '100%',
                margin: 4,
            }}>
                {midia}
            </span>
        );
    }
    return align ? <span style={{ display: 'block', textAlign: align }}>{midia}</span> : midia;
}

export function LinkMidiaMarkdown({ href, children, ...props }: ComponentProps<'a'>) {
    const seguro = href && /^https:\/\//i.test(href) ? href : undefined;
    if (seguro && /\/api\/launcher\/modpacks\/midias\/[a-f0-9-]+\.(mp4|webm)$/.test(seguro)) {
        return <video src={seguro} controls preload="metadata" style={{ width: '100%', maxHeight: 480 }} />;
    }
    return (
        <a {...props} href={seguro} target="_blank" rel="noreferrer">
            {children}
        </a>
    );
}
