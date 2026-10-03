import type { ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';
import { alinhamentoSeguro } from './formatacaoMidia';
import { ImagemMidiaMarkdown, LinkMidiaMarkdown } from './LinkMidiaMarkdown';
import './EditorDescricaoModpack.css';

function urlHttpsSegura(valor?: string): string | undefined {
    if (!valor) return undefined;
    try {
        const url = new URL(valor);
        return url.protocol === "https:" ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

const COMPONENTES_MARKDOWN: Components = {
    h1: ({ children, node }) => (
        <h1 style={{ textAlign: alinhamentoSeguro(node?.properties.align) }}
            className="mt-6 text-2xl font-black text-white first:mt-0">
            {children}
        </h1>
    ),
    h2: ({ children, node }) => (
        <h2 style={{ textAlign: alinhamentoSeguro(node?.properties.align) }}
            className="mt-5 text-xl font-black text-white first:mt-0">
            {children}
        </h2>
    ),
    h3: ({ children, node }) => (
        <h3 style={{ textAlign: alinhamentoSeguro(node?.properties.align) }}
            className="mt-4 text-lg font-bold text-white first:mt-0">
            {children}
        </h3>
    ),
    p: ({ children, node }) => (
        <p style={{ textAlign: alinhamentoSeguro(node?.properties.align) }} className="leading-7 text-white/85">
            {children}
        </p>
    ),
    strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
    em: ({ children }) => <em className="text-white/80 italic">{children}</em>,
    a: ({ href, children }) => (
        <LinkMidiaMarkdown href={urlHttpsSegura(href)}
            className="text-sky-300 underline underline-offset-2 hover:text-sky-200">{children}</LinkMidiaMarkdown>
    ),
    ul: ({ children }) => <ul className="list-disc space-y-1 pl-6 text-white/85">{children}</ul>,
    ol: ({ children }) => (
        <ol className="list-decimal space-y-1 pl-6 text-white/85">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-6">{children}</li>,
    blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-white/20 pl-4 text-white/70 italic">
            {children}
        </blockquote>
    ),
    code: ({ children, className }) => (
        <code className={cn("rounded bg-black/45 px-1.5 py-0.5 text-xs text-white", className)}>
            {children}
        </code>
    ),
    pre: ({ children }) => (
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3 text-xs text-white">
            {children}
        </pre>
    ),
    img: ({ src, alt, width, node }) => (
        <ImagemMidiaMarkdown src={src} alt={alt} width={width} alinhamento={node?.properties.align}
            className={'mx-auto my-3 h-auto max-h-[420px] w-auto max-w-full '
                + 'rounded-xl border border-white/10 bg-black/35 object-contain'} />
    ),
};

function blocoDescricao(
    Tag: 'h1' | 'h2' | 'h3' | 'p' | 'strong' | 'em' | 'ul' | 'ol' | 'li' | 'blockquote' | 'pre' | 'code',
) {
    return ({ children, node }: ExtraProps & { children?: ReactNode }) => (
        <Tag style={{ textAlign: alinhamentoSeguro(node?.properties.align) }}>{children}</Tag>
    );
}

const COMPONENTES_EDITOR: Components = {
    h1: blocoDescricao('h1'),
    h2: blocoDescricao('h2'),
    h3: blocoDescricao('h3'),
    p: blocoDescricao('p'),
    strong: blocoDescricao('strong'),
    em: blocoDescricao('em'),
    ul: blocoDescricao('ul'),
    ol: blocoDescricao('ol'),
    li: blocoDescricao('li'),
    blockquote: blocoDescricao('blockquote'),
    pre: blocoDescricao('pre'),
    code: blocoDescricao('code'),
    a: ({ href, children }) => <LinkMidiaMarkdown href={urlHttpsSegura(href)}>{children}</LinkMidiaMarkdown>,
    img: ({ src, alt, width, node }) => (
        <ImagemMidiaMarkdown
            src={src}
            alt={alt}
            width={width}
            alinhamento={node?.properties.align}
            emLinha
        />
    ),
};

export function DescricaoProjetoMarkdown({
    conteudo,
    formatoEditor = false,
}: { conteudo: string; formatoEditor?: boolean }) {
    return (
        <div className={formatoEditor ? 'modpacks-descricao-publicada' : 'space-y-4'}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSanitize]}
                components={formatoEditor ? COMPONENTES_EDITOR : COMPONENTES_MARKDOWN}
            >
                {conteudo}
            </ReactMarkdown>
        </div>
    );
}
