export const EVENTO_PROGRESSO_IMPORTACAO_INSTANCIA = "importacao-instancia-progresso";

export interface DadosInstanciaImportavel {
    idExterno: string;
    launcher: string;
    nome: string;
    versaoMinecraft: string;
    loaderType?: string;
    loaderVersion?: string;
    icone?: string;
    caminhoOrigem: string;
    caminhoJogo: string;
}

export type EtapaImportacaoInstancia = "aguardando" | "preparando" | "copiando" | "concluida";

export interface ProgressoImportacaoInstancia {
    idExterno: string;
    etapa: Exclude<EtapaImportacaoInstancia, "aguardando">;
    arquivosCopiados: number;
    totalArquivos: number;
    porcentagem: number;
}

export interface InstanciaEmImportacao extends DadosInstanciaImportavel {
    etapa: EtapaImportacaoInstancia;
    arquivosCopiados: number;
    totalArquivos: number;
    porcentagem: number;
}

let instanciasEmImportacao: InstanciaEmImportacao[] = [];
let ouvintes: Array<() => void> = [];

function notificarOuvintes() {
    ouvintes.forEach((ouvinte) => ouvinte());
}

export function observarImportacoes(ouvinte: () => void) {
    ouvintes = [...ouvintes, ouvinte];
    return () => {
        ouvintes = ouvintes.filter((item) => item !== ouvinte);
    };
}

export function obterImportacoesEmAndamento(): InstanciaEmImportacao[] {
    return instanciasEmImportacao;
}

export function iniciarImportacoes(instancias: DadosInstanciaImportavel[]) {
    instanciasEmImportacao = instancias.map((instancia) => ({
        ...instancia,
        etapa: "aguardando",
        arquivosCopiados: 0,
        totalArquivos: 0,
        porcentagem: 0,
    }));
    notificarOuvintes();
}

export function atualizarProgressoImportacao(progresso: ProgressoImportacaoInstancia) {
    const indice = instanciasEmImportacao.findIndex(
        (instancia) => instancia.idExterno === progresso.idExterno
    );
    if (indice < 0) return;

    instanciasEmImportacao = instanciasEmImportacao.map((instancia, indiceAtual) =>
        indiceAtual === indice ? { ...instancia, ...progresso } : instancia
    );
    notificarOuvintes();
}

export function finalizarImportacoes() {
    instanciasEmImportacao = [];
    notificarOuvintes();
}
