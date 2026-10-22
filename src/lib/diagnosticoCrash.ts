export const EVENTO_DIAGNOSTICO_CRASH = "dome:diagnostico-crash";

export interface DiagnosticoCrash {
    instanceId: string;
    estado: "emExecucao" | "normal" | "interrompido" | "indeterminado" | "crash";
    codigoSaida: number | null;
    resumo: string;
    origem: string | null;
    mods: Array<{
        nome: string;
        arquivo: string;
        confianca: "alta" | "média";
        evidencias: string[];
        relacao?: "chamada" | "alvoMixin";
    }>;
    arquivos: string[];
    avisos: string[];
}
