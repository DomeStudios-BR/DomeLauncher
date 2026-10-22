import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Engrenagem, Loader2, Save } from "../../iconesPixelados";
import SecaoConfiguracao from "./SecaoConfiguracao";

type ValoresOpcoes = Record<string, string>;

const OPCOES_NUMERICAS = [
    { chave: "renderDistance", nome: "Distância de renderização", min: 2, max: 64, step: 1, unidade: "chunks" },
    { chave: "maxFps", nome: "Limite de FPS", min: 0, max: 260, step: 1, unidade: "260 = ilimitado" },
    { chave: "fov", nome: "Campo de visão", min: 30, max: 110, step: 1, unidade: "graus" },
    { chave: "gamma", nome: "Brilho", min: 0, max: 100, step: 1, unidade: "%" },
    { chave: "mouseSensitivity", nome: "Sensibilidade do mouse", min: 0, max: 200, step: 1, unidade: "%" },
    { chave: "guiScale", nome: "Escala da interface", min: 0, max: 16, step: 1, unidade: "0 = automática" },
    { chave: "soundCategory_master", nome: "Volume geral", min: 0, max: 100, step: 1, unidade: "%" },
    { chave: "soundCategory_music", nome: "Música", min: 0, max: 100, step: 1, unidade: "%" },
] as const;

const OPCOES_BOOLEANAS = [
    { chave: "fullscreen", nome: "Tela cheia" },
    { chave: "autoJump", nome: "Pulo automático" },
    { chave: "invertYMouse", nome: "Inverter eixo Y do mouse" },
] as const;

function converterValor(chave: string, valor: string, paraJogo: boolean): string {
    if (!valor) return "";
    const numero = Number(valor);
    if (chave === "fov") return String(paraJogo ? (numero - 70) / 40 : Math.round(numero * 40 + 70));
    const escala = chave === "mouseSensitivity" ? 200
        : ["gamma", "soundCategory_master", "soundCategory_music", "sound", "music"].includes(chave) ? 100 : 1;
    return String(paraJogo ? numero / escala : Math.round(numero * escala));
}

export default function OpcoesJogo({ instanceId }: { instanceId: string }) {
    const [valores, setValores] = useState<ValoresOpcoes>({});
    const [alteracoes, setAlteracoes] = useState<ValoresOpcoes>({});
    const [entradasNumericas, setEntradasNumericas] = useState<ValoresOpcoes>({});
    const [carregando, setCarregando] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [salvo, setSalvo] = useState(false);
    const [tentativa, setTentativa] = useState(0);
    const formularioRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        let encerrado = false;
        setCarregando(true);
        setAlteracoes({});
        setEntradasNumericas({});
        setSalvo(false);
        setErro(null);
        void invoke<ValoresOpcoes>("obter_configuracoes_jogo", { instanceId }).then((opcoes) => {
            if (!encerrado) setValores(opcoes);
        }).catch((falha) => {
            if (!encerrado) setErro(String(falha));
        }).finally(() => {
            if (!encerrado) setCarregando(false);
        });
        return () => { encerrado = true; };
    }, [instanceId, tentativa]);

    const alterar = useCallback((chave: string, valor: string) => {
        setSalvo(false);
        setAlteracoes((anteriores) => {
            const novas = { ...anteriores };
            if (valor === (valores[chave] ?? "")) delete novas[chave];
            else novas[chave] = valor;
            return novas;
        });
    }, [valores]);

    const atualizarEntradaNumerica = useCallback((chave: string, valor: string) => {
        setEntradasNumericas((anteriores) => ({ ...anteriores, [chave]: valor }));
        alterar(chave, converterValor(chave, valor, true));
    }, [alterar]);

    useEffect(() => {
        const formulario = formularioRef.current;
        if (!formulario) return;

        const ajustarPorRolagem = (evento: WheelEvent) => {
            const campo = evento.target;
            if (!(campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement)) return;
            if (campo.matches(":disabled") || evento.deltaY === 0 || evento.ctrlKey) return;
            const opcao = OPCOES_NUMERICAS.find((item) => item.chave === campo.dataset.opcaoNumerica);
            if (!opcao) return;

            evento.preventDefault();
            const atual = campo.value === "" ? opcao.min - opcao.step : Number(campo.value);
            const proximo = atual + (evento.deltaY < 0 ? opcao.step : -opcao.step);
            const valor = proximo < opcao.min ? "" : String(Math.min(opcao.max, proximo));
            atualizarEntradaNumerica(campo.name, valor);
        };

        formulario.addEventListener("wheel", ajustarPorRolagem, { passive: false });
        return () => formulario.removeEventListener("wheel", ajustarPorRolagem);
    }, [carregando, atualizarEntradaNumerica]);

    const salvar = async (evento: React.FormEvent<HTMLFormElement>) => {
        evento.preventDefault();
        setSalvando(true);
        setErro(null);
        try {
            const opcoes = await invoke<ValoresOpcoes>("salvar_configuracoes_jogo", { instanceId, alteracoes });
            setValores(opcoes);
            setAlteracoes({});
            setEntradasNumericas({});
            setSalvo(true);
        } catch (falha) {
            setErro(String(falha));
        } finally {
            setSalvando(false);
        }
    };

    const classeCampo = "w-full border border-white/10 bg-[#202020] px-3 py-2 text-sm text-white/80 "
        + "outline-none focus:border-emerald-400/40 disabled:opacity-40";

    return (
        <SecaoConfiguracao titulo="Opções do Minecraft" icone={<Engrenagem size={15} />}>
            {carregando ? (
                <p role="status" className="flex items-center gap-2 p-5 text-xs text-white/50">
                    <Loader2 size={14} className="animate-spin" /> Carregando opções…
                </p>
            ) : (
                <form ref={formularioRef} onSubmit={salvar} className="space-y-4 p-5">
                    <fieldset disabled={salvando} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {OPCOES_NUMERICAS.map((opcao) => {
                            const chave = opcao.chave === "soundCategory_master" && "sound" in valores ? "sound"
                                : opcao.chave === "soundCategory_music" && "music" in valores ? "music" : opcao.chave;
                            const usarSelecao = chave === "renderDistance" || chave === "maxFps";
                            const quantidadeValores = (opcao.max - opcao.min) / opcao.step + 1;
                            const valor = entradasNumericas[chave]
                                ?? converterValor(chave, valores[chave] ?? "", false);
                            return (
                                <label key={chave} className="space-y-1.5 text-xs text-white/60">
                                    <span className="block">{opcao.nome}</span>
                                    {usarSelecao ? (
                                        <select
                                            aria-label={opcao.nome}
                                            name={chave}
                                            data-opcao-numerica={opcao.chave}
                                            value={valor}
                                            onChange={(evento) => atualizarEntradaNumerica(chave, evento.target.value)}
                                            className={classeCampo}
                                        >
                                            <option value="">Padrão do jogo</option>
                                            {Array.from({ length: quantidadeValores }, (_, indice) => {
                                                const numero = opcao.min + indice * opcao.step;
                                                const rotulo = chave === "renderDistance" ? `${numero} chunks`
                                                    : numero === opcao.max ? "Ilimitado" : `${numero} FPS`;
                                                return <option key={numero} value={numero}>{rotulo}</option>;
                                            })}
                                        </select>
                                    ) : <input
                                        aria-label={opcao.nome}
                                        name={chave}
                                        data-opcao-numerica={opcao.chave}
                                        type="number"
                                        min={opcao.min}
                                        max={opcao.max}
                                        step={opcao.step}
                                        placeholder="Padrão do jogo"
                                        value={valor}
                                        onChange={(evento) => atualizarEntradaNumerica(chave, evento.target.value)}
                                        className={classeCampo}
                                    />}
                                    {!usarSelecao && (
                                        <span className="block text-[10px] text-white/30">{opcao.unidade}</span>
                                    )}
                                </label>
                            );
                        })}
                        {OPCOES_BOOLEANAS.map(({ chave, nome }) => (
                            <label key={chave} className="space-y-1.5 text-xs text-white/60">
                                <span className="block">{nome}</span>
                                <select
                                    value={alteracoes[chave] ?? valores[chave] ?? ""}
                                    onChange={(evento) => alterar(chave, evento.target.value)}
                                    className={classeCampo}
                                >
                                    <option value="">Padrão do jogo</option>
                                    <option value="true">Ativado</option>
                                    <option value="false">Desativado</option>
                                </select>
                            </label>
                        ))}
                    </fieldset>
                    <div className="flex flex-wrap items-center gap-3 border-t border-white/8 pt-4">
                        <button
                            type="submit"
                            disabled={salvando || Object.keys(alteracoes).length === 0}
                            className="flex items-center gap-2 bg-emerald-500 px-4 py-2 text-xs font-bold text-black
                                hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {salvando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            Salvar opções
                        </button>
                        {salvo && <p role="status" className="text-xs text-emerald-300">Opções salvas.</p>}
                    </div>
                    {erro && (
                        <div role="alert" className="text-xs text-red-300">
                            <p>{erro}</p>
                            <button type="button" onClick={() => setTentativa((anterior) => anterior + 1)}
                                className="mt-2 underline">Recarregar opções</button>
                        </div>
                    )}
                </form>
            )}
        </SecaoConfiguracao>
    );
}
