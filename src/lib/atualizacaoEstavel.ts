interface PublicacaoConteudo {
    id?: string;
    version_type?: string;
    version_number?: string;
    files?: { filename?: string; url?: string; primary?: boolean }[];
}

interface ConteudoInstalado {
    fileName: string;
    versionId?: string;
}

function localizarPublicacaoInstalada(versoes: PublicacaoConteudo[], instalado: ConteudoInstalado): number {
    if (instalado.versionId) {
        const indicePorId = versoes.findIndex((versao) => versao.id === instalado.versionId);
        if (indicePorId >= 0) return indicePorId;
    }
    const nomeAtual = instalado.fileName.replace(/\.disabled$/i, "").toLowerCase();
    return versoes.findIndex((versao) =>
        versao.files?.some((arquivo) => arquivo.filename?.toLowerCase() === nomeAtual));
}

/**
 * Seleciona a publicação release mais recente que o conteúdo instalado, na lista cronológica do Modrinth.
 * Use para sugerir atualizações automáticas: betas e alphas ficam restritas à escolha manual.
 * A versão instalada é localizada pelo `versionId` identificado por hash e, sem ele, pelo nome do arquivo.
 */
export function selecionarAtualizacaoEstavel(
    publicacoes: unknown,
    instalado: ConteudoInstalado
): PublicacaoConteudo | null {
    if (!Array.isArray(publicacoes)) return null;
    const versoes = publicacoes.filter((item): item is PublicacaoConteudo =>
        item !== null && typeof item === "object" && Array.isArray(item.files));
    const indiceAtual = localizarPublicacaoInstalada(versoes, instalado);
    const candidatas = indiceAtual >= 0 ? versoes.slice(0, indiceAtual) : versoes;
    return candidatas.find((versao) => versao.version_type === "release") ?? null;
}
