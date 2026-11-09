import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Package } from "../iconesPixelados";
import type { FonteProjetoConteudo, ProjetoConteudo, TipoProjetoConteudo } from "./ProjetoDetalheModal";

interface ConteudoRelacionado {
    nome: string;
    versao: string;
    arquivo: string;
    icone?: string;
    projetoId?: string;
    fonte?: FonteProjetoConteudo;
    tipo?: TipoProjetoConteudo;
    obrigatoria?: boolean;
}

interface Propriedades {
    fonte: FonteProjetoConteudo;
    projetoId: string;
    versaoId?: string;
    numeroVersao: string;
    tipoProjeto: TipoProjetoConteudo;
    onAbrirProjeto?: (projeto: ProjetoConteudo) => void;
}

export function ConteudosRelacionadosProjeto(propriedades: Propriedades) {
    const { fonte, projetoId, versaoId, numeroVersao, tipoProjeto, onAbrirProjeto } = propriedades;
    const ehModpack = tipoProjeto === "modpack";
    const [conteudos, setConteudos] = useState<ConteudoRelacionado[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [tentativa, setTentativa] = useState(0);
    const classeNome = ehModpack ? "line-clamp-2 break-words text-sm font-bold text-white/90"
        : "break-words text-sm font-bold text-white/90";

    const abrirProjeto = (conteudo: ConteudoRelacionado) => {
        if (!conteudo.projetoId || !conteudo.fonte || !onAbrirProjeto) return;
        onAbrirProjeto({
            id: conteudo.projetoId, source: conteudo.fonte, project_type: conteudo.tipo ?? "mod",
            title: conteudo.nome, icon_url: conteudo.icone ?? "", slug: conteudo.projetoId,
            description: "", author: "",
        });
    };

    useEffect(() => {
        let cancelado = false;
        setCarregando(true);
        setErro(null);
        setConteudos([]);
        void invoke<ConteudoRelacionado[]>("listar_conteudos_versao_projeto", {
            fonte, projetoId, versaoId: versaoId ?? null, tipoProjeto,
        }).then((itens) => {
            if (!cancelado) setConteudos(itens);
        }).catch((falha: unknown) => {
            if (!cancelado) setErro(String(falha));
        }).finally(() => {
            if (!cancelado) setCarregando(false);
        });
        return () => { cancelado = true; };
    }, [fonte, projetoId, versaoId, tipoProjeto, tentativa]);

    return <section aria-label={ehModpack ? "Mods do modpack" : "Dependências da versão"}
        className="@container space-y-3">
        <p className="text-xs text-white/55">Versão {numeroVersao}</p>
        {carregando ? <div role="status" className="flex items-center gap-2 text-sm text-white/55">
            <Loader2 size={14} className="animate-spin" /> Carregando…
        </div> : erro ? <div role="alert" className="space-y-2 text-sm text-red-300">
            <p>{erro}</p>
            <button type="button" onClick={() => setTentativa((atual) => atual + 1)}
                className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white">Tentar novamente</button>
        </div> : conteudos.length === 0 ? <p className="text-sm text-white/55">
            {ehModpack ? "Nenhum mod listado nesta versão."
                : "Nenhuma dependência declarada nesta versão."}
        </p> : <ul className={ehModpack
            ? "grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2 @min-[56rem]:grid-cols-3"
            : "divide-y divide-white/5 rounded-xl border border-white/10 bg-black/20"}>
            {conteudos.map((conteudo, indice) => <li key={`${conteudo.arquivo}:${indice}`}
                className={ehModpack
                    ? "flex min-w-0 items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3"
                    : "flex min-w-0 items-center gap-3 px-4 py-3"}>
                {conteudo.icone ? <img src={conteudo.icone} alt="" loading="lazy"
                    className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                    : ehModpack && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
                        bg-white/5 text-white/35"><Package size={20} /></div>}
                <div className="min-w-0 flex-1">
                    {onAbrirProjeto && conteudo.projetoId && conteudo.fonte ? (
                        <button type="button" title={conteudo.nome} aria-label={`Abrir página de ${conteudo.nome}`}
                            onClick={() => abrirProjeto(conteudo)}
                            className={`${classeNome} text-left hover:text-emerald-300
                                focus-visible:outline-emerald-300`}>{conteudo.nome}</button>
                    ) : <p title={conteudo.nome} className={classeNome}>{conteudo.nome}</p>}
                    {((!ehModpack && conteudo.tipo) || conteudo.obrigatoria === false) && <p className="text-xs text-white/50">
                        {!ehModpack && conteudo.tipo
                            && ({ mod: "Mod", modpack: "Modpack", resourcepack: "Textura", shader: "Shader" })[conteudo.tipo]}
                        {conteudo.obrigatoria === false && `${!ehModpack && conteudo.tipo ? " · " : ""}Opcional`}
                    </p>}
                    {conteudo.arquivo && <p title={conteudo.arquivo} className={ehModpack
                        ? "mt-0.5 truncate text-xs text-white/45"
                        : "break-all text-xs text-white/45"}>{conteudo.arquivo}</p>}
                    {ehModpack && conteudo.versao && <span title={conteudo.versao}
                        className="mt-2 block truncate text-xs text-emerald-300">{conteudo.versao}</span>}
                </div>
                {!ehModpack && conteudo.versao && <span className="max-w-[35%] break-words text-xs text-emerald-300">
                    {conteudo.versao}
                </span>}
            </li>)}
        </ul>}
    </section>;
}
