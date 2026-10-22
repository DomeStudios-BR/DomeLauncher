import { invoke } from "@tauri-apps/api/core";

interface RequisitosModpack {
    versaoMinecraft: string;
    loader: "vanilla" | "fabric" | "forge" | "neoforge";
    versaoLoader: string | null;
}

/** Consulte antes de criar instâncias a partir de arquivos Modrinth ou CurseForge. */
export function obterRequisitosModpack(downloadUrl: string): Promise<RequisitosModpack> {
    return invoke<RequisitosModpack>("obter_requisitos_modpack", { downloadUrl });
}
