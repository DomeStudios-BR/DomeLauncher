import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

interface ParametrosImportacao {
    instanceId: string;
    tipo: "mods" | "resourcepacks" | "shaders";
    habilitada: boolean;
    aoImportar: () => Promise<void>;
}

interface ResultadoImportacao {
    adicionados: string[];
    erros: string[];
}

export function useImportacaoConteudoLocal(parametros: ParametrosImportacao) {
    const areaRef = useRef<HTMLDivElement>(null);
    const parametrosRef = useRef(parametros);
    parametrosRef.current = parametros;
    const importandoRef = useRef(false);
    const [arrastando, setArrastando] = useState(false);
    const [importando, setImportando] = useState(false);
    const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

    useEffect(() => {
        setArrastando(false);
        setResultado(null);
    }, [parametros.instanceId, parametros.tipo, parametros.habilitada]);

    useEffect(() => {
        if (!isTauri()) return;
        let encerrado = false;
        let removerListener: (() => void) | undefined;
        void getCurrentWebview().onDragDropEvent(async ({ payload }) => {
            if (encerrado) return;
            const atual = parametrosRef.current;
            if (!atual.habilitada || importandoRef.current || payload.type === "leave") {
                setArrastando(false);
                return;
            }
            const area = areaRef.current?.getBoundingClientRect();
            const x = payload.position.x / window.devicePixelRatio;
            const y = payload.position.y / window.devicePixelRatio;
            const dentro = Boolean(area && x >= area.left && x <= area.right && y >= area.top && y <= area.bottom);
            setArrastando(dentro && payload.type !== "drop");
            if (!dentro || payload.type !== "drop") return;
            importandoRef.current = true;
            setImportando(true);
            setResultado(null);
            try {
                const resposta = await invoke<ResultadoImportacao>("importar_conteudo_local", {
                    instanceId: atual.instanceId,
                    contentType: atual.tipo,
                    caminhos: payload.paths,
                });
                if (encerrado || parametrosRef.current.instanceId !== atual.instanceId) return;
                if (parametrosRef.current.tipo === atual.tipo) setResultado(resposta);
                await atual.aoImportar();
            } catch (erro) {
                if (!encerrado && parametrosRef.current.instanceId === atual.instanceId
                    && parametrosRef.current.tipo === atual.tipo) {
                    setResultado({ adicionados: [], erros: [String(erro)] });
                }
            } finally {
                importandoRef.current = false;
                if (!encerrado) setImportando(false);
            }
        }).then((remover) => {
            if (encerrado) remover();
            else removerListener = remover;
        }).catch((erro) => {
            if (!encerrado) setResultado({ adicionados: [], erros: [`Arrastar arquivos indisponível: ${erro}`] });
        });
        return () => {
            encerrado = true;
            removerListener?.();
        };
    }, []);

    return { areaRef, arrastando, importando, resultado };
}
