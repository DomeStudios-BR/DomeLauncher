interface ItemPlanoHierarquico {
  chave: string;
  nome: string;
  tipoProjeto: "mod" | "resourcepack" | "shader";
  requeridoPor: string[];
  selecionado: boolean;
}

export interface OcorrenciaPlanoInstalacao<T extends ItemPlanoHierarquico> {
  item: T;
  numero: string;
  nivel: number;
  chaveOcorrencia: string;
}

const normalizarNome = (nome: string): string => nome.trim().toLocaleLowerCase("pt-BR");

export function organizarPlanoInstalacao<T extends ItemPlanoHierarquico>(
  plano: T[],
  tipoProjeto: ItemPlanoHierarquico["tipoProjeto"]
): OcorrenciaPlanoInstalacao<T>[] {
  const itens = plano.filter((item) => item.tipoProjeto === tipoProjeto);
  if (tipoProjeto !== "mod") {
    return itens.map((item, indice) => ({
      item,
      numero: String(indice + 1),
      nivel: 0,
      chaveOcorrencia: `${indice + 1}:${item.chave}`,
    }));
  }

  const principais = itens.filter((item) => item.selecionado);
  const dependenciasPorRequerente = new Map<string, T[]>();
  for (const item of itens) {
    for (const requerente of item.requeridoPor) {
      const chave = normalizarNome(requerente);
      const dependencias = dependenciasPorRequerente.get(chave) || [];
      if (!dependencias.some((dependencia) => dependencia.chave === item.chave)) {
        dependencias.push(item);
      }
      dependenciasPorRequerente.set(chave, dependencias);
    }
  }

  const ocorrencias: OcorrenciaPlanoInstalacao<T>[] = [];
  const dependenciasVinculadas = new Set<string>();
  const adicionarDependencias = (
    pai: T,
    prefixo: string,
    nivel: number,
    caminho: Set<string>
  ) => {
    const dependencias = dependenciasPorRequerente.get(normalizarNome(pai.nome)) || [];
    let indiceDependencia = 0;
    for (const dependencia of dependencias) {
      if (caminho.has(dependencia.chave)) continue;

      indiceDependencia += 1;
      const numero = `${prefixo}.${indiceDependencia}`;
      ocorrencias.push({
        item: dependencia,
        numero,
        nivel,
        chaveOcorrencia: `${numero}:${dependencia.chave}`,
      });
      dependenciasVinculadas.add(dependencia.chave);
      adicionarDependencias(
        dependencia,
        numero,
        nivel + 1,
        new Set([...caminho, dependencia.chave])
      );
    }
  };

  principais.forEach((principal, indice) => {
    const numero = String(indice + 1);
    ocorrencias.push({
      item: principal,
      numero,
      nivel: 0,
      chaveOcorrencia: `${numero}:${principal.chave}`,
    });
    adicionarDependencias(principal, numero, 1, new Set([principal.chave]));
  });

  const dependenciasSemVinculo = itens.filter(
    (item) => !item.selecionado && !dependenciasVinculadas.has(item.chave)
  );
  dependenciasSemVinculo.forEach((item, indice) => {
    const numero = String(principais.length + indice + 1);
    ocorrencias.push({
      item,
      numero,
      nivel: 0,
      chaveOcorrencia: `${numero}:${item.chave}`,
    });
  });

  return ocorrencias;
}
