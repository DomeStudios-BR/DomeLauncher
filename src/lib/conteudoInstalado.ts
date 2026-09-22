function normalizarIdentificadorConteudo(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface ConteudoComDependencias {
  fileName: string;
  identificadores: string[];
  dependencias: string[];
}

export function expandirSelecaoComDependentes(
  arquivosMarcados: Set<string>,
  mods: ConteudoComDependencias[]
): Set<string> {
  const selecionados = new Set(arquivosMarcados);
  const identificadoresSelecionados = new Set(
    mods
      .filter((mod) => selecionados.has(mod.fileName))
      .flatMap((mod) => mod.identificadores.map((identificador) => identificador.toLowerCase()))
  );

  let encontrouDependente = true;
  while (encontrouDependente) {
    encontrouDependente = false;
    for (const mod of mods) {
      if (selecionados.has(mod.fileName)) continue;
      const dependeDeSelecionado = mod.dependencias.some((dependencia) =>
        identificadoresSelecionados.has(dependencia.toLowerCase())
      );
      if (!dependeDeSelecionado) continue;

      selecionados.add(mod.fileName);
      mod.identificadores.forEach((identificador) =>
        identificadoresSelecionados.add(identificador.toLowerCase())
      );
      encontrouDependente = true;
    }
  }

  return selecionados;
}

export function arquivoPodePertencerAoProjeto(nomeArquivo: string, slugProjeto: string): boolean {
  const slug = normalizarIdentificadorConteudo(slugProjeto);
  if (!slug) return false;

  const nomeSemExtensao = nomeArquivo
    .replace(/\.disabled$/i, "")
    .replace(/\.(jar|zip)$/i, "");
  const nomeNormalizado = normalizarIdentificadorConteudo(nomeSemExtensao);
  if (nomeNormalizado === slug || nomeNormalizado.startsWith(`${slug}-`)) return true;

  const slugCompacto = slug.replace(/-/g, "");
  const nomeCompacto = nomeNormalizado.replace(/-/g, "");
  return slugCompacto.length >= 4 && nomeCompacto.startsWith(slugCompacto);
}
