import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function ConfirmacaoExclusaoModpack({ titulo, descricao, ocupado, erro, confirmar, cancelar }: {
    titulo: string;
    descricao: string;
    ocupado: boolean;
    erro: string;
    confirmar: () => void;
    cancelar: () => void;
}) {
    const dialogo = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const elemento = dialogo.current;
        const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        elemento?.showModal();
        return () => {
            elemento?.close();
            if (anterior?.isConnected) anterior.focus();
        };
    }, []);
    return createPortal(
        <dialog
            ref={dialogo}
            className="modpacks-confirmacao"
            aria-labelledby="titulo-exclusao-modpack"
            aria-describedby="descricao-exclusao-modpack"
            onCancel={(evento) => { evento.preventDefault(); if (!ocupado) cancelar(); }}
        >
            <h3 id="titulo-exclusao-modpack">{titulo}</h3>
            <p id="descricao-exclusao-modpack">{descricao}</p>
            {erro && <p role="alert" className="modpacks-erro">{erro}</p>}
            <div className="modpacks-acoes">
                <button autoFocus className="modpacks-botao" disabled={ocupado} onClick={cancelar}>Cancelar</button>
                <button
                    className="modpacks-botao modpacks-botao--perigo"
                    disabled={ocupado}
                    onClick={confirmar}
                >
                    {ocupado ? 'Excluindo...' : 'Excluir definitivamente'}
                </button>
            </div>
        </dialog>,
        document.body,
    );
}
