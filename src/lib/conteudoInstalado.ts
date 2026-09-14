function normalizarIdentificadorConteudo(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function arquivoPodePertencerAoProjeto(nomeArquivo: string, slugProjeto: string): boolean {
  const slug = normalizarIdentificadorConteudo(slugProjeto);
  if (!slug) return false;

  const nomeSemExtensao = nomeArquivo
    .replace(/\.disabled$/i, "")
    .replace(/\.(jar|zip)$/i, "");
  const nomeNormalizado = normalizarIdentificadorConteudo(nomeSemExtensao);
  return nomeNormalizado === slug || nomeNormalizado.startsWith(`${slug}-`);
}
