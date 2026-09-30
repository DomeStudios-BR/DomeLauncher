import { listen } from "@tauri-apps/api/event";
import { EVENTO_INSTANCIAS_ATUALIZADAS } from "../lib/eventosTransferenciaSocial";

const EVENTO_PROGRESSO_EXCLUSAO_INSTANCIA = "instancia-exclusao-progresso";

export interface InstanciaParaExclusao {
    id: string;
    nome: string;
}

interface ProgressoExclusaoInstancia {
    id: string;
    etapa: "preparando" | "excluindo" | "concluida";
    itensExcluidos: number;
    totalItens: number;
    porcentagem: number;
}

export interface ExclusaoInstancia {
    chave: number;
    instancias: InstanciaParaExclusao[];
    indiceAtual: number;
    porcentagem: number;
    detalhe: string;
    situacao: "aguardando" | "excluindo" | "concluida" | "erro";
    erro?: string;
}

interface PedidoExclusao {
    chave: number;
    instancias: InstanciaParaExclusao[];
    aoExcluir: (id: string) => Promise<void>;
}

let exclusoes: ExclusaoInstancia[] = [];
let ouvintes = new Set<() => void>();
let fila: PedidoExclusao[] = [];
let processando = false;
let proximaChave = 1;

function atualizarExclusoes(proximas: ExclusaoInstancia[]) {
    exclusoes = proximas;
    ouvintes.forEach((ouvinte) => ouvinte());
}

function atualizarExclusao(chave: number, alteracoes: Partial<ExclusaoInstancia>) {
    atualizarExclusoes(exclusoes.map((exclusao) =>
        exclusao.chave === chave ? { ...exclusao, ...alteracoes } : exclusao
    ));
}

export function observarExclusoes(ouvinte: () => void) {
    ouvintes.add(ouvinte);
    return () => {
        ouvintes.delete(ouvinte);
    };
}

export function obterExclusoes(): ExclusaoInstancia[] {
    return exclusoes;
}

export function dispensarExclusao(chave: number) {
    atualizarExclusoes(exclusoes.filter((exclusao) =>
        exclusao.chave !== chave || !["concluida", "erro"].includes(exclusao.situacao)
    ));
}

function atualizarProgresso(pedido: PedidoExclusao, indice: number, progresso: ProgressoExclusaoInstancia) {
    if (progresso.id !== pedido.instancias[indice]?.id) return;

    const porcentagemItem = Math.max(0, Math.min(100, progresso.porcentagem));
    const porcentagem = Math.round((indice * 100 + porcentagemItem) / pedido.instancias.length);
    const detalhe = progresso.etapa === "preparando"
        ? "Mapeando arquivos..."
        : progresso.etapa === "concluida"
            ? "Finalizando exclusão..."
            : `${progresso.itensExcluidos} de ${progresso.totalItens} itens removidos`;

    atualizarExclusao(pedido.chave, { porcentagem, detalhe });
}

async function executarPedido(pedido: PedidoExclusao) {
    let indiceAtual = 0;

    try {
        const removerEscuta = await listen<ProgressoExclusaoInstancia>(
            EVENTO_PROGRESSO_EXCLUSAO_INSTANCIA,
            ({ payload }) => atualizarProgresso(pedido, indiceAtual, payload)
        );

        try {
            for (const [indice, instancia] of pedido.instancias.entries()) {
                indiceAtual = indice;
                atualizarExclusao(pedido.chave, {
                    situacao: "excluindo",
                    indiceAtual: indice,
                    porcentagem: Math.round((indice * 100) / pedido.instancias.length),
                    detalhe: "Preparando exclusão...",
                });
                await pedido.aoExcluir(instancia.id);
                atualizarExclusao(pedido.chave, {
                    porcentagem: Math.round(((indice + 1) * 100) / pedido.instancias.length),
                });
            }
        } finally {
            removerEscuta();
        }

        atualizarExclusao(pedido.chave, {
            situacao: "concluida",
            porcentagem: 100,
            detalhe: "Exclusão concluída",
        });
        window.setTimeout(() => dispensarExclusao(pedido.chave), 5000);
    } catch (falha) {
        window.dispatchEvent(new Event(EVENTO_INSTANCIAS_ATUALIZADAS));
        atualizarExclusao(pedido.chave, {
            situacao: "erro",
            detalhe: "Exclusão interrompida",
            erro: falha instanceof Error ? falha.message : String(falha),
        });
    }
}

async function processarFila() {
    if (processando) return;
    processando = true;

    try {
        while (fila.length > 0) {
            const pedido = fila.shift();
            if (pedido) await executarPedido(pedido);
        }
    } finally {
        processando = false;
    }
}

export function iniciarExclusaoInstancias(
    instancias: InstanciaParaExclusao[],
    aoExcluir: (id: string) => Promise<void>
) {
    const idsReservados = new Set(exclusoes
        .filter((exclusao) => ["aguardando", "excluindo"].includes(exclusao.situacao))
        .flatMap((exclusao) => exclusao.instancias.map((instancia) => instancia.id)));
    const instanciasNovas = instancias.filter((instancia) => !idsReservados.has(instancia.id));
    if (instanciasNovas.length === 0) return;

    const chave = proximaChave++;
    fila.push({ chave, instancias: instanciasNovas, aoExcluir });
    atualizarExclusoes([...exclusoes, {
        chave,
        instancias: instanciasNovas,
        indiceAtual: 0,
        porcentagem: 0,
        detalhe: "Aguardando a vez",
        situacao: "aguardando",
    }]);
    void processarFila();
}
