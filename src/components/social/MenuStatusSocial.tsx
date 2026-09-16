import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from '../../iconesPixelados';
import { cn } from '../../lib/utils';
import { IndicadorStatusSocial } from './IndicadorStatusSocial';
import type { StatusPresenca } from './tiposSocial';

interface MenuStatusSocialProps {
    nome: string;
    statusManual: Exclude<StatusPresenca, 'offline'>;
    aparecerOffline: boolean;
    salvando: boolean;
    onAtualizar: (status: Exclude<StatusPresenca, 'offline'>, invisivel: boolean) => void;
    emblemaDestaque?: {
        imagemUrl: string;
        nome: string;
        descricao: string;
    } | null;
}

export function MenuStatusSocial({
    nome,
    statusManual,
    aparecerOffline,
    salvando,
    onAtualizar,
    emblemaDestaque,
}: MenuStatusSocialProps) {
    const [aberto, setAberto] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!aberto) return;

        const aoClicarFora = (evento: MouseEvent) => {
            if (!containerRef.current?.contains(evento.target as Node)) setAberto(false);
        };

        window.addEventListener('mousedown', aoClicarFora);
        return () => window.removeEventListener('mousedown', aoClicarFora);
    }, [aberto]);

    return (
        <div ref={containerRef} className="relative min-w-0">
            <button
                type="button"
                onClick={() => setAberto((anterior) => !anterior)}
                disabled={salvando}
                className="flex max-w-full items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-55"
                aria-label="Alterar presença"
            >
                <span className="truncate text-[17px] font-semibold leading-none text-white/95">{nome}</span>
                {emblemaDestaque && (
                    <img
                        src={emblemaDestaque.imagemUrl}
                        alt={`Destaque: ${emblemaDestaque.nome}`}
                        title={`${emblemaDestaque.nome} — ${emblemaDestaque.descricao}`}
                        className="h-5 w-5 shrink-0 object-contain"
                    />
                )}
                <IndicadorStatusSocial
                    status={aparecerOffline ? 'offline' : statusManual}
                    className="h-2.5 w-2.5"
                />
                <ChevronDown size={10} className={cn('shrink-0 text-white/30 transition-transform', aberto && 'rotate-180')} />
            </button>

            {aberto && (
                <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-36 border border-white/12 bg-[#101010] p-1 shadow-2xl">
                    {([
                        { status: 'online' as const, invisivel: false, rotulo: 'Disponível' },
                        { status: 'ausente' as const, invisivel: false, rotulo: 'Ausente' },
                        { status: statusManual, invisivel: true, rotulo: 'Invisível' },
                    ]).map((opcao) => {
                        const selecionada = opcao.invisivel
                            ? aparecerOffline
                            : !aparecerOffline && statusManual === opcao.status;

                        return (
                            <button
                                key={opcao.rotulo}
                                type="button"
                                onClick={() => {
                                    onAtualizar(opcao.status, opcao.invisivel);
                                    setAberto(false);
                                }}
                                className={cn(
                                    'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] transition-colors',
                                    selecionada ? 'bg-white/[0.07] text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white/80'
                                )}
                            >
                                <IndicadorStatusSocial
                                    status={opcao.invisivel ? 'offline' : opcao.status}
                                    className="h-2.5 w-2.5"
                                />
                                {opcao.rotulo}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
