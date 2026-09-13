export const EVENTO_SOLICITAR_TRANSFERENCIA_SOCIAL = "dome:social-solicitar-sync";
export const EVENTO_PROGRESSO_TRANSFERENCIA_SOCIAL = "dome:social-transferencia-progresso";
export const EVENTO_INSTANCIAS_ATUALIZADAS = "dome:instancias-atualizadas";
export const EVENTO_PUBLICAR_INSTANCIA_SOCIAL = "dome:social-publicar-instancia";
export const EVENTO_INSTANCIAS_PUBLICAS_SOCIAIS = "dome:social-instancias-publicas";
export const EVENTO_INSTALAR_ATIVIDADE_SOCIAL = "dome:social-instalar-atividade";

export interface PublicacaoInstanciaSocial {
    instanciaId: string;
    compartilhamentoId: string;
}

export type EstadoTransferenciaSocial =
    | "solicitando"
    | "aguardando"
    | "preparando"
    | "importando"
    | "concluido"
    | "erro";

export interface ProgressoTransferenciaSocial {
    estado: EstadoTransferenciaSocial;
    mensagem: string;
    friendProfileId: string;
    pedidoId?: string;
    instanciaId?: string | null;
}

export function publicarProgressoTransferenciaSocial(progresso: ProgressoTransferenciaSocial) {
    window.dispatchEvent(new CustomEvent(EVENTO_PROGRESSO_TRANSFERENCIA_SOCIAL, {
        detail: progresso,
    }));
}
