import type { ItemPlanoInstalacaoConteudo } from "../components/instance/RevisaoInstalacaoConteudo";

export interface FalhaPlanoInstalacaoConteudo {
    chave: string;
    nome: string;
    motivo: string;
}

export interface PlanoInstalacaoConteudo {
    itens: ItemPlanoInstalacaoConteudo[];
    falhas: FalhaPlanoInstalacaoConteudo[];
}

export function formatarMotivoFalha(falha: FalhaPlanoInstalacaoConteudo): string {
    const prefixo = `${falha.nome}:`;
    return falha.motivo.startsWith(prefixo)
        ? falha.motivo.slice(prefixo.length).trimStart()
        : falha.motivo;
}

export async function executarFilaInstalacao(
    plano: ItemPlanoInstalacaoConteudo[],
    instalar: (item: ItemPlanoInstalacaoConteudo, indice: number) => Promise<void>,
) {
    const falhas = new Map<string, FalhaPlanoInstalacaoConteudo>();
    const instalados = new Set<string>();
    for (const [indice, item] of plano.entries()) {
        if (item.selecoes.every((chave) => falhas.has(chave))) continue;
        try {
            await instalar(item, indice);
            instalados.add(item.chave);
        } catch (erro) {
            for (const chave of item.selecoes) {
                if (falhas.has(chave)) continue;
                const principal = plano.find((candidato) => candidato.chave === chave);
                falhas.set(chave, {
                    chave,
                    nome: principal?.nome || item.nome,
                    motivo: `${item.nome}: ${String(erro)}`,
                });
            }
        }
    }
    const concluidos = new Set(plano
        .filter((item) => item.selecionado && instalados.has(item.chave) && !falhas.has(item.chave))
        .map((item) => item.chave));
    return { concluidos, falhas: [...falhas.values()] };
}
