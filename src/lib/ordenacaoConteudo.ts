export type CampoOrdenacaoConteudo = "name" | "enabled" | "version";
export interface OrdenacaoConteudo {
    campo: CampoOrdenacaoConteudo;
    decrescente: boolean;
    atualizacoesPrimeiro?: boolean;
}

interface ConteudoOrdenavel {
    name: string;
    version: string;
    enabled: boolean;
    fileName: string;
    updateAvailable?: boolean;
}

const comparador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

export function ordenarConteudo<T extends ConteudoOrdenavel>(itens: T[], ordem: OrdenacaoConteudo): T[] {
    return [...itens].sort((primeiro, segundo) => {
        if (ordem.atualizacoesPrimeiro) {
            const atualizacao = Number(Boolean(segundo.updateAvailable)) - Number(Boolean(primeiro.updateAvailable));
            if (atualizacao !== 0) return atualizacao;
        }
        const diferenca = ordem.campo === "enabled"
            ? Number(segundo.enabled) - Number(primeiro.enabled)
            : comparador.compare(primeiro[ordem.campo], segundo[ordem.campo]);
        return diferenca * (ordem.decrescente ? -1 : 1)
            || comparador.compare(primeiro.name, segundo.name)
            || comparador.compare(primeiro.fileName, segundo.fileName);
    });
}
