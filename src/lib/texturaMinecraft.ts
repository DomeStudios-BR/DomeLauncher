import { invoke, isTauri } from "@tauri-apps/api/core";

const texturas = new Map<string, Promise<string>>();

/** Carrega texturas oficiais pelo processo nativo para evitar CORS e conteúdo HTTP na WebView. */
export function resolverTexturaMinecraft(origem: string): Promise<string> {
    if (!/^https?:\/\/textures\.minecraft\.net\//i.test(origem)) return Promise.resolve(origem);
    const url = origem.replace(/^http:/i, "https:");
    if (!isTauri()) return Promise.resolve(url);
    const existente = texturas.get(url);
    if (existente) return existente;
    const carregamento = invoke<number[]>("baixar_textura_minecraft", { url }).then((bytes) => {
        let binario = "";
        for (let indice = 0; indice < bytes.length; indice += 8192) {
            binario += String.fromCharCode(...bytes.slice(indice, indice + 8192));
        }
        return `data:image/png;base64,${btoa(binario)}`;
    }).catch((erro: unknown) => {
        texturas.delete(url);
        throw erro;
    });
    texturas.set(url, carregamento);
    return carregamento;
}
