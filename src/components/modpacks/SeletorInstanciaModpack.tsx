import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from '../../iconesPixelados';
import type { Instance } from '../../hooks/useLauncher';

export function SeletorInstanciaModpack({
    instancias,
    instanciaId,
    selecionar,
}: {
    instancias: Instance[];
    instanciaId: string;
    selecionar: (id: string) => void;
}) {
    const [aberto, setAberto] = useState(false);
    const raiz = useRef<HTMLDivElement>(null);
    const botao = useRef<HTMLButtonElement>(null);
    const atual = instancias.find((instancia) => instancia.id === instanciaId);

    useEffect(() => {
        if (!aberto) return;
        const fecharFora = (evento: MouseEvent) => {
            if (!raiz.current?.contains(evento.target as Node)) setAberto(false);
        };
        document.addEventListener('mousedown', fecharFora);
        const opcoes = raiz.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
        const indice = Math.max(
            0,
            instancias.findIndex((instancia) => instancia.id === instanciaId),
        );
        opcoes?.[indice]?.focus();
        return () => document.removeEventListener('mousedown', fecharFora);
    }, [aberto, instancias, instanciaId]);

    function aoTeclar(evento: KeyboardEvent) {
        if (!aberto) return;
        if (evento.key === 'Escape') {
            evento.preventDefault();
            evento.stopPropagation();
            setAberto(false);
            botao.current?.focus();
            return;
        }
        const opcoes = Array.from(raiz.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
        const indice = opcoes.findIndex((opcao) => opcao === document.activeElement);
        const destino =
            evento.key === 'ArrowDown'
                ? (indice + 1) % opcoes.length
                : evento.key === 'ArrowUp'
                  ? (indice - 1 + opcoes.length) % opcoes.length
                  : evento.key === 'Home'
                    ? 0
                    : evento.key === 'End'
                      ? opcoes.length - 1
                      : null;
        if (destino === null) return;
        evento.preventDefault();
        opcoes[destino]?.focus();
    }

    function identidade(instancia: Instance) {
        return (
            <>
                <img src={instancia.icon || '/dome-launcher.ico'} alt="" />
                <span>
                    <strong>{instancia.name}</strong>
                    <small>{instancia.version}</small>
                </span>
            </>
        );
    }

    return (
        <div
            ref={raiz}
            className="modpacks-seletor"
            onKeyDown={aoTeclar}
            onBlur={(evento) => {
                if (!evento.currentTarget.contains(evento.relatedTarget)) setAberto(false);
            }}
        >
            <button
                ref={botao}
                type="button"
                className="modpacks-seletor-botao"
                aria-label="Instância da biblioteca"
                aria-haspopup="listbox"
                aria-expanded={aberto}
                disabled={!instancias.length}
                onClick={() => setAberto((valor) => !valor)}
            >
                {atual ? identidade(atual) : <span>Selecionar instância...</span>}
                <ChevronDown size={14} />
            </button>
            {aberto && (
                <div role="listbox" aria-label="Instâncias disponíveis" className="modpacks-menu-instancias">
                    {instancias.map((instancia) => (
                        <button
                            type="button"
                            role="option"
                            key={instancia.id}
                            tabIndex={-1}
                            aria-selected={instancia.id === instanciaId}
                            className="modpacks-instancia"
                            onClick={() => {
                                selecionar(instancia.id);
                                setAberto(false);
                                botao.current?.focus();
                            }}
                        >
                            {identidade(instancia)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
