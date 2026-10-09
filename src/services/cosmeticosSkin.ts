import { invoke } from "@tauri-apps/api/core";
import { resolverTexturaMinecraft } from "../lib/texturaMinecraft";

export interface CapaMinecraft {
    id: string;
    state: string;
    url: string;
    alias: string;
}

export interface CosmeticosSkin {
    variant: "classic" | "slim";
    skinUrl?: string | null;
    capes: CapaMinecraft[];
}

export interface PreviewSkinSalva {
    cosmeticos: CosmeticosSkin;
    textura: string;
    atualizadaEm: number;
}

const INTERVALO_ATUALIZACAO = 60_000;
const consultas = new Map<string, { inicio: number; promessa: Promise<PreviewSkinSalva> }>();
const previas = new Map<string, PreviewSkinSalva>();

function chavePreview(uuid: string): string {
    return `dome-preview-skin:${uuid}`;
}

/** Recupera a última prévia da conta para usá-la enquanto o serviço está indisponível. */
export function obterPreviewSkinSalva(uuid: string): PreviewSkinSalva | null {
    const existente = previas.get(uuid);
    if (existente) return existente;
    try {
        const valor = localStorage.getItem(chavePreview(uuid));
        if (!valor) return null;
        const previa = JSON.parse(valor) as PreviewSkinSalva;
        if (!previa || typeof previa.textura !== "string" ||
            !previa.textura.startsWith("data:image/png;base64,iVBORw0KGgo") ||
            !Number.isFinite(previa.atualizadaEm) || !previa.cosmeticos ||
            !["classic", "slim"].includes(previa.cosmeticos.variant) ||
            !Array.isArray(previa.cosmeticos.capes) || !previa.cosmeticos.capes.every((capa) =>
                capa && [capa.id, capa.state, capa.url, capa.alias].every((campo) => typeof campo === "string"))) {
            return null;
        }
        atob(previa.textura.split(",")[1]);
        previas.set(uuid, previa);
        return previa;
    } catch {
        return null;
    }
}

/** Consulta a conta uma única vez por minuto; force a atualização após alterar skin ou capa. */
export function carregarPreviewSkin(
    uuid: string,
    accessToken: string,
    forcar = false,
): Promise<PreviewSkinSalva> {
    if (!uuid || !accessToken) return Promise.reject(new Error("Conta Minecraft inválida."));
    const agora = Date.now();
    const consulta = consultas.get(uuid);
    if (!forcar && consulta && agora - consulta.inicio < INTERVALO_ATUALIZACAO) return consulta.promessa;
    const salva = obterPreviewSkinSalva(uuid);
    if (!forcar && salva && agora - salva.atualizadaEm < INTERVALO_ATUALIZACAO) return Promise.resolve(salva);

    const promessa = invoke<CosmeticosSkin>("obter_cosmeticos_skin", { accessToken }).then(async (cosmeticos) => {
        if (!cosmeticos.skinUrl) throw new Error("O perfil não possui uma skin ativa.");
        const textura = await resolverTexturaMinecraft(cosmeticos.skinUrl);
        const previa = { cosmeticos, textura, atualizadaEm: Date.now() };
        previas.set(uuid, previa);
        try {
            localStorage.setItem(chavePreview(uuid), JSON.stringify(previa));
        } catch {
            console.warn("Não foi possível salvar a prévia da skin nesta conta.");
        }
        return previa;
    });
    consultas.set(uuid, { inicio: agora, promessa });
    return promessa;
}
